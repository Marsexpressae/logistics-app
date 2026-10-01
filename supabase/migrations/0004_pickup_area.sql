-- Pickups are organised by area (emirate). To add an area later, extend this check in a new migration.
alter table bookings add column pickup_area text;
update bookings set pickup_area = 'Dubai' where pickup_area is null;
alter table bookings alter column pickup_area set not null;
alter table bookings add constraint bookings_pickup_area_check
  check (pickup_area in ('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'));
create index bookings_pickup_area_idx on bookings (pickup_area, status);
