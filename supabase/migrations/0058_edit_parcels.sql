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
begin
  perform require_perm('warehouse.manage');
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  select coalesce(max(x.round), 0) + 1, coalesce(max(x.seq), 0) into next_round, last_seq from parcels x where x.booking_id = b.id;

  if retire_n > 0 then
    select array_agg(substr(x.barcode, length(b.code) + 2) order by x.seq), (array_agg(x.warehouse_id order by x.seq))[1]
      into old_labels, wh
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
