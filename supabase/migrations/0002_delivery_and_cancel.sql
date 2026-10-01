-- Delivery stage + booking cancellation.
-- Parcel lifecycle: in_warehouse -> loaded -> in_transit -> arrived -> delivered

alter table parcels drop constraint if exists parcels_status_check;
alter table parcels add constraint parcels_status_check
  check (status in ('in_warehouse', 'loaded', 'in_transit', 'arrived', 'delivered'));

-- Container reaches its destination: every in_transit parcel becomes arrived.
create or replace function arrive_container(p_container_id uuid)
returns int language plpgsql as $$
declare n int;
begin
  update containers set status = 'arrived'
  where id = p_container_id and status = 'departed';
  if not found then raise exception 'Container has not departed, or has already arrived'; end if;

  update parcels set status = 'arrived'
  where container_id = p_container_id and status = 'in_transit';
  get diagnostics n = row_count;
  return n;
end $$;

-- Parcel handed over to the receiver.
create or replace function deliver_parcel(p_parcel_id uuid)
returns void language plpgsql as $$
begin
  update parcels set status = 'delivered' where id = p_parcel_id and status = 'arrived';
  if not found then raise exception 'Parcel must have arrived before it can be delivered'; end if;
end $$;

-- Cancel a booking that has not yet been split into parcels.
create or replace function cancel_booking(p_booking_id uuid)
returns void language plpgsql as $$
begin
  if exists (select 1 from parcels where booking_id = p_booking_id) then
    raise exception 'Booking already has parcels in the warehouse and cannot be cancelled';
  end if;
  update bookings set status = 'cancelled'
  where id = p_booking_id and status in ('booked', 'collected');
  if not found then raise exception 'Only booked or collected bookings can be cancelled'; end if;
end $$;

-- Indexes on foreign keys / filter columns that were missing.
create index if not exists parcels_warehouse_id_idx on parcels (warehouse_id);
create index if not exists payments_driver_idx      on payments (received_by_driver);
create index if not exists bookings_status_idx      on bookings (status);
