-- The sender IS the customer. Every booking now has a customer, and the booking follows the customer's details until the pickup is collected.
--   * a new booking is linked to the customer with the same phone, or a new customer is created from it (nothing is left without one)
--   * changing a customer's name or numbers updates their bookings that are still waiting for pickup; collected invoices keep what was true then
--   * correcting the customer's number on a pickup (the driver's "edit numbers") corrects the customer too
-- Everything is added or replaced in place; the running app keeps working.

-- ---------- every new booking gets a customer ----------
create or replace function booking_ensure_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; ph text;
begin
  if exists (select 1 from booking_contacts where booking_id = new.id and role = 'customer') then return new; end if;
  ph := case when new.sender_phone ~ '^\+[1-9][0-9]{6,14}$' then new.sender_phone end;
  if ph is not null then select id into cid from customers where phone = ph order by created_at limit 1; end if;
  if cid is null then
    insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, created_by_name)
    values (btrim(left(new.sender_name, 120)), ph,
            case when new.sender_whatsapp ~ '^\+[1-9][0-9]{6,14}$' and new.sender_whatsapp is distinct from ph then new.sender_whatsapp end,
            case when new.pickup_address ilike 'Legacy invoice%' then null else left(new.pickup_address, 300) end,
            new.geo_lat, new.geo_lng,
            coalesce((select full_name from profiles where id = auth.uid()), 'Automatic, from a new booking'))
    returning id into cid;
  end if;
  insert into booking_contacts (booking_id, role, customer_id) values (new.id, 'customer', cid)
  on conflict (booking_id, role) do nothing;
  return new;
end $$;
drop trigger if exists bookings_z_customer on bookings;
create trigger bookings_z_customer after insert on bookings for each row execute function booking_ensure_customer();

-- ---------- editing a customer updates bookings still waiting for pickup ----------
create or replace function update_customer(p_id uuid, p_name text, p_phone text, p_whatsapp text, p_address text, p_lat double precision, p_lng double precision, p_eid text)
returns void language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  ph text := customer_clean_phone(p_phone, 'phone number');
  wa text := customer_clean_phone(p_whatsapp, 'WhatsApp number');
begin
  perform require_perm('customers.edit');
  if length(nm) not between 1 and 120 then raise exception 'Enter the name'; end if;
  if wa is not null and wa = ph then wa := null; end if;
  update customers
  set full_name = nm, phone = ph, whatsapp = wa, address = nullif(btrim(coalesce(p_address, '')), ''),
      geo_lat = p_lat, geo_lng = p_lng, emirates_id = customer_clean_eid(p_eid), updated_at = now()
  where id = p_id;
  if not found then raise exception 'Customer not found'; end if;

  -- bookings of this customer that are still waiting for pickup follow the new name and numbers
  update bookings b
  set sender_name = nm,
      sender_phone = coalesce(ph, b.sender_phone),
      sender_whatsapp = case when ph is null then b.sender_whatsapp else wa end
  from booking_contacts bc
  where bc.customer_id = p_id and bc.role = 'customer' and bc.booking_id = b.id and b.status = 'booked'
    and (b.sender_name is distinct from nm or b.sender_phone is distinct from coalesce(ph, b.sender_phone)
         or b.sender_whatsapp is distinct from case when ph is null then b.sender_whatsapp else wa end);
end $$;

-- ---------- correcting the number on a pickup corrects the customer too ----------
create or replace function update_contact(p_booking_id uuid, p_party text, p_phone text, p_whatsapp text)
returns void language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if p_party not in ('sender', 'receiver') then raise exception 'Unknown contact'; end if;

  -- office (any booking) or pickup team (only pickups they can see)
  if not has_perm('bookings.edit') then
    if not (has_perm('pickups.edit_contact') and (has_perm('pickups.view_all') or b.driver_id = my_driver_id())) then
      raise exception 'You do not have permission to do this' using errcode = '42501';
    end if;
  end if;

  if p_party = 'sender' and p_phone is null then raise exception 'The customer needs a call number'; end if;
  -- number format is checked by the bookings_validate_contacts trigger
  if p_party = 'sender' then
    update bookings set sender_phone = p_phone, sender_whatsapp = p_whatsapp where id = b.id;
    update customers c
    set phone = p_phone, whatsapp = case when p_whatsapp is not distinct from p_phone then null else p_whatsapp end, updated_at = now()
    from booking_contacts bc
    where bc.booking_id = b.id and bc.role = 'customer' and bc.customer_id = c.id;
  else
    update bookings set receiver_phone = p_phone, receiver_whatsapp = p_whatsapp where id = b.id;
  end if;
end $$;

-- ---------- wording: customer, not sender ----------
update app_settings set
  description = 'When on, the driver must enter the customer''s Emirates ID number before a pickup can be marked collected.'
where key = 'require_id_before_collected';

create or replace function require_id_before_collected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'collected' and old.status is distinct from 'collected'
     and coalesce((select (value)::text = 'true' from app_settings where key = 'require_id_before_collected'), false)
     and not exists (select 1 from id_documents where booking_id = new.id and emirates_id is not null) then
    raise exception 'Enter the customer''s Emirates ID before marking this pickup collected';
  end if;
  return new;
end $$;
