-- Move packages between warehouses (places). Pick the packages, pick the destination: a whole invoice, one package,
-- or packages going to different places in separate moves. Only parcels that are in stock can move.
-- Each move is written on the booking history ("Moved 2 packages from Tarpal-A to Maxpol"), and the old
-- position is cleared because it described the old place.
alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing', 'returned', 'return_deleted', 'moved'));

create or replace function move_parcels(p_parcel_ids uuid[], p_warehouse_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  dest warehouses;
  n_ok int;
  n_moved int;
  actor uuid := auth.uid();
begin
  perform require_perm('warehouse.manage');
  if coalesce(cardinality(p_parcel_ids), 0) = 0 then raise exception 'Select at least one package'; end if;
  select * into dest from warehouses w where w.id = p_warehouse_id;
  if not found then raise exception 'Choose where to move them'; end if;
  if not dest.active then raise exception '% is not active', dest.name; end if;

  select count(*) into n_ok from parcels p where p.id = any (p_parcel_ids) and p.status = 'in_warehouse';
  if n_ok <> cardinality(p_parcel_ids) then
    raise exception 'Only packages that are in the warehouse can be moved';
  end if;

  -- the history, one line per invoice and old place
  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  select p.booking_id, 'moved',
         'Moved ' || count(*) || case when count(*) = 1 then ' package' else ' packages' end ||
         ' from ' || coalesce(w.name, 'no place') || ' to ' || dest.name || ': ' || string_agg(p.barcode, ', ' order by p.seq),
         actor, (select full_name from profiles where id = actor)
  from parcels p
  left join warehouses w on w.id = p.warehouse_id
  where p.id = any (p_parcel_ids) and p.warehouse_id is distinct from dest.id
  group by p.booking_id, w.name;

  update parcels set warehouse_id = dest.id, position = null
  where id = any (p_parcel_ids) and warehouse_id is distinct from dest.id;
  get diagnostics n_moved = row_count;
  return n_moved;
end $$;
revoke execute on function move_parcels(uuid[], uuid) from public, anon;
grant execute on function move_parcels(uuid[], uuid) to authenticated;
