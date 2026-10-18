-- Sales rep (customer owner): who brought in the business.
-- Design: docs/superpowers/specs/2026-10-18-sales-rep-design.md
--
-- A customer has an owner (the sales rep), and every booking carries the rep who made that sale. Both are chosen from active
-- staff. Anyone who creates a booking or customer may set the rep; changing it afterwards needs "Change the sales rep (owner)".
-- The person's name is copied when the rep is set, so an old record keeps the right name if the person is renamed or removed.

-- ---------- the columns ----------
alter table customers add column if not exists sales_rep_id uuid references profiles (id) on delete set null;
alter table customers add column if not exists sales_rep_name text;
alter table bookings add column if not exists sales_rep_id uuid references profiles (id) on delete set null;
alter table bookings add column if not exists sales_rep_name text;
create index if not exists customers_sales_rep_idx on customers (sales_rep_id);
create index if not exists bookings_sales_rep_idx on bookings (sales_rep_id);

-- ---------- the name is copied from the person, and only active staff can be chosen ----------
create or replace function set_sales_rep_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is null then
    -- cleared on purpose: the name goes too. When the person is removed, the foreign key sets the id to null from inside
    -- another trigger (depth above 1): then the name stays on the old record.
    if not (tg_op = 'UPDATE' and old.sales_rep_id is not null and pg_trigger_depth() > 1) then new.sales_rep_name := null; end if;
  elsif tg_op = 'INSERT' or new.sales_rep_id is distinct from old.sales_rep_id then
    select pr.full_name into new.sales_rep_name from profiles pr where pr.id = new.sales_rep_id and pr.active;
    if not found then raise exception 'That person is not active staff'; end if;
  end if;
  return new;
end $$;

-- ---------- changing the rep of an existing record needs the permission ----------
-- Creating a record with a rep needs nothing extra. A change made with nobody signed in (a migration, maintenance) is allowed.
create or replace function require_sales_rep_permission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sales_rep_id is distinct from old.sales_rep_id and auth.uid() is not null and not has_perm('sales_rep.change') then
    raise exception 'Only managers can change the sales rep';
  end if;
  return new;
end $$;

-- the names are set after the permission is checked (trigger names run in alphabetical order)
drop trigger if exists customers_a_sales_rep_permission on customers;
create trigger customers_a_sales_rep_permission before update of sales_rep_id on customers
  for each row execute function require_sales_rep_permission();
drop trigger if exists customers_b_sales_rep_name on customers;
create trigger customers_b_sales_rep_name before insert or update of sales_rep_id on customers
  for each row execute function set_sales_rep_name();
drop trigger if exists bookings_a_sales_rep_permission on bookings;
create trigger bookings_a_sales_rep_permission before update of sales_rep_id on bookings
  for each row execute function require_sales_rep_permission();
drop trigger if exists bookings_b_sales_rep_name on bookings;
create trigger bookings_b_sales_rep_name before insert or update of sales_rep_id on bookings
  for each row execute function set_sales_rep_name();

-- ---------- the permission ----------
insert into permissions (key, group_name, label, description, sort) values
  ('sales_rep.change', 'Customers', 'Change the sales rep (owner)', 'Choose or change who owns a customer and who made a booking', 95)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values ('manager', 'sales_rep.change'), ('super_admin', 'sales_rep.change')
on conflict do nothing;

-- ---------- a customer's owner is changed through a function (the table cannot be written directly) ----------
create or replace function set_customer_sales_rep(p_customer_id uuid, p_sales_rep_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('sales_rep.change') then raise exception 'Only managers can change the sales rep'; end if;
  update customers set sales_rep_id = p_sales_rep_id where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
end $$;
revoke execute on function set_customer_sales_rep(uuid, uuid) from public, anon;
grant execute on function set_customer_sales_rep(uuid, uuid) to authenticated;

-- ---------- who can be chosen ----------
create or replace function sales_rep_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('bookings.create') or has_perm('customers.edit') or has_perm('sales_rep.change')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name) order by pr.full_name) from profiles pr where pr.active), '[]'::jsonb);
end $$;
revoke execute on function sales_rep_choices() from public, anon;
grant execute on function sales_rep_choices() to authenticated;


-- ---------- a new customer gets an owner ----------
-- A customer created from a new booking (or from a booking by hand) gets that booking's rep; a customer added by hand gets the person adding
-- them. A customer who already exists is never changed by a later booking.
create or replace function booking_ensure_customer()
 RETURNS trigger
 language plpgsql security definer set search_path = public as $$
declare cid uuid; ph text;
begin
  if exists (select 1 from booking_contacts where booking_id = new.id and role = 'customer') then return new; end if;
  ph := case when new.sender_phone ~ '^\+[1-9][0-9]{6,14}$' then new.sender_phone end;
  if ph is not null then select id into cid from customers where phone = ph order by created_at limit 1; end if;
  if cid is null then
    insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, created_by_name, sales_rep_id)
    values (btrim(left(new.sender_name, 120)), ph,
            case when new.sender_whatsapp ~ '^\+[1-9][0-9]{6,14}$' and new.sender_whatsapp is distinct from ph then new.sender_whatsapp end,
            case when new.pickup_address ilike 'Legacy invoice%' then null else left(new.pickup_address, 300) end,
            new.geo_lat, new.geo_lng,
            coalesce((select full_name from profiles where id = auth.uid()), 'Automatic, from a new booking'), new.sales_rep_id)
    returning id into cid;
  end if;
  insert into booking_contacts (booking_id, role, customer_id) values (new.id, 'customer', cid)
  on conflict (booking_id, role) do nothing;
  return new;
end $$;

create or replace function create_customer_from_booking(p_booking_id uuid)
 RETURNS uuid
 language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  new_id uuid;
  actor uuid := auth.uid();
begin
  perform require_perm('customers.edit');
  select * into b from bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, created_by_name, sales_rep_id)
  values (btrim(left(b.sender_name, 120)),
          case when b.sender_phone ~ '^\+[1-9][0-9]{6,14}$' then b.sender_phone end,
          case when b.sender_whatsapp ~ '^\+[1-9][0-9]{6,14}$' then b.sender_whatsapp end,
          case when b.pickup_address ilike 'Legacy invoice%' then null else left(b.pickup_address, 300) end,
          b.geo_lat, b.geo_lng, (select full_name from profiles where id = actor), b.sales_rep_id)
  returning id into new_id;
  insert into booking_contacts (booking_id, role, customer_id) values (b.id, 'customer', new_id)
  on conflict (booking_id, role) do update set customer_id = excluded.customer_id, created_at = now();
  return new_id;
end $$;

create or replace function create_customer(p_name text, p_phone text, p_whatsapp text, p_address text, p_lat double precision, p_lng double precision, p_eid text)
 RETURNS uuid
 language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  ph text := customer_clean_phone(p_phone, 'phone number');
  wa text := customer_clean_phone(p_whatsapp, 'WhatsApp number');
  actor uuid := auth.uid();
  new_id uuid;
begin
  perform require_perm('customers.edit');
  if length(nm) not between 1 and 120 then raise exception 'Enter the name'; end if;
  if wa is not null and wa = ph then wa := null; end if;
  insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, emirates_id, created_by_name, sales_rep_id)
  values (nm, ph, wa, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, customer_clean_eid(p_eid), (select full_name from profiles where id = actor), actor)
  returning id into new_id;
  return new_id;
end $$;

