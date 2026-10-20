-- Warehouse permissions: each warehouse job gets its own permission.
--
-- Until now one permission, warehouse.manage, opened every warehouse job: receiving and splitting, merging and splitting parcels,
-- preparing a return, completing a return and cancelling a return. It was not possible to let someone receive cargo but not
-- return it. Four new permissions split those jobs:
--   warehouse.receive  Receive a booking and split it into parcels (split_booking)
--   parcels.edit       Merge parcels or split a parcel after intake (edit_parcels)
--   returns.prepare    Mark parcels ready for return, and cancel an open return (prepare_return, cancel_return)
--   returns.complete   Hand the parcels over and mark the return done (complete_return)
-- warehouse.manage stays for moving parcels and setting their position. Every role that has warehouse.manage today is given
-- all four new permissions in this same migration, so nobody loses a job and the running app keeps working.

insert into permissions (key, group_name, label, description, sort) values
  ('warehouse.receive', 'Warehouse', 'Receive and split bookings',   'Receive a collected booking into the warehouse, split it into parcels and print labels', 112),
  ('parcels.edit',      'Warehouse', 'Merge and split parcels',      'Merge parcels into one, or split one parcel into several, after intake', 113),
  ('returns.prepare',   'Warehouse', 'Prepare and cancel returns',   'Mark parcels ready for return on a return form, and cancel an open return', 114),
  ('returns.complete',  'Warehouse', 'Complete returns',             'Confirm the parcels were handed over and mark the return as returned', 115)
on conflict (key) do nothing;

insert into role_permissions (role, permission)
select rp.role, k.key
from role_permissions rp
cross join (values ('warehouse.receive'), ('parcels.edit'), ('returns.prepare'), ('returns.complete')) k(key)
where rp.permission = 'warehouse.manage'
on conflict do nothing;

-- The super admin holds every permission.
insert into role_permissions (role, permission)
select 'super_admin', k.key
from (values ('warehouse.receive'), ('parcels.edit'), ('returns.prepare'), ('returns.complete')) k(key)
where exists (select 1 from roles where key = 'super_admin')
on conflict do nothing;

-- ---------- the functions: same bodies as before, only the permission check changes ----------
do $$
declare
  fn text; src text; wanted text;
begin
  for fn, wanted in
    select * from (values
      ('split_booking(uuid,uuid,jsonb,date)',  'warehouse.receive'),
      ('edit_parcels(uuid,uuid[],jsonb,date)', 'parcels.edit'),
      ('prepare_return(uuid,uuid[],text)',     'returns.prepare'),
      ('cancel_return(uuid)',                  'returns.prepare'),
      ('complete_return(uuid,text)',           'returns.complete')
    ) v(fn, wanted)
  loop
    src := pg_get_functiondef(to_regprocedure(fn));
    if src is null or position('require_perm(''warehouse.manage'')' in src) = 0 then
      raise exception 'Expected % to check warehouse.manage', fn;
    end if;
    execute replace(src, 'require_perm(''warehouse.manage'')', format('require_perm(%L)', wanted));
  end loop;
end $$;
