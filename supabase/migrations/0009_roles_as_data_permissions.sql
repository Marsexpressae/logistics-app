-- Roles and permissions become DATA, editable by a super admin from the app.
--   * roles / permissions / role_permissions tables
--   * "admin" is renamed "super_admin"; new "manager" role
--   * every row-level-security policy and every state-changing function now checks a PERMISSION,
--     not a role name
-- Permission keys are the only thing app code refers to; roles can be re-mapped without code changes.

-- ---------- catalogue ----------
create table roles (
  key         text primary key,
  label       text not null,
  description text not null default '',
  sort        int  not null default 0
);

create table permissions (
  key         text primary key,
  group_name  text not null,
  label       text not null,
  description text not null default '',
  sort        int  not null default 0
);

create table role_permissions (
  role       text not null references roles (key) on update cascade on delete cascade,
  permission text not null references permissions (key) on update cascade on delete cascade,
  primary key (role, permission)
);
create index role_permissions_permission_idx on role_permissions (permission);

insert into roles (key, label, description, sort) values
  ('super_admin', 'Super admin', 'Owner. Full access, including editing roles and permissions.', 1),
  ('manager',     'Manager',     'Runs day-to-day operations and can add staff and drivers.', 2),
  ('staff',       'Office staff','Handles bookings, pickups and accounts.', 3),
  ('warehouse',   'Warehouse worker', 'Receives, splits and ships parcels.', 4),
  ('driver',      'Driver',      'Sees and completes only their own pickups.', 5);

insert into permissions (key, group_name, label, description, sort) values
  ('dashboard.view',     'General',   'View dashboard',            'See the dashboard counts', 10),
  ('bookings.view',      'Bookings',  'View bookings',             'See the bookings list and details', 20),
  ('bookings.create',    'Bookings',  'Create bookings',           'Add new bookings', 21),
  ('bookings.edit',      'Bookings',  'Edit bookings',             'Change booking details, driver, bill and invoice amount', 22),
  ('bookings.cancel',    'Bookings',  'Cancel bookings',           'Cancel a booking (a reason is required)', 23),
  ('bookings.delete',    'Bookings',  'Delete bookings',           'Permanently delete a booking', 24),
  ('pickups.view_all',   'Pickups',   'View all pickups',          'See every driver''s pickups', 30),
  ('pickups.view_own',   'Pickups',   'View own pickups only',     'See only pickups assigned to them (for drivers)', 31),
  ('pickups.collect',    'Pickups',   'Record collections',        'Add items, log payments and mark pickups collected', 32),
  ('warehouse.view',     'Warehouse', 'View warehouse inventory',  'See parcels in the warehouses', 40),
  ('warehouse.manage',   'Warehouse', 'Receive and split parcels', 'Receive bookings, split into parcels, print labels', 41),
  ('containers.view',    'Containers','View containers',           'See containers and their manifests', 50),
  ('containers.manage',  'Containers','Manage containers',         'Create containers, load, depart, arrive and deliver parcels', 51),
  ('accounts.view',      'Accounts',  'View accounts',             'See invoiced, collected and outstanding amounts', 60),
  ('payments.manage',    'Accounts',  'Edit or delete payments',   'Correct or remove recorded payments', 61),
  ('drivers.manage',     'People',    'Manage driver records',     'Add, edit or remove driver records', 70),
  ('users.manage',       'People',    'Manage users',              'Add users, change their role, deactivate, reset passwords', 71),
  ('roles.manage',       'People',    'Edit roles and permissions','Change which role can do what (super admin only by default)', 72),
  ('activity.view',      'People',    'View activity log',         'See who changed what', 73);

-- super admin: everything
insert into role_permissions select 'super_admin', key from permissions;

