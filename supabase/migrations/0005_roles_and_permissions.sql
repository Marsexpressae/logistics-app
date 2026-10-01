-- Roles & permissions.
--
--   admin      everything, plus managing users
--   staff      office: bookings, pickups, accounts/payments; read-only warehouse & containers
--   driver     only their own pickups: record items, log payments, mark collected
--   warehouse  receive/split parcels, load/depart/arrive containers, deliver parcels
--
-- A signed-in user with NO active profile can access nothing (so open sign-ups are harmless).
-- Profiles are created by an admin through the app (server route using the service-role key).

-- ---------- profiles ----------
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  role       text not null check (role in ('admin', 'staff', 'driver', 'warehouse')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

-- Everyone who already has a login becomes an admin (that is the owner at this point).
insert into profiles (id, full_name, role)
select id, coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)), 'admin'
from auth.users
on conflict do nothing;

-- ---------- helpers ----------
create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid()) and active
$$;

create or replace function my_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.drivers where user_id = (select auth.uid()) limit 1
$$;

create or replace function require_role(variadic allowed text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if app_role() is null or not (app_role() = any (allowed)) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
end $$;

-- ---------- replace the blanket policies ----------
do $$
declare t text;
begin
  foreach t in array array['drivers','warehouses','bookings','booking_items','payments',
                           'containers','parcels','parcel_events']
  loop
    execute format('drop policy if exists "authenticated full access" on %I', t);
  end loop;
end $$;

-- profiles: you can read your own; admins read all. Writes happen only via the service role.
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or (select app_role()) = 'admin');

-- drivers
create policy drivers_select on drivers for select to authenticated
  using ((select app_role()) is not null);
create policy drivers_insert on drivers for insert to authenticated
  with check ((select app_role()) in ('admin', 'staff'));
create policy drivers_update on drivers for update to authenticated
  using ((select app_role()) in ('admin', 'staff')) with check ((select app_role()) in ('admin', 'staff'));
create policy drivers_delete on drivers for delete to authenticated
  using ((select app_role()) = 'admin');

-- warehouses
create policy warehouses_select on warehouses for select to authenticated
  using ((select app_role()) is not null);
create policy warehouses_write on warehouses for all to authenticated
  using ((select app_role()) = 'admin') with check ((select app_role()) = 'admin');

-- bookings
create policy bookings_select on bookings for select to authenticated using (
  (select app_role()) in ('admin', 'staff', 'warehouse')
  or ((select app_role()) = 'driver' and driver_id = (select my_driver_id()))
);
create policy bookings_insert on bookings for insert to authenticated
  with check ((select app_role()) in ('admin', 'staff'));
create policy bookings_update on bookings for update to authenticated
  using (
    (select app_role()) in ('admin', 'staff')
    or ((select app_role()) = 'driver' and driver_id = (select my_driver_id()))
  )
  with check (
    (select app_role()) in ('admin', 'staff')
    or ((select app_role()) = 'driver' and driver_id = (select my_driver_id()))
  );
create policy bookings_delete on bookings for delete to authenticated
  using ((select app_role()) = 'admin');

-- Drivers may only mark their pickups collected; everything else on a booking is off limits.
create or replace function guard_driver_booking_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_role() = 'driver' then
    if (to_jsonb(new) - 'status' - 'collected_at') is distinct from (to_jsonb(old) - 'status' - 'collected_at') then
      raise exception 'Drivers can only mark pickups as collected';
    end if;
    if new.status is distinct from old.status and not (old.status = 'booked' and new.status = 'collected') then
      raise exception 'Drivers can only mark pickups as collected';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_guard before update on bookings
  for each row execute function guard_driver_booking_update();

-- booking_items (driver: only items on their own bookings)
create policy items_select on booking_items for select to authenticated using (
  (select app_role()) in ('admin', 'staff', 'warehouse')
  or ((select app_role()) = 'driver' and exists (
        select 1 from bookings b where b.id = booking_id and b.driver_id = (select my_driver_id())))
);
create policy items_write on booking_items for all to authenticated
  using (
    (select app_role()) in ('admin', 'staff')
    or ((select app_role()) = 'driver' and exists (
          select 1 from bookings b where b.id = booking_id and b.driver_id = (select my_driver_id())))
  )
  with check (
    (select app_role()) in ('admin', 'staff')
    or ((select app_role()) = 'driver' and exists (
          select 1 from bookings b where b.id = booking_id and b.driver_id = (select my_driver_id())))
  );

-- payments (warehouse sees none)
create policy payments_select on payments for select to authenticated using (
  (select app_role()) in ('admin', 'staff')
  or ((select app_role()) = 'driver' and exists (
        select 1 from bookings b where b.id = booking_id and b.driver_id = (select my_driver_id())))
);
create policy payments_insert on payments for insert to authenticated with check (
  (select app_role()) in ('admin', 'staff')
  or ((select app_role()) = 'driver' and exists (
        select 1 from bookings b where b.id = booking_id and b.driver_id = (select my_driver_id())))
);
create policy payments_update on payments for update to authenticated
  using ((select app_role()) in ('admin', 'staff')) with check ((select app_role()) in ('admin', 'staff'));
create policy payments_delete on payments for delete to authenticated
  using ((select app_role()) in ('admin', 'staff'));

