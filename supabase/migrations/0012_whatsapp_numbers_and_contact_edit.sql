-- Contact numbers: a call number plus an OPTIONAL WhatsApp number, stored in international format (E.164,
-- e.g. +971567375716). WhatsApp empty = "same as the call number". The pickup team may correct numbers.

alter table bookings
  add column sender_whatsapp   text,
  add column receiver_whatsapp text;

-- ---------- one-off clean-up of numbers typed before this ----------
-- UAE defaults: 05x xxx xxxx, 5x xxx xxxx, 971..., 00971... all become +971...
-- Anything that cannot be understood (e.g. a bare 8-digit placeholder) is left alone for a person to fix.
create or replace function normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if p is null or d = '' then return null; end if;
  if p ~ '^\s*\+' then return '+' || d; end if;                          -- already international
  if d ~ '^00' then return '+' || substr(d, 3); end if;                  -- 00971...
  if d ~ '^971[0-9]{9}$' then return '+' || d; end if;                   -- 971567375716
  if d ~ '^0[0-9]{9}$' then return '+971' || substr(d, 2); end if;       -- 0567375716
  if d ~ '^5[0-9]{8}$' then return '+971' || d; end if;                  -- 567375716
  return p;
end $$;

update bookings
set sender_phone = normalize_phone(sender_phone),
    receiver_phone = normalize_phone(receiver_phone)
where sender_phone is distinct from normalize_phone(sender_phone)
   or receiver_phone is distinct from normalize_phone(receiver_phone);

-- ---------- validation: only when a number is being changed ----------
-- (A table CHECK would also fire for old rows that still hold an unfixable placeholder whenever anything else
-- on the booking changes, e.g. a reschedule. A trigger on the number columns avoids that.)
create or replace function validate_contact_numbers() returns trigger
language plpgsql set search_path = public as $$
declare
  col text;
  val text;
  old_val text;
begin
  foreach col in array array['sender_phone', 'sender_whatsapp', 'receiver_phone', 'receiver_whatsapp'] loop
    val := to_jsonb(new) ->> col;
    old_val := case when tg_op = 'UPDATE' then to_jsonb(old) ->> col else null end;
    if val is not null and val is distinct from old_val and val !~ '^\+[1-9][0-9]{6,14}$' then
      raise exception 'Enter % in international format, for example +971567375716', replace(col, '_', ' ');
    end if;
  end loop;
  -- a WhatsApp number identical to the call number carries no information
  if new.sender_whatsapp is not null and new.sender_whatsapp = new.sender_phone then new.sender_whatsapp := null; end if;
  if new.receiver_whatsapp is not null and new.receiver_whatsapp = new.receiver_phone then new.receiver_whatsapp := null; end if;
  return new;
end $$;

create trigger bookings_validate_contacts before insert or update on bookings
  for each row execute function validate_contact_numbers();

-- ---------- the pickup team can correct numbers on their own pickups ----------
insert into permissions (key, group_name, label, description, sort) values
  ('pickups.edit_contact', 'Pickups', 'Edit contact numbers', 'Correct the call / WhatsApp numbers on pickups they can see', 35);
insert into role_permissions (role, permission) values
  ('super_admin', 'pickups.edit_contact'), ('driver', 'pickups.edit_contact');

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

  if p_party = 'sender' and p_phone is null then raise exception 'The sender needs a call number'; end if;
  -- number format is checked by the bookings_validate_contacts trigger
  if p_party = 'sender' then
    update bookings set sender_phone = p_phone, sender_whatsapp = p_whatsapp where id = b.id;
  else
    update bookings set receiver_phone = p_phone, receiver_whatsapp = p_whatsapp where id = b.id;
  end if;
end $$;

revoke execute on function update_contact(uuid, text, text, text) from public, anon;
grant execute on function update_contact(uuid, text, text, text) to authenticated;
