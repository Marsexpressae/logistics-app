-- Add, merge and split parcels.
-- Design: docs/superpowers/specs/2026-10-16-parcel-edits-design.md
--
-- Until now the warehouse could only repack ALL of a booking's parcels at once (split_booking). edit_parcels changes only what it is
-- told to: it retires the chosen in-warehouse parcels and creates the new ones, in one locked step. Parcels it does not touch keep
-- their label. The new parcels share the booking's next round, so labels read like BK-1003-R2-P1.
-- Add = no parcel retired, one new. Merge = two or more retired, one new. Split = one retired, two or more new.

-- ---------- the booking history gets a kind for it ----------
alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing', 'returned', 'return_deleted', 'moved', 'parcels_edited'));

-- "P1, P2 and P3" from a list of short labels
create or replace function label_list(labels text[]) returns text
language sql immutable set search_path = public as $$
  select case
    when cardinality(labels) <= 1 then coalesce(labels[1], '')
    else array_to_string(labels[1:cardinality(labels) - 1], ', ') || ' and ' || labels[cardinality(labels)]
  end
$$;

-- ---------- the function ----------
create or replace function edit_parcels(p_booking_id uuid, p_retire_ids uuid[], p_new jsonb, p_warehouse_id uuid default null, p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  retire_n int := coalesce(cardinality(p_retire_ids), 0);
  new_n int := jsonb_array_length(coalesce(p_new, '[]'::jsonb));
  next_round int;
  last_seq int;
  wh uuid := p_warehouse_id;
  old_labels text[];
  new_labels text[];
  actor uuid := auth.uid();
  item jsonb;
  n int := 0;
  barcode_new text;
  ts timestamptz := event_time(p_date);
  dest warehouses;
begin
  perform require_perm('warehouse.manage');
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('collected', 'at_warehouse') then raise exception 'Booking % has not been collected yet', b.code; end if;

  -- the shape: add (nothing retired, one new), merge (two or more retired, one new), split (one retired, two or more new)
  if retire_n = 0 and new_n <> 1 then raise exception 'Add one parcel at a time'; end if;
  if retire_n = 1 and new_n < 2 then raise exception 'Splitting needs two or more new parcels'; end if;
  if retire_n >= 2 and new_n <> 1 then raise exception 'Merging makes exactly one new parcel'; end if;
  if retire_n <> (select count(distinct i) from unnest(coalesce(p_retire_ids, '{}')) i) then raise exception 'The same parcel was chosen twice'; end if;
  if retire_n > 0 and (select count(*) from parcels x where x.id = any (p_retire_ids) and x.booking_id = b.id and x.status = 'in_warehouse') <> retire_n then
    raise exception 'Only parcels of this booking that are in the warehouse can be changed';
  end if;
  for item in select * from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) loop
    if coalesce((item ->> 'weight_kg')::numeric, 0) < 0 then raise exception 'A parcel weight cannot be negative'; end if;
  end loop;

  -- where the new parcels go: the first retired parcel's place, or the chosen one for Add
  if retire_n > 0 then
    select x.warehouse_id into wh from parcels x where x.id = any (p_retire_ids) order by x.seq limit 1;
  end if;
  if wh is null then raise exception 'Choose where the new parcel goes'; end if;
  select * into dest from warehouses w where w.id = wh;
  if not found then raise exception 'Choose where the new parcel goes'; end if;
  if not dest.active then raise exception '% is not active', dest.name; end if;

  if ts is not null and b.collected_at is not null and ts::date < (b.collected_at at time zone 'Asia/Dubai')::date then
    raise exception 'Received cannot be before the collection date (%)', (b.collected_at at time zone 'Asia/Dubai')::date;
  end if;

  select coalesce(max(x.round), 0) + 1, coalesce(max(x.seq), 0) into next_round, last_seq from parcels x where x.booking_id = b.id;

  if retire_n > 0 then
    select array_agg(substr(x.barcode, length(b.code) + 2) order by x.seq) into old_labels
    from parcels x where x.id = any (p_retire_ids) and x.booking_id = b.id;
    update parcels set status = 'repacked', container_id = null where id = any (p_retire_ids) and booking_id = b.id;
  end if;

  new_labels := '{}';
  for item in select * from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) loop
    n := n + 1;
    barcode_new := case when next_round = 1 then b.code || '-P' || n else b.code || '-R' || next_round || '-P' || n end;
    insert into parcels (booking_id, seq, barcode, description, weight_kg, warehouse_id, round)
    values (b.id, last_seq + n, barcode_new, nullif(trim(item ->> 'description'), ''), coalesce((item ->> 'weight_kg')::numeric, 0), wh, next_round);
    new_labels := new_labels || substr(barcode_new, length(b.code) + 2);
  end loop;

  if ts is not null then -- show the real day in the parcel history; the retired parcels were repacked a minute earlier
    update parcel_events e set created_at = ts
    where e.status = 'in_warehouse' and e.created_at = now() and e.parcel_id in (select x.id from parcels x where x.booking_id = b.id and x.round = next_round);
    update parcel_events e set created_at = ts - interval '1 minute'
    where e.status = 'repacked' and e.created_at = now() and e.parcel_id = any (p_retire_ids);
  end if;

  if b.status = 'collected' then update bookings set status = 'at_warehouse' where id = b.id; end if;

  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  values (b.id, 'parcels_edited',
          case
            when retire_n = 0 then 'Added parcel ' || label_list(new_labels)
            when retire_n = 1 then 'Split parcel ' || label_list(old_labels) || ' into new parcels ' || label_list(new_labels)
            else 'Merged parcels ' || label_list(old_labels) || ' into new parcel ' || label_list(new_labels)
          end,
          actor, (select full_name from profiles where id = actor));
  return n;
end $$;
revoke execute on function edit_parcels(uuid, uuid[], jsonb, uuid, date) from public, anon;
grant execute on function edit_parcels(uuid, uuid[], jsonb, uuid, date) to authenticated;
revoke execute on function label_list(text[]) from public, anon;
grant execute on function label_list(text[]) to authenticated;
