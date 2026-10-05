-- One click on a booking: save its receiver (name, phone, address as typed on the invoice) as a person, put them in the sender's
-- address book, and link them to the booking as its receiver. The invoice itself is not changed.
create or replace function save_booking_receiver(p_booking_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  sender uuid;
  rid uuid;
  ph text;
  addr text;
begin
  perform require_perm('customers.edit');
  select * into b from bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  select customer_id into sender from booking_contacts where booking_id = b.id and role = 'customer';
  if sender is null then raise exception 'Link a customer to this booking first'; end if;
  if btrim(coalesce(b.receiver_name, '')) = '' then raise exception 'This booking has no receiver name yet'; end if;

  ph := case when b.receiver_phone ~ '^\+[1-9][0-9]{6,14}$' then b.receiver_phone end;
  addr := nullif(left(btrim(coalesce(b.receiver_address, '')), 300), '');
  if ph is not null then select id into rid from customers where phone = ph order by created_at limit 1; end if;
  if rid is null then
    insert into customers (full_name, phone, address, created_by_name)
    values (left(btrim(b.receiver_name), 120), ph, addr, (select full_name from profiles where id = auth.uid()))
    returning id into rid;
  end if;
  if rid <> sender then
    insert into customer_receivers (sender_id, receiver_id, address) values (sender, rid, addr) on conflict do nothing;
  end if;
  insert into booking_contacts (booking_id, role, customer_id) values (b.id, 'receiver', rid)
  on conflict (booking_id, role) do update set customer_id = excluded.customer_id, created_at = now();
  return rid;
end $$;

revoke execute on function save_booking_receiver(uuid) from public, anon;
grant execute on function save_booking_receiver(uuid) to authenticated;
