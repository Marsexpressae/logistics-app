-- Who can change a booking's package items is now set on the Roles page, with two permissions:
--   items.edit        change items while the pickup has not been collected yet
--   items.edit_after  change items after collection
-- Defaults match how it worked before: everyone who could edit before still can.
insert into permissions (key, group_name, label, description, sort) values
  ('items.edit',       'Pickups', 'Edit package items (before collection)', 'Add, change or remove items and weights until the pickup is collected', 45),
  ('items.edit_after', 'Pickups', 'Edit package items (after collection)',  'Add, change or remove items and weights after the pickup is collected', 46)
on conflict (key) do nothing;

insert into role_permissions (role, permission)
select role, 'items.edit' from role_permissions where permission in ('bookings.edit', 'pickups.collect')
on conflict do nothing;
insert into role_permissions (role, permission)
select role, 'items.edit_after' from role_permissions where permission = 'bookings.edit'
on conflict do nothing;
insert into role_permissions (role, permission) values ('super_admin', 'items.edit'), ('super_admin', 'items.edit_after')
on conflict do nothing;

-- The database enforces it too, not only the screens.
drop policy if exists items_write on booking_items;
create policy items_write on booking_items for all to authenticated
  using (
    (select has_perm('items.edit_after'))
    or ((select has_perm('items.edit')) and exists (select 1 from bookings b where b.id = booking_id and b.status = 'booked'))
  )
  with check (
    (select has_perm('items.edit_after'))
    or ((select has_perm('items.edit')) and exists (select 1 from bookings b where b.id = booking_id and b.status = 'booked'))
  );
