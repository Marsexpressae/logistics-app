-- A booking or invoice number typed by a person must start with the prefix chosen in Settings > Numbering.
-- Until now the booking screen locked the prefix, but the database itself accepted any typed number.
--
-- Only numbers a person types or changes are checked. Existing numbers with an older prefix (for example imported
-- invoices) stay as they are, and automatic numbers always carry the series prefix. Server work is trusted, as before.
-- Containers are not covered on purpose: a container number is often the shipping line's own number, with no prefix.

create or replace function bookings_numbers_check(p_code text, p_invoice text, p_old_code text, p_old_invoice text, p_is_insert boolean, p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  api boolean := auth.uid() is not null and coalesce(current_setting('app.server_numbering', true), '') <> 'on';
  booking_prefix text;
  invoice_prefix text;
begin
  select prefix into booking_prefix from number_series where kind = 'booking';
  select prefix into invoice_prefix from number_series where kind = 'invoice';

  if p_code is distinct from p_old_code and p_code is not null and not p_is_insert then
    if api and not has_perm('numbers.edit') then raise exception 'You do not have permission to change the booking number'; end if;
    if exists (select 1 from parcels x where x.booking_id = p_booking) then
      raise exception 'The booking number cannot change once parcels exist, because their labels carry it';
    end if;
  elsif p_is_insert and p_code is not null and api and not has_perm('numbers.edit') then
    raise exception 'You do not have permission to type a booking number';
  end if;

  if p_invoice is distinct from p_old_invoice and p_invoice is not null then
    if api and not has_perm('numbers.edit') then raise exception 'You do not have permission to set the invoice number'; end if;
  end if;
  if p_old_invoice is not null and p_invoice is null then raise exception 'An invoice number cannot be removed'; end if;

  -- The prefix is chosen in Settings only, so a person cannot type a different one.
  if api and p_code is not null and (p_is_insert or p_code is distinct from p_old_code)
     and coalesce(booking_prefix, '') <> '' and left(p_code, length(booking_prefix)) <> booking_prefix then
    raise exception 'The booking number must start with % (the prefix is set in Settings)', booking_prefix;
  end if;
  if api and p_invoice is not null and p_invoice is distinct from p_old_invoice
     and coalesce(invoice_prefix, '') <> '' and left(p_invoice, length(invoice_prefix)) <> invoice_prefix then
    raise exception 'The invoice number must start with % (the prefix is set in Settings)', invoice_prefix;
  end if;
end $$;
revoke execute on function bookings_numbers_check(text, text, text, text, boolean, uuid) from public, anon, authenticated;
