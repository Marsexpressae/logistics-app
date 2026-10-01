-- 1) Edit-conflict protection: bookings carry a version stamp (updated_at).
-- 2) Audit log: every insert/update/delete on the important tables is recorded, immutably.

-- ---------- 1) updated_at on bookings ----------
alter table bookings add column updated_at timestamptz not null default now();

create or replace function touch_booking() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_touch before update on bookings
  for each row execute function touch_booking();

-- The driver guard must ignore the version stamp when comparing rows.
create or replace function guard_driver_booking_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_role() = 'driver' then
    if (to_jsonb(new) - 'status' - 'collected_at' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'collected_at' - 'updated_at') then
      raise exception 'Drivers can only mark pickups as collected';
    end if;
    if new.status is distinct from old.status and not (old.status = 'booked' and new.status = 'collected') then
      raise exception 'Drivers can only mark pickups as collected';
    end if;
  end if;
  return new;
end $$;

-- ---------- 2) audit log ----------
create table audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     uuid,
  booking_id uuid,                 -- set for bookings and anything belonging to a booking
  action     text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid,                 -- null when changed by the server / a migration
  actor_name text,                 -- copied at write time, so it survives user deletion
  changed_at timestamptz not null default now(),
  changes    jsonb                 -- insert: new row | delete: old row | update: {column: {old, new}}
);
create index audit_log_booking_idx on audit_log (booking_id, changed_at desc);
create index audit_log_time_idx on audit_log (changed_at desc);

-- Admins can read it. Nobody can write to it from the client: only the trigger below.
alter table audit_log enable row level security;
create policy audit_select on audit_log for select to authenticated
  using ((select app_role()) = 'admin');
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec   jsonb;
  old_j jsonb;
  new_j jsonb;
  diff  jsonb;
  k     text;
  bid   uuid;
  actor uuid := auth.uid();
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name = 'bookings' then
    bid := (rec ->> 'id')::uuid;
  elsif rec ? 'booking_id' then
    bid := (rec ->> 'booking_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    diff := '{}'::jsonb;
    for k in select jsonb_object_keys(new_j) loop
      if k <> 'updated_at' and old_j -> k is distinct from new_j -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_j -> k, 'new', new_j -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if; -- nothing meaningful changed
  else
    diff := rec;
  end if;

  insert into audit_log (table_name, row_id, booking_id, action, changed_by, actor_name, changes)
  values (tg_table_name, (rec ->> 'id')::uuid, bid, lower(tg_op), actor,
          (select full_name from profiles where id = actor), diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bookings', 'booking_items', 'payments', 'parcels', 'containers', 'drivers', 'profiles']
  loop
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row()',
      'audit_' || t, t);
  end loop;
end $$;