-- containers
create policy containers_select on containers for select to authenticated
  using ((select app_role()) in ('admin', 'staff', 'warehouse'));
create policy containers_insert on containers for insert to authenticated
  with check ((select app_role()) in ('admin', 'warehouse'));
create policy containers_update on containers for update to authenticated
  using ((select app_role()) in ('admin', 'warehouse')) with check ((select app_role()) in ('admin', 'warehouse'));
create policy containers_delete on containers for delete to authenticated
  using ((select app_role()) = 'admin');

-- parcels & history: read-only from the client. Writes go through the functions below.
create policy parcels_select on parcels for select to authenticated
  using ((select app_role()) in ('admin', 'staff', 'warehouse'));
create policy parcel_events_select on parcel_events for select to authenticated
  using ((select app_role()) in ('admin', 'staff', 'warehouse'));

-- ---------- state-changing functions: now security definer + explicit role check ----------
create or replace function log_parcel_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into parcel_events (parcel_id, status) values (new.id, new.status);
  return new;
end $$;

create or replace function touch_parcel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into parcel_events (parcel_id, status) values (new.id, new.status);
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function split_booking(p_booking_id uuid, p_warehouse_id uuid, p_parcels jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  n int := 0;
  p jsonb;
begin
  perform require_role('admin', 'warehouse');
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('collected', 'at_warehouse') then
    raise exception 'Booking % has not been collected yet', b.code;
  end if;
  if jsonb_array_length(p_parcels) = 0 then raise exception 'Add at least one parcel'; end if;
  if exists (select 1 from parcels where booking_id = b.id and status <> 'in_warehouse') then
    raise exception 'Some parcels of % have already left the warehouse; cannot re-split', b.code;
  end if;

  delete from parcels where booking_id = b.id;

  for p in select * from jsonb_array_elements(p_parcels) loop
    n := n + 1;
    insert into parcels (booking_id, seq, barcode, description, weight_kg, warehouse_id)
    values (b.id, n, b.code || '-P' || n, p ->> 'description',
            coalesce((p ->> 'weight_kg')::numeric, 0), p_warehouse_id);
  end loop;

  update bookings set status = 'at_warehouse' where id = b.id;
  return n;
end $$;

create or replace function load_parcel(p_container_id uuid, p_barcode text)
returns parcels language plpgsql security definer set search_path = public as $$
declare
  c containers;
  p parcels;
begin
  perform require_role('admin', 'warehouse');
  select * into c from containers where id = p_container_id;
  if not found then raise exception 'Container not found'; end if;
  if c.status <> 'loading' then raise exception 'Container % has already departed', c.code; end if;

  select * into p from parcels where barcode = upper(trim(p_barcode)) for update;
  if not found then raise exception 'No parcel with barcode %', p_barcode; end if;
  if p.status <> 'in_warehouse' then
    raise exception 'Parcel % is not in a warehouse (status: %)', p.barcode, p.status;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;
  return p;
end $$;

create or replace function unload_parcel(p_parcel_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'warehouse');
  update parcels set status = 'in_warehouse', container_id = null
  where id = p_parcel_id and status = 'loaded';
  if not found then raise exception 'Parcel cannot be unloaded'; end if;
end $$;

create or replace function depart_container(p_container_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_role('admin', 'warehouse');
  update containers set status = 'departed', departed_at = now()
  where id = p_container_id and status = 'loading';
  if not found then raise exception 'Container is not open for loading'; end if;

  update parcels set status = 'in_transit'
  where container_id = p_container_id and status = 'loaded';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function arrive_container(p_container_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_role('admin', 'warehouse');
  update containers set status = 'arrived'
  where id = p_container_id and status = 'departed';
  if not found then raise exception 'Container has not departed, or has already arrived'; end if;

  update parcels set status = 'arrived'
  where container_id = p_container_id and status = 'in_transit';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function deliver_parcel(p_parcel_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'warehouse');
  update parcels set status = 'delivered' where id = p_parcel_id and status = 'arrived';
  if not found then raise exception 'Parcel must have arrived before it can be delivered'; end if;
end $$;

create or replace function cancel_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'staff');
  if exists (select 1 from parcels where booking_id = p_booking_id) then
    raise exception 'Booking already has parcels in the warehouse and cannot be cancelled';
  end if;
  update bookings set status = 'cancelled'
  where id = p_booking_id and status in ('booked', 'collected');
  if not found then raise exception 'Only booked or collected bookings can be cancelled'; end if;
end $$;

-- ---------- execute permissions ----------
-- Only signed-in users may call these (track_booking stays public on purpose).
revoke execute on function app_role(), my_driver_id(), require_role(text[]),
  split_booking(uuid, uuid, jsonb), load_parcel(uuid, text), unload_parcel(uuid),
  depart_container(uuid), arrive_container(uuid), deliver_parcel(uuid), cancel_booking(uuid)
  from public, anon;
grant execute on function app_role(), my_driver_id(), require_role(text[]),
  split_booking(uuid, uuid, jsonb), load_parcel(uuid, text), unload_parcel(uuid),
  depart_container(uuid), arrive_container(uuid), deliver_parcel(uuid), cancel_booking(uuid)
  to authenticated;