insert into role_permissions (role, permission) values
  -- manager
  ('manager','dashboard.view'), ('manager','bookings.view'), ('manager','bookings.create'),
  ('manager','bookings.edit'), ('manager','bookings.cancel'), ('manager','pickups.view_all'),
  ('manager','pickups.collect'), ('manager','warehouse.view'), ('manager','warehouse.manage'),
  ('manager','containers.view'), ('manager','containers.manage'), ('manager','accounts.view'),
  ('manager','payments.manage'), ('manager','drivers.manage'), ('manager','users.manage'),
  ('manager','activity.view'),
  -- office staff
  ('staff','dashboard.view'), ('staff','bookings.view'), ('staff','bookings.create'),
  ('staff','bookings.edit'), ('staff','bookings.cancel'), ('staff','pickups.view_all'),
  ('staff','pickups.collect'), ('staff','warehouse.view'), ('staff','containers.view'),
  ('staff','accounts.view'),
  -- warehouse worker
  ('warehouse','dashboard.view'), ('warehouse','warehouse.view'), ('warehouse','warehouse.manage'),
  ('warehouse','containers.view'), ('warehouse','containers.manage'),
  -- driver
  ('driver','pickups.view_own'), ('driver','pickups.collect');

-- ---------- profiles use the roles table ----------
alter table profiles drop constraint if exists profiles_role_check;
update profiles set role = 'super_admin' where role = 'admin';
alter table profiles
  add constraint profiles_role_fk foreign key (role) references roles (key) on update cascade;

-- ---------- helpers ----------
create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on rp.role = pr.role
    where pr.id = (select auth.uid()) and pr.active and rp.permission = p
  )
$$;

create or replace function require_perm(p text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm(p) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
end $$;

revoke execute on function has_perm(text), require_perm(text) from public, anon;
grant execute on function has_perm(text), require_perm(text) to authenticated;

-- ---------- rebuild every policy on permissions ----------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;

-- the catalogue is readable by anyone with an active profile; only role_permissions is editable
create policy roles_select on roles for select to authenticated using ((select app_role()) is not null);
create policy permissions_select on permissions for select to authenticated using ((select app_role()) is not null);
create policy role_permissions_select on role_permissions for select to authenticated using ((select app_role()) is not null);
create policy role_permissions_insert on role_permissions for insert to authenticated
  with check ((select has_perm('roles.manage')));
create policy role_permissions_delete on role_permissions for delete to authenticated
  using ((select has_perm('roles.manage')));

revoke all on roles, permissions, role_permissions from anon;
revoke insert, update, delete on roles, permissions from authenticated;
revoke update on role_permissions from authenticated;

-- The super admin can never lose a permission (prevents locking everyone out).
create or replace function protect_super_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'super_admin' and auth.uid() is not null then
    raise exception 'The super admin role always keeps every permission';
  end if;
  return old;
end $$;
create trigger role_permissions_protect before delete on role_permissions
  for each row execute function protect_super_admin();

create trigger audit_role_permissions after insert or update or delete on role_permissions
  for each row execute function audit_row();

-- profiles
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or (select has_perm('users.manage')));

-- drivers: everyone signed in can read (booking dropdowns); managing needs a permission
create policy drivers_select on drivers for select to authenticated using ((select app_role()) is not null);
create policy drivers_insert on drivers for insert to authenticated with check ((select has_perm('drivers.manage')));
create policy drivers_update on drivers for update to authenticated
  using ((select has_perm('drivers.manage'))) with check ((select has_perm('drivers.manage')));
create policy drivers_delete on drivers for delete to authenticated using ((select has_perm('drivers.manage')));

-- warehouses (the two sites): readable by all, structure editable only with roles.manage
create policy warehouses_select on warehouses for select to authenticated using ((select app_role()) is not null);
create policy warehouses_write on warehouses for all to authenticated
  using ((select has_perm('roles.manage'))) with check ((select has_perm('roles.manage')));

-- bookings
create policy bookings_select on bookings for select to authenticated using (
  (select has_perm('bookings.view'))
  or (select has_perm('pickups.view_all'))
  or (select has_perm('warehouse.view'))
  or ((select has_perm('pickups.view_own')) and driver_id = (select my_driver_id()))
);
create policy bookings_insert on bookings for insert to authenticated
  with check ((select has_perm('bookings.create')));
create policy bookings_update on bookings for update to authenticated
  using (
    (select has_perm('bookings.edit'))
    or ((select has_perm('pickups.collect'))
        and ((select has_perm('pickups.view_all')) or driver_id = (select my_driver_id())))
  )
  with check (
    (select has_perm('bookings.edit'))
    or ((select has_perm('pickups.collect'))
        and ((select has_perm('pickups.view_all')) or driver_id = (select my_driver_id())))
  );
create policy bookings_delete on bookings for delete to authenticated
  using ((select has_perm('bookings.delete')));

