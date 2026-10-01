-- Receiver details are often not known when the pickup is booked.
-- (receiver_phone and receiver_address were already optional.)
alter table bookings alter column receiver_name drop not null;
