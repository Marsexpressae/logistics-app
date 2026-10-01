-- At booking time the bill and payment method are not known yet.
--   * amount_due becomes estimated_bill (an approximate figure, optional)
--   * invoice_amount holds the real bill, filled in once the invoice is raised
--   * payment method is recorded per payment (payments.method), so the booking-level column goes

alter table bookings rename column amount_due to estimated_bill;
alter table bookings alter column estimated_bill drop not null;
alter table bookings alter column estimated_bill drop default;
update bookings set estimated_bill = null where estimated_bill = 0;

alter table bookings add column invoice_amount numeric(12,2) check (invoice_amount >= 0);

alter table bookings drop column payment_method;
