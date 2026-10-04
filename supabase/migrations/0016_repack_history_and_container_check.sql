-- 1. Repacking keeps history instead of deleting parcels.
--    Before: split_booking deleted every parcel (and its status history) and re-used the same barcodes, so a label
--    already stuck on cargo could silently point at a different parcel.
--    Now: the old parcels are marked 'repacked' and kept; the new ones get the next "round" and new barcodes.
--      round 1: BK-1002-P1, BK-1002-P2 ...
--      round 2: BK-1002-R2-P1, BK-1002-R2-P2 ...
alter table parcels add column if not exists round int not null default 1;
alter table parcels drop constraint if exists parcels_status_check;
alter table parcels add constraint parcels_status_check
  check (status in ('in_warehouse', 'loaded', 'in_transit', 'arrived', 'delivered', 'repacked'));

create or replace function split_booking(p_booking_id uuid, p_warehouse_id uuid, p_parcels jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  n int := 0;
  p jsonb;
  next_round int;
  last_seq int;
begin
  perform require_perm('warehouse.manage');
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('collected', 'at_warehouse') then
    raise exception 'Booking % has not been collected yet', b.code;
  end if;
  if jsonb_array_length(p_parcels) = 0 then raise exception 'Add at least one parcel'; end if;
  if exists (select 1 from parcels x where x.booking_id = b.id and x.status not in ('in_warehouse', 'repacked')) then
    raise exception 'Some parcels of % have already left the warehouse; cannot repack', b.code;
  end if;
  for p in select * from jsonb_array_elements(p_parcels) loop
    if coalesce((p ->> 'weight_kg')::numeric, 0) < 0 then raise exception 'A parcel weight cannot be negative'; end if;
  end loop;

  select coalesce(max(x.round), 0) + 1, coalesce(max(x.seq), 0) into next_round, last_seq
  from parcels x where x.booking_id = b.id;

  update parcels set status = 'repacked', container_id = null
  where booking_id = b.id and status = 'in_warehouse';

  for p in select * from jsonb_array_elements(p_parcels) loop
    n := n + 1;
    insert into parcels (booking_id, seq, barcode, description, weight_kg, warehouse_id, round)
    values (b.id, last_seq + n,
            case when next_round = 1 then b.code || '-P' || n else b.code || '-R' || next_round || '-P' || n end,
            nullif(trim(p ->> 'description'), ''), coalesce((p ->> 'weight_kg')::numeric, 0), p_warehouse_id, next_round);
  end loop;

  update bookings set status = 'at_warehouse' where id = b.id;
  return n;
end $$;

-- A repacked parcel can no longer be loaded: the message tells the operator to use the new label.
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
  if p.status = 'repacked' then
    raise exception 'Parcel % was repacked. Scan the new label instead.', p.barcode;
  end if;
  if p.status <> 'in_warehouse' then
    raise exception 'Parcel % is not in a warehouse (status: %)', p.barcode, p.status;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;
  return p;
end $$;

-- 2. Container check: for every booking that has a parcel in this container, how many of its parcels are here,
--    and which are still sitting in the warehouse. A 10-parcel invoice with 9 scanned shows "9 of 10" and the missing barcode.
--    Parcels already shipped in another container are not "missing".
create or replace function container_check(p_container_id uuid)
returns table (booking_id uuid, booking_code text, expected int, loaded int, missing text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('containers.view') or has_perm('containers.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  return query
  select b.id, b.code,
         count(*)::int,
         (count(*) filter (where p.container_id = p_container_id))::int,
         coalesce(array_agg(p.barcode order by p.seq) filter (where p.status = 'in_warehouse'), '{}'::text[])
  from bookings b
  join parcels p on p.booking_id = b.id and (p.container_id = p_container_id or p.status = 'in_warehouse')
  where b.id in (select pp.booking_id from parcels pp where pp.container_id = p_container_id)
  group by b.id, b.code
  order by b.code;
end $$;
revoke execute on function container_check(uuid) from public, anon;
grant execute on function container_check(uuid) to authenticated;

-- Departing with parcels missing is refused, unless the operator confirms a partial shipment.
drop function if exists depart_container(uuid);
create or replace function depart_container(p_container_id uuid, p_allow_partial boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  short text;
begin
  perform require_perm('containers.manage');
  if not exists (select 1 from containers c where c.id = p_container_id and c.status = 'loading') then
    raise exception 'Container is not open for loading';
  end if;

  if not p_allow_partial then
    select string_agg(x.booking_code || ' (' || x.loaded || ' of ' || x.expected || ')', ', ') into short
    from container_check(p_container_id) x where cardinality(x.missing) > 0;
    if short is not null then
      raise exception 'Parcels still missing: %. Load them, or confirm a partial shipment.', short;
    end if;
  end if;

  update containers set status = 'departed', departed_at = now() where id = p_container_id;
  update parcels set status = 'in_transit' where container_id = p_container_id and status = 'loaded';
  get diagnostics n = row_count;
  return n;
end $$;

-- 3. Public tracking ignores repacked parcels (only the live ones are shown).
create or replace function track_booking(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'code', b.code,
    'status', b.status,
    'booked_at', b.created_at,
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'barcode', p.barcode,
        'description', p.description,
        'weight_kg', p.weight_kg,
        'status', p.status,
        'warehouse', w.code,
        'container', c.code,
        'updated_at', p.updated_at,
        'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at)
                                             order by e.created_at), '[]'::jsonb)
                   from parcel_events e where e.parcel_id = p.id)
      ) order by p.seq)
      from parcels p
      left join warehouses w on w.id = p.warehouse_id
      left join containers c on c.id = p.container_id
      where p.booking_id = b.id and p.status <> 'repacked'), '[]'::jsonb)
  ) into result
  from bookings b
  where b.code = upper(trim(p_code));

  return result;
end $$;
grant execute on function track_booking(text) to anon, authenticated;
