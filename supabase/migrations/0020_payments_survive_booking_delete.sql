-- Money must never disappear. Deleting a booking used to delete its payments with it (on delete cascade).
-- Now a booking that has payments cannot be deleted; cancel it instead (its payments stay in the accounts).
alter table payments drop constraint if exists payments_booking_id_fkey;
alter table payments add constraint payments_booking_id_fkey
  foreign key (booking_id) references bookings (id) on delete restrict;
