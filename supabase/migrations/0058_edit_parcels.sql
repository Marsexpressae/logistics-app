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


-- ---------- the customer's history labels the new kind ----------
-- Same function as migration 0056 (credit notes and refunds included); only the event labels gain 'Parcels changed'.
create or replace function customer_timeline(p_customer_id uuid, p_limit int default 40, p_offset int default 0)
returns table (r_at timestamptz, r_kind text, r_title text, r_detail text, r_booking_id uuid, r_invoice text, r_actor text)
language plpgsql stable security definer set search_path = public as $$
declare
  lim int := greatest(least(coalesce(p_limit, 40), 200), 1);
  off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform require_perm('customers.view');
  return query
  with mine as (
    select b.id, b.code, coalesce(b.invoice_no, b.code) as ref, b.created_at, b.collected_at, b.cancelled_at, b.cancellation_reason,
           b.sender_name, b.receiver_name, bc.role
    from booking_contacts bc join bookings b on b.id = bc.booking_id
    where bc.customer_id = p_customer_id
  ), ev as (
    select m.created_at as at, 'booking'::text as kind, 'Booking created' as title,
           m.ref || ' · ' || m.sender_name || ' → ' || coalesce(m.receiver_name, 'receiver not set') as detail, m.id as bid, m.ref as ref, null::text as actor
    from mine m
    union all
    select m.collected_at, 'booking', 'Pickup collected', m.ref, m.id, m.ref, null from mine m where m.collected_at is not null
    union all
    select m.cancelled_at, 'booking', 'Booking cancelled', coalesce(m.cancellation_reason, ''), m.id, m.ref, null from mine m where m.cancelled_at is not null
    union all
    select e.created_at, 'event',
           case e.kind when 'rescheduled' then 'Pickup rescheduled' when 'loaded_without_payment' then 'Loaded without full payment'
                       when 'departed_with_missing' then 'Container left with packages missing' when 'returned' then 'Returned to the customer'
                       when 'return_deleted' then 'Return deleted' when 'moved' then 'Packages moved' when 'parcels_edited' then 'Parcels changed' else 'Cancelled' end,
           coalesce(e.reason, ''), e.booking_id, m.ref, e.actor_name
    from booking_events e join mine m on m.id = e.booking_id
    union all
    select pe.created_at, 'package', 'Package ' || p.barcode,
           case pe.status when 'in_warehouse' then 'Received in the warehouse' when 'loaded' then 'Loaded into a container'
                          when 'in_transit' then 'In transit' when 'arrived' then 'Arrived at the destination' when 'delivered' then 'Delivered'
                          when 'repacked' then 'Repacked' when 'ready_for_return' then 'Ready for return' when 'returned' then 'Returned' else pe.status end,
           p.booking_id, m.ref, null
    from parcel_events pe join parcels p on p.id = pe.parcel_id join mine m on m.id = p.booking_id
    union all
    select al.changed_at, 'payment',
           case al.action when 'insert' then 'Payment recorded' when 'update' then 'Payment changed' else 'Payment deleted' end,
           coalesce(al.changes ->> 'amount', '') || ' ' || replace(coalesce(al.changes ->> 'method', ''), '_', ' '), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'payments' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'item', case al.action when 'insert' then 'Item added' else 'Item removed' end,
           (al.changes ->> 'quantity') || ' × ' || coalesce(al.changes ->> 'description', '') || ' (' || coalesce(al.changes ->> 'weight_kg', '') || ' kg)',
           al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'booking_items' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'invoice', 'Invoice number issued', al.changes -> 'invoice_no' ->> 'new', al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_no' and (al.changes -> 'invoice_no' ->> 'old') is null
    union all
    select al.changed_at, 'invoice', 'Invoice amount set', coalesce(al.changes -> 'invoice_amount' ->> 'new', ''), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_amount'
    union all
    select n.created_at, 'note', 'Note on ' || m.ref, n.body, n.booking_id, m.ref, n.author_name
    from booking_notes n join mine m on m.id = n.booking_id
    union all
    select cn.created_at, 'note', 'Note on the customer', cn.body, null, null, cn.author_name
    from customer_notes cn where cn.customer_id = p_customer_id
    union all
    select al.changed_at, 'link',
           case al.action when 'insert' then 'Linked to ' || coalesce(bk.invoice_no, bk.code) || ' as ' || (al.changes ->> 'role')
                          else 'Unlinked from ' || coalesce(bk.invoice_no, bk.code) end,
           '', al.booking_id, coalesce(bk.invoice_no, bk.code), al.actor_name
    from audit_log al left join bookings bk on bk.id = al.booking_id
    where al.table_name = 'booking_contacts' and al.action in ('insert', 'delete') and al.changes ->> 'customer_id' = p_customer_id::text
    union all
    select al.changed_at, 'customer', case al.action when 'insert' then 'Customer created' else 'Details changed' end,
           case when al.action = 'update' then (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(al.changes) k where k <> 'updated_at') else '' end,
           null, null, al.actor_name
    from audit_log al where al.table_name = 'customers' and al.row_id = p_customer_id and al.action in ('insert', 'update')
    union all
    select cn.created_at, 'credit_note', 'Credit note ' || cn.number || ' issued',
           'Invoice lowered by ' || cn.credit_amount || '. ' || cn.reason, cn.booking_id, m.ref, cn.created_by_name
    from credit_notes cn join mine m on m.id = cn.booking_id
    union all
    select cn.voided_at, 'credit_note', 'Credit note ' || cn.number || ' voided', coalesce(cn.void_reason, ''), cn.booking_id, m.ref, cn.voided_by_name
    from credit_notes cn join mine m on m.id = cn.booking_id
    where cn.status = 'void' and cn.voided_at is not null
    union all
    select rf.created_at, 'refund', 'Refund ' || rf.number || ' paid', rf.amount || ' ' || replace(rf.method, '_', ' '), rf.booking_id, m.ref, rf.handed_by_name
    from refunds rf join mine m on m.id = rf.booking_id
    union all
    select rf.voided_at, 'refund', 'Refund ' || rf.number || ' voided', coalesce(rf.void_reason, ''), rf.booking_id, m.ref, rf.voided_by_name
    from refunds rf join mine m on m.id = rf.booking_id
    where rf.status = 'void' and rf.voided_at is not null
  )
  select ev.at, ev.kind, ev.title, ev.detail, ev.bid, ev.ref, ev.actor from ev order by ev.at desc nulls last limit lim offset off;
end $$;
