-- Warehouse returns: parcels leave the warehouse and go back to the customer, with a signed return form.
-- Parcel lifecycle addition: in_warehouse -> ready_for_return -> returned
-- Bookings, invoices and payments are not touched.

alter table parcels drop constraint if exists parcels_status_check;
alter table parcels add constraint parcels_status_check
  check (status in ('in_warehouse', 'loaded', 'in_transit', 'arrived', 'delivered', 'repacked', 'ready_for_return', 'returned'));

create sequence if not exists return_code_seq start 1001;

create table returns (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null default ('RT-' || nextval('return_code_seq')),
  booking_id        uuid not null references bookings (id) on delete restrict,
  status            text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  note              text,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  completed_by_name text,   -- the staff member who handed the parcels over and signed it off
  received_by_name  text    -- the person who took the parcels (signs the printed form)
);
create index returns_booking_idx on returns (booking_id);

alter table parcels add column if not exists return_id uuid references returns (id) on delete set null;

alter table returns enable row level security;
revoke all on returns from anon;
revoke insert, update, delete on returns from authenticated;
grant select on returns to authenticated;
create policy returns_select on returns for select to authenticated
  using ((select has_perm('warehouse.view')) or (select has_perm('warehouse.manage')));

alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing', 'returned'));

create trigger audit_returns after insert or update or delete on returns
  for each row execute function audit_row();

-- 1. Prepare: pick parcels of ONE booking that are in the warehouse; they become "ready for return".
create or replace function prepare_return(p_booking_id uuid, p_parcel_ids uuid[], p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  actor uuid := auth.uid();
  n int;
begin
  perform require_perm('warehouse.manage');
  if coalesce(cardinality(p_parcel_ids), 0) = 0 then raise exception 'Select at least one parcel'; end if;

  select count(*) into n from parcels
  where id = any (p_parcel_ids) and booking_id = p_booking_id and status = 'in_warehouse';
  if n <> cardinality(p_parcel_ids) then
    raise exception 'Only parcels of this booking that are in the warehouse can be returned';
  end if;

  insert into returns (booking_id, note, created_by, created_by_name)
  values (p_booking_id, nullif(btrim(coalesce(p_note, '')), ''), actor, (select full_name from profiles where id = actor))
  returning id into rid;

  update parcels set status = 'ready_for_return', return_id = rid where id = any (p_parcel_ids);
  return rid;
end $$;

-- 2. Complete: the parcels were handed over and the form was signed. Records who received them and which staff member signed off.
create or replace function complete_return(p_return_id uuid, p_received_by text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r returns;
  actor uuid := auth.uid();
  staff text;
  n int;
begin
  perform require_perm('warehouse.manage');
  if nullif(btrim(coalesce(p_received_by, '')), '') is null then raise exception 'Enter the name of the person who received the parcels'; end if;
  select * into r from returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if r.status <> 'open' then raise exception 'This return is already %', r.status; end if;

  staff := (select full_name from profiles where id = actor);
  update parcels set status = 'returned' where return_id = r.id and status = 'ready_for_return';
  get diagnostics n = row_count;
  update returns set status = 'completed', completed_at = now(), completed_by_name = staff, received_by_name = btrim(p_received_by)
  where id = r.id;

  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  values (r.booking_id, 'returned', r.code || ': ' || n || ' parcel(s) returned to ' || btrim(p_received_by), actor, staff);
end $$;

-- 3. Cancel an open return: the parcels go back to normal stock.
create or replace function cancel_return(p_return_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r returns;
begin
  perform require_perm('warehouse.manage');
  select * into r from returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if r.status <> 'open' then raise exception 'This return is already %', r.status; end if;
  update parcels set status = 'in_warehouse', return_id = null where return_id = r.id and status = 'ready_for_return';
  update returns set status = 'cancelled' where id = r.id;
end $$;
