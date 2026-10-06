-- Indexes on relationships that had none. Without one, the database reads the whole table to find the rows that point at a
-- booking, a return or a login (for example when a booking is deleted, or on every driver request via drivers.user_id).
-- The tables are small today, so this changes nothing you can see; it keeps things fast as the data grows.
create index if not exists drivers_user_idx on drivers (user_id);
create index if not exists notifications_booking_idx on notifications (booking_id);
create index if not exists parcels_return_idx on parcels (return_id);
create index if not exists profiles_role_idx on profiles (role);
create index if not exists bookings_cancelled_by_idx on bookings (cancelled_by);
create index if not exists booking_notes_author_idx on booking_notes (author_id);
create index if not exists customer_notes_author_idx on customer_notes (author_id);
