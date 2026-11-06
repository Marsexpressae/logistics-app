-- Return requests: telling the warehouse which parcels to prepare for return.
-- Design: docs/superpowers/specs/2026-11-06-return-requests-design.md
--
-- Sales or accounts raise a request on a booking; the warehouse sees it in a "To prepare" list with a pick list and gets a
-- notification; preparing the return closes the request and tells the person who asked. Requests are written only through the
-- functions below, which check every input. This migration adds a table, a permission and functions, and replaces prepare_return
-- with the same rules plus the closing of the open request, so the running app keeps working.

-- ---------- permission ----------
insert into permissions (key, group_name, label, description, sort) values
  ('returns.request', 'Warehouse', 'Request returns', 'Ask the warehouse to prepare parcels for return, and cancel a request', 116)
on conflict (key) do nothing;

insert into role_permissions (role, permission)
select distinct rp.role, 'returns.request'
from role_permissions rp
where rp.permission in ('bookings.edit', 'returns.prepare')
on conflict do nothing;

insert into role_permissions (role, permission)
select 'super_admin', 'returns.request'
where exists (select 1 from roles where key = 'super_admin')
on conflict do nothing;

-- ---------- the table ----------
create table return_requests (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings (id) on delete cascade,
  status            text not null default 'open' check (status in ('open', 'prepared', 'cancelled')),
  note              text,
  needed_by         date,
  parcel_ids        uuid[],   -- the parcels asked for; null = every parcel of the booking that is in the warehouse
  requested_by      uuid,
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  return_id         uuid references returns (id) on delete set null,
  closed_at         timestamptz,
  closed_by_name    text
);
-- one open request per booking (to change a request, cancel it and raise a new one)
create unique index return_requests_one_open_idx on return_requests (booking_id) where status = 'open';
-- foreign keys are indexed: the cascade from a deleted booking, and the link to the return form
create index return_requests_booking_idx on return_requests (booking_id);
create index return_requests_return_idx on return_requests (return_id);

alter table return_requests enable row level security;
revoke all on return_requests from anon;
revoke insert, update, delete on return_requests from authenticated;
grant select on return_requests to authenticated;
create policy return_requests_select on return_requests for select to authenticated
  using ((select has_perm('returns.request')) or (select has_perm('returns.prepare')) or (select has_perm('warehouse.view')));

create trigger audit_return_requests after insert or update or delete on return_requests
  for each row execute function audit_row();

-- an open warehouse screen updates by itself
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table return_requests;
  end if;
end $$;

-- ---------- booking history ----------
alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing', 'returned', 'return_deleted', 'moved', 'parcels_edited',
                  'return_requested', 'return_request_cancelled'));

-- ---------- internal: tell the people who prepare returns ----------
create or replace function notify_returns_team(p_booking_id uuid, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, booking_id, kind, title, body, actor_name)
  select pr.id, p_booking_id, p_kind, p_title, p_body, (select full_name from profiles where id = auth.uid())
  from profiles pr
  join role_permissions rp on rp.role = pr.role and rp.permission = 'returns.prepare'
  where pr.active and pr.id is distinct from auth.uid();
end $$;
revoke execute on function notify_returns_team(uuid, text, text, text) from public, anon, authenticated;

