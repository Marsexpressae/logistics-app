-- A container with missing parcels can only depart if an authorised person gives a reason, and it is logged.
insert into permissions (key, group_name, label, description, sort) values
  ('containers.override_departure', 'Containers', 'Depart with missing parcels',
   'Send a container even though some parcels of an invoice are not loaded (a reason is recorded on each booking)', 86)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('super_admin', 'containers.override_departure'), ('manager', 'containers.override_departure')
on conflict do nothing;

alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing'));

drop function if exists depart_container(uuid, boolean);
drop function if exists depart_container(uuid);
create or replace function depart_container(p_container_id uuid, p_override_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  short text;
  c containers;
  r record;
  actor uuid := auth.uid();
begin
  perform require_perm('containers.manage');
  select * into c from containers where id = p_container_id and status = 'loading';
  if not found then raise exception 'Container is not open for loading'; end if;

  select string_agg(x.booking_code || ' (' || x.loaded || ' of ' || x.expected || ')', ', ') into short
  from container_check(p_container_id) x where cardinality(x.missing) > 0;

  if short is not null then
    if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'PARCELS_MISSING : %', short;
    end if;
    if not has_perm('containers.override_departure') then
      raise exception 'Parcels are missing (%). Only a manager can send a container with missing parcels.', short;
    end if;
    for r in select * from container_check(p_container_id) x where cardinality(x.missing) > 0 loop
      insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
      values (r.booking_id, 'departed_with_missing',
              btrim(p_override_reason) || ' (' || c.code || ' left without ' || array_to_string(r.missing, ', ') || ')',
              actor, (select full_name from profiles where id = actor));
    end loop;
  end if;

  update containers set status = 'departed', departed_at = now() where id = p_container_id;
  update parcels set status = 'in_transit' where container_id = p_container_id and status = 'loaded';
  get diagnostics n = row_count;
  return n;
end $$;
