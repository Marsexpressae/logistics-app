-- Entering old records: every step of a shipment can carry its real date, like in an accounting system.
-- Departed, arrived and delivered already could (migration 0034). This adds:
--   * pickup date: a pickup can be moved to a past date
--   * collected date (which is also the invoice date) and payment date: any day up to today
--   * received in the warehouse, and loaded into a container
-- The Activity log keeps the real moment each change was made. Those dates are written by the system and are not touched.
-- Dates in the future are refused.

-- ---------- pickup date: past dates allowed ----------
create or replace function reschedule_booking(p_booking_id uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b     bookings;
  today date := (now() at time zone 'Asia/Dubai')::date;
  actor uuid := auth.uid();
  aname text := (select full_name from profiles where id = auth.uid());
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  -- office (any booking) or pickup team (only pickups they are allowed to see)
  if not has_perm('bookings.reschedule') then
    if not (has_perm('pickups.reschedule')
            and (has_perm('pickups.view_all') or b.driver_id = my_driver_id())) then
      raise exception 'You do not have permission to do this' using errcode = '42501';
    end if;
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;
  if b.status <> 'booked' then raise exception 'Only pickups that have not been collected can be rescheduled'; end if;
  if p_new_date is null then raise exception 'Choose a date'; end if;
  if p_new_date = b.pickup_date then raise exception 'The pickup is already on that date'; end if;

  update bookings set pickup_date = p_new_date where id = b.id;
  insert into booking_events (booking_id, kind, reason, old_date, new_date, actor_id, actor_name)
  values (b.id, 'rescheduled', btrim(p_reason), b.pickup_date, p_new_date, actor, aname);

  -- Nobody needs an alert about a day that has already passed (the usual reason is entering an old record).
  if p_new_date >= today then
    perform notify_other_party(b, 'rescheduled', b.code || ' rescheduled',
      format('Moved from %s to %s. Reason: %s', to_char(b.pickup_date, 'DD Mon YYYY'),
             to_char(p_new_date, 'DD Mon YYYY'), btrim(p_reason)));
  end if;
end $$;

-- ---------- collected date and payment date: never in the future ----------
create or replace function bookings_check_collected_at() returns trigger language plpgsql as $$
begin
  if new.collected_at is distinct from old.collected_at and new.collected_at is not null and new.collected_at > now() + interval '5 minutes' then
    raise exception 'The collection date cannot be in the future';
  end if;
  return new;
end $$;
drop trigger if exists bookings_check_collected_at on bookings;
create trigger bookings_check_collected_at before update of collected_at on bookings
  for each row execute function bookings_check_collected_at();

create or replace function payments_check_date() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' or new.created_at is distinct from old.created_at) and new.created_at > now() + interval '5 minutes' then
    raise exception 'The payment date cannot be in the future';
  end if;
  return new;
end $$;
drop trigger if exists payments_check_date on payments;
create trigger payments_check_date before insert or update of created_at on payments
  for each row execute function payments_check_date();

-- ---------- received in the warehouse ----------
drop function if exists split_booking(uuid, uuid, jsonb);
create or replace function split_booking(p_booking_id uuid, p_warehouse_id uuid, p_parcels jsonb, p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  n int := 0;
  p jsonb;
  next_round int;
  last_seq int;
  ts timestamptz := event_time(p_date);
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
  if ts is not null and b.collected_at is not null and ts::date < (b.collected_at at time zone 'Asia/Dubai')::date then
    raise exception 'Received cannot be before the collection date (%)', (b.collected_at at time zone 'Asia/Dubai')::date;
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

  if ts is not null then -- show the real day in the parcel history
    update parcel_events e set created_at = ts
    where e.status = 'in_warehouse' and e.created_at = now() and e.parcel_id in (select x.id from parcels x where x.booking_id = b.id and x.round = next_round);
    update parcel_events e set created_at = ts - interval '1 minute'
    where e.status = 'repacked' and e.created_at = now() and e.parcel_id in (select x.id from parcels x where x.booking_id = b.id);
  end if;
  return n;
end $$;
revoke execute on function split_booking(uuid, uuid, jsonb, date) from public, anon;
grant execute on function split_booking(uuid, uuid, jsonb, date) to authenticated;

-- ---------- loaded into a container ----------
drop function if exists load_parcel(uuid, text, text);
create or replace function load_parcel(p_container_id uuid, p_barcode text, p_override_reason text default null, p_date date default null)
returns parcels language plpgsql security definer set search_path = public as $$
declare
  c containers;
  p parcels;
  b bookings;
  paid numeric;
  actor uuid := auth.uid();
  ts timestamptz := event_time(p_date);
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

  if coalesce((select (value)::text = 'true' from app_settings where key = 'require_payment_before_loading'), false) then
    select * into b from bookings where id = p.booking_id;
    select coalesce(sum(amount), 0) into paid from payments where booking_id = b.id;
    if b.invoice_amount is null or paid < b.invoice_amount then
      if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
        raise exception 'PAYMENT_REQUIRED % : %', b.code,
          case when b.invoice_amount is null then 'no invoice amount is set yet'
               else 'paid ' || to_char(paid, 'FM999,999,990.00') || ' of ' || to_char(b.invoice_amount, 'FM999,999,990.00') end;
      end if;
      if not has_perm('containers.override_payment') then
        raise exception 'Payment is required before loading % and you cannot override it. Ask a manager.', b.code;
      end if;
      insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
      values (b.id, 'loaded_without_payment', btrim(p_override_reason) || ' (' || p.barcode || ' into ' || c.code || ')',
              actor, (select full_name from profiles where id = actor));
    end if;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;

  if ts is not null then -- show the real day in the parcel history; the earlier step cannot be later than the loading
    update parcel_events e set created_at = ts where e.status = 'loaded' and e.created_at = now() and e.parcel_id = p.id;
    update parcel_events e set created_at = ts - interval '1 minute'
    where e.status = 'in_warehouse' and e.parcel_id = p.id and e.created_at > ts - interval '1 minute';
  end if;
  return p;
end $$;
revoke execute on function load_parcel(uuid, text, text, date) from public, anon;
grant execute on function load_parcel(uuid, text, text, date) to authenticated;