-- ---------- 1. raise a request ----------
create or replace function request_return(p_booking_id uuid, p_note text default null, p_needed_by date default null, p_parcel_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  rid uuid;
  actor uuid := auth.uid();
  actor_name text := (select full_name from profiles where id = auth.uid());
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  ids uuid[] := case when coalesce(cardinality(p_parcel_ids), 0) > 0 then array(select distinct x from unnest(p_parcel_ids) x) end;
  n int;
  needed text := case when p_needed_by is not null then 'Needed by ' || to_char(p_needed_by, 'DD Mon YYYY') end;
begin
  perform require_perm('returns.request');
  select * into b from bookings where id = p_booking_id for update; -- two people cannot both pass the checks below
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'cancelled' then raise exception 'A cancelled booking cannot have a return request'; end if;
  if p_needed_by is not null and p_needed_by < (now() at time zone 'Asia/Dubai')::date then
    raise exception 'The needed-by date cannot be in the past';
  end if;
  if exists (select 1 from return_requests where booking_id = b.id and status = 'open') then
    raise exception 'This booking already has an open return request';
  end if;
  if ids is not null then
    select count(*) into n from parcels where id = any (ids) and booking_id = b.id and status = 'in_warehouse';
    if n <> cardinality(ids) then raise exception 'Choose parcels of this booking that are in the warehouse'; end if;
  elsif not exists (select 1 from parcels where booking_id = b.id and status = 'in_warehouse') then
    raise exception 'This booking has no parcels in the warehouse';
  end if;

  begin
    insert into return_requests (booking_id, note, needed_by, parcel_ids, requested_by, requested_by_name)
    values (b.id, clean_note, p_needed_by, ids, actor, actor_name)
    returning id into rid;
  exception when unique_violation then
    raise exception 'This booking already has an open return request';
  end;

  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  values (b.id, 'return_requested', concat_ws(' ', coalesce(clean_note, 'Return requested'), case when needed is not null then '(' || lower(needed) || ')' end), actor, actor_name);

  perform notify_returns_team(b.id, 'return_requested',
    'Return requested: ' || coalesce(b.invoice_no, b.code) || ' (' || b.sender_name || ')',
    concat_ws(' ', clean_note, needed));
  return rid;
end $$;

-- ---------- 2. cancel a request ----------
create or replace function cancel_return_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r return_requests;
  b bookings;
  actor uuid := auth.uid();
  actor_name text := (select full_name from profiles where id = auth.uid());
begin
  if not exists (select 1 from profiles where id = actor and active) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  select * into r from return_requests where id = p_request_id for update;
  if not found then raise exception 'Return request not found'; end if;
  if r.status <> 'open' then raise exception 'This return request is already %', r.status; end if;
  if r.requested_by is distinct from actor and not has_perm('returns.prepare') then
    raise exception 'Only the person who asked, or the warehouse, can cancel this request';
  end if;

  update return_requests set status = 'cancelled', closed_at = now(), closed_by_name = actor_name where id = r.id;
  select * into b from bookings where id = r.booking_id;
  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  values (r.booking_id, 'return_request_cancelled', 'Return request cancelled', actor, actor_name);
  perform notify_returns_team(r.booking_id, 'return_request_cancelled',
    'Return request cancelled: ' || coalesce(b.invoice_no, b.code) || ' (' || b.sender_name || ')', coalesce(r.note, ''));
  -- the person who asked is told when someone else cancels (unless they prepare returns themselves: they were told just above)
  if r.requested_by is not null and r.requested_by is distinct from actor
     and exists (select 1 from profiles where id = r.requested_by and active)
     and not exists (select 1 from profiles pr join role_permissions rp on rp.role = pr.role and rp.permission = 'returns.prepare' where pr.id = r.requested_by) then
    insert into notifications (user_id, booking_id, kind, title, body, actor_name)
    values (r.requested_by, r.booking_id, 'return_request_cancelled',
            'Return request cancelled: ' || coalesce(b.invoice_no, b.code) || ' (' || b.sender_name || ')', 'Cancelled by ' || actor_name, actor_name);
  end if;
end $$;

-- ---------- 3. the parcels a request can ask for (needs no access to the warehouse screens) ----------
create or replace function parcels_for_return_request(p_booking_id uuid)
returns table (id uuid, barcode text, description text, weight_kg numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('returns.request');
  return query
    select p.id, p.barcode, p.description, p.weight_kg
    from parcels p
    where p.booking_id = p_booking_id and p.status = 'in_warehouse'
    order by p.seq;
end $$;

-- ---------- 4. prepare a return (as in migration 0019, now also closing the open request) ----------
create or replace function prepare_return(p_booking_id uuid, p_parcel_ids uuid[], p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  rcode text;
  actor uuid := auth.uid();
  actor_name text := (select full_name from profiles where id = auth.uid());
  n int;
  req return_requests;
begin
  perform require_perm('returns.prepare');
  if coalesce(cardinality(p_parcel_ids), 0) = 0 then raise exception 'Select at least one parcel'; end if;

  -- lock the parcels first: a second person returning the same parcels waits here, then finds them gone
  select count(*) into n from (
    select 1 from parcels where id = any (p_parcel_ids) and booking_id = p_booking_id and status = 'in_warehouse' for update
  ) locked;
  if n <> cardinality(p_parcel_ids) then
    raise exception 'Only parcels of this booking that are in the warehouse can be returned';
  end if;

  insert into returns (booking_id, note, created_by, created_by_name)
  values (p_booking_id, nullif(btrim(coalesce(p_note, '')), ''), actor, actor_name)
  returning id, code into rid, rcode;

  update parcels set status = 'ready_for_return', return_id = rid where id = any (p_parcel_ids) and status = 'in_warehouse';
  get diagnostics n = row_count;
  if n <> cardinality(p_parcel_ids) then
    raise exception 'Only parcels of this booking that are in the warehouse can be returned'; -- belt and braces: nothing is kept if a parcel moved meanwhile
  end if;

  -- the booking's open return request, if any, is now done: tell whoever asked
  update return_requests set status = 'prepared', return_id = rid, closed_at = now(), closed_by_name = actor_name
  where booking_id = p_booking_id and status = 'open'
  returning * into req;
  if found and req.requested_by is not null and req.requested_by is distinct from actor
     and exists (select 1 from profiles where id = req.requested_by and active) then
    insert into notifications (user_id, booking_id, kind, title, body, actor_name)
    select req.requested_by, p_booking_id, 'return_prepared', 'Return ' || rcode || ' is ready',
           'Prepared for ' || coalesce(b.invoice_no, b.code) || ' (' || b.sender_name || ')', actor_name
    from bookings b where b.id = p_booking_id;
  end if;
  return rid;
end $$;

revoke execute on function request_return(uuid, text, date, uuid[]) from public, anon;
revoke execute on function cancel_return_request(uuid) from public, anon;
revoke execute on function parcels_for_return_request(uuid) from public, anon;
grant execute on function request_return(uuid, text, date, uuid[]) to authenticated;
grant execute on function cancel_return_request(uuid) to authenticated;
grant execute on function parcels_for_return_request(uuid) to authenticated;
