-- A payment belongs to one booking and one invoice for life. Editing a payment can change the amount, method or note,
-- but never move it to another booking or change the invoice number it was recorded against.
create or replace function payments_protect_links() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is distinct from old.booking_id then
    raise exception 'A payment cannot be moved to another booking';
  end if;
  new.invoice_no := old.invoice_no;
  return new;
end $$;
drop trigger if exists payments_protect on payments;
create trigger payments_protect before update on payments
  for each row execute function payments_protect_links();
