-- Booking additions: pickup date, geo location, and a mandatory cancellation reason.

-- ---------- pickup date ----------
alter table bookings add column pickup_date date;
-- Existing bookings: use the day they were created (UAE time).
update bookings set pickup_date = (created_at at time zone 'Asia/Dubai')::date where pickup_date is null;
alter table bookings alter column pickup_date set not null;
create index bookings_pickup_date_idx on bookings (pickup_date, status);

-- ---------- geo location (optional) ----------
alter table bookings
  add column geo_lat numeric(9, 6) check (geo_lat between -90 and 90),
  add column geo_lng numeric(9, 6) check (geo_lng between -180 and 180),
  add constraint bookings_geo_pair check ((geo_lat is null) = (geo_lng is null));

-- ---------- cancellation reason ----------
alter table bookings
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users (id) on delete set null;

-- Any cancelled booking must carry a reason, however the row is written.
alter table bookings add constraint bookings_cancel_needs_reason
  check (status <> 'cancelled' or length(btrim(coalesce(cancellation_reason, ''))) > 0);

drop function if exists cancel_booking(uuid);

create or replace function cancel_booking(p_booking_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_role('admin', 'staff');
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

revoke execute on function cancel_booking(uuid, text) from public, anon;
grant execute on function cancel_booking(uuid, text) to authenticated;