-- Without bookings.edit, a user may only mark a pickup collected (nothing else on the row).
-- This is an INVOKER function on purpose: inside the security-definer functions (cancel_booking...)
-- current_user is the function owner, so those internal updates are not blocked.
create or replace function guard_driver_booking_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and auth.uid() is not null and not has_perm('bookings.edit') then
    if (to_jsonb(new) - 'status' - 'collected_at' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'collected_at' - 'updated_at') then
      raise exception 'You can only mark pickups as collected';
    end if;
    if new.status is distinct from old.status and not (old.status = 'booked' and new.status = 'collected') then
      raise exception 'You can only mark pickups as collected';
    end if;
  end if;
  return new;
end $$;

-- booking_items: visibility follows the booking (the subquery is itself subject to bookings RLS)
create policy items_select on booking_items for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id));
create policy items_write on booking_items for all to authenticated
  using (((select has_perm('bookings.edit')) or (select has_perm('pickups.collect')))
         and exists (select 1 from bookings b where b.id = booking_id))
  with check (((select has_perm('bookings.edit')) or (select has_perm('pickups.collect')))
         and exists (select 1 from bookings b where b.id = booking_id));

-- payments
create policy payments_select on payments for select to authenticated using (
  (select has_perm('accounts.view'))
  or ((select has_perm('pickups.collect')) and exists (select 1 from bookings b where b.id = booking_id))
);
create policy payments_insert on payments for insert to authenticated with check (
  (select has_perm('payments.manage'))
  or ((select has_perm('pickups.collect')) and exists (select 1 from bookings b where b.id = booking_id))
);
create policy payments_update on payments for update to authenticated
  using ((select has_perm('payments.manage'))) with check ((select has_perm('payments.manage')));
create policy payments_delete on payments for delete to authenticated
  using ((select has_perm('payments.manage')));

-- containers, parcels
create policy containers_select on containers for select to authenticated
  using ((select has_perm('containers.view')) or (select has_perm('containers.manage')));
create policy containers_insert on containers for insert to authenticated
  with check ((select has_perm('containers.manage')));
create policy containers_update on containers for update to authenticated
  using ((select has_perm('containers.manage'))) with check ((select has_perm('containers.manage')));
create policy containers_delete on containers for delete to authenticated
  using ((select has_perm('containers.manage')));

create policy parcels_select on parcels for select to authenticated
  using ((select has_perm('warehouse.view')) or (select has_perm('containers.view')));
create policy parcel_events_select on parcel_events for select to authenticated
  using ((select has_perm('warehouse.view')) or (select has_perm('containers.view')));

-- audit log
create policy audit_select on audit_log for select to authenticated using ((select has_perm('activity.view')));

-- ---------- state-changing functions: permission checks ----------
create or replace function split_booking(p_booking_id uuid, p_warehouse_id uuid, p_parcels jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  n int := 0;
  p jsonb;
begin
  perform require_perm('warehouse.manage');
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
  perform require_perm('containers.manage');
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
  perform require_perm('containers.manage');
  update parcels set status = 'in_warehouse', container_id = null
  where id = p_parcel_id and status = 'loaded';
  if not found then raise exception 'Parcel cannot be unloaded'; end if;
end $$;

create or replace function depart_container(p_container_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform require_perm('containers.manage');
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
  perform require_perm('containers.manage');
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
  perform require_perm('containers.manage');
  update parcels set status = 'delivered' where id = p_parcel_id and status = 'arrived';
  if not found then raise exception 'Parcel must have arrived before it can be delivered'; end if;
end $$;

create or replace function cancel_booking(p_booking_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('bookings.cancel');
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A cancellation reason is required';
  end if;
  if exists (select 1 from parcels where booking_id = p_booking_id) then
    raise exception 'Booking already has parcels in the warehouse and cannot be cancelled';
  end if;
  update bookings
  set status = 'cancelled',
      cancellation_reason = btrim(p_reason),
      cancelled_at = now(),
      cancelled_by = auth.uid()
  where id = p_booking_id and status in ('booked', 'collected');
  if not found then raise exception 'Only booked or collected bookings can be cancelled'; end if;
end $$;

-- the old role-name checker is no longer used anywhere
drop function if exists require_role(text[]);
