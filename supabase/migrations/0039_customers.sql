-- Customer records (step 1 of the customer module; see "Customer module spec" in the Mars ERP notes).
--
--   * A customer is a PERSON (the one who pays and signs the invoice). The same person record can also be a booker or a
--     receiver on other invoices: people are linked to a booking with a role.
--   * The booking keeps its own copy of the sender's name, phone and address as typed (history stays correct, ADR-0003).
--     Linking a customer never changes what the invoice says.
--   * Bookings can start without a customer and be linked later; a to-do list shows the ones without.
--   * The same phone number or Emirates ID flags a possible duplicate (step 2); nothing blocks a second record.
--   * People who can create bookings can create and edit customers; only managers merge or delete (step 2).

-- ---------- permissions ----------
insert into permissions (key, group_name, label, description, sort) values
  ('customers.view',   'Customers', 'View customers',          'See customer records, their history, and find them in search', 90),
  ('customers.edit',   'Customers', 'Create and edit customers', 'Add customers, change their details, link them to bookings, write customer notes', 91),
  ('customers.manage', 'Customers', 'Merge and delete customers', 'Merge two records of the same person, or delete a customer', 92)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('super_admin', 'customers.view'), ('super_admin', 'customers.edit'), ('super_admin', 'customers.manage'),
  ('manager', 'customers.view'), ('manager', 'customers.edit'), ('manager', 'customers.manage'),
  ('staff', 'customers.view'), ('staff', 'customers.edit')
on conflict do nothing;

-- ---------- tables ----------
create table customers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(btrim(full_name)) between 1 and 120),
  phone           text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  whatsapp        text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{6,14}$'), -- only when different from the phone
  address         text check (address is null or length(address) <= 300),
  geo_lat         double precision,
  geo_lng         double precision,
  emirates_id     text check (emirates_id is null or emirates_id ~ '^784-[0-9]{4}-[0-9]{7}-[0-9]$'),
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index customers_phone_idx on customers (phone);
create index customers_eid_idx on customers (emirates_id);

-- who is linked to which booking, and in what role (one person per role per booking)
create table booking_contacts (
  booking_id  uuid not null references bookings (id) on delete cascade,
  role        text not null check (role in ('customer', 'booker', 'receiver')),
  customer_id uuid not null references customers (id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (booking_id, role)
);
create index booking_contacts_customer_idx on booking_contacts (customer_id);

create table customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id),
  author_name text not null default '',
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index customer_notes_customer_idx on customer_notes (customer_id, created_at desc);

-- ---------- row security: read with customers.view; every change goes through the functions below ----------
alter table customers enable row level security;
alter table booking_contacts enable row level security;
alter table customer_notes enable row level security;

create policy customers_select on customers for select to authenticated using ((select has_perm('customers.view')));
create policy booking_contacts_select on booking_contacts for select to authenticated using ((select has_perm('customers.view')));
create policy customer_notes_select on customer_notes for select to authenticated using ((select has_perm('customers.view')));
create policy customer_notes_insert on customer_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and (select has_perm('notes.write')) and (select has_perm('customers.view')));

revoke all on customers, booking_contacts, customer_notes from anon, authenticated;
grant select on customers, booking_contacts to authenticated;
grant select, insert on customer_notes to authenticated; -- notes cannot be edited or deleted, like notes on a job

create or replace function customer_notes_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_name := coalesce(nullif((select p.full_name from profiles p where p.id = new.author_id), ''), 'Team member');
  new.body := btrim(new.body);
  return new;
end $$;
create trigger customer_notes_before before insert on customer_notes
  for each row execute function customer_notes_before();

-- ---------- build the customers from the bookings that exist today (same phone = same customer) ----------
do $$
declare r record; cid uuid;
begin
  for r in
    select distinct on (b.sender_phone) b.sender_phone, b.sender_name, b.sender_whatsapp, b.pickup_address, b.geo_lat, b.geo_lng
    from bookings b
    where b.sender_phone is not null and b.sender_phone ~ '^\+[1-9][0-9]{6,14}$'
    order by b.sender_phone, b.created_at desc
  loop
    insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, created_by_name)
    values (btrim(left(r.sender_name, 120)), r.sender_phone,
            case when r.sender_whatsapp ~ '^\+[1-9][0-9]{6,14}$' then r.sender_whatsapp end,
            case when r.pickup_address ilike 'Legacy invoice%' then null else left(r.pickup_address, 300) end, -- old paper invoices carry a placeholder address
            r.geo_lat, r.geo_lng, 'Automatic, from the existing bookings')
    returning id into cid;
    insert into booking_contacts (booking_id, role, customer_id)
    select b.id, 'customer', cid from bookings b where b.sender_phone = r.sender_phone;
  end loop;
end $$;

-- every change is recorded in the Activity log
create trigger audit_customers after insert or update or delete on customers for each row execute function audit_row();
create trigger audit_booking_contacts after insert or update or delete on booking_contacts for each row execute function audit_row();

-- ---------- helpers ----------
create or replace function customer_clean_eid(p_eid text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p_eid, ''), '[^0-9]', '', 'g');
begin
  if d = '' then return null; end if;
  if d !~ '^784[0-9]{12}$' then raise exception 'An Emirates ID has 15 digits and starts with 784, for example 784-1990-1234567-1'; end if;
  return substr(d, 1, 3) || '-' || substr(d, 4, 4) || '-' || substr(d, 8, 7) || '-' || substr(d, 15, 1);
end $$;

create or replace function customer_clean_phone(p_phone text, p_what text) returns text
language plpgsql immutable as $$
declare n text := normalize_phone(nullif(btrim(coalesce(p_phone, '')), ''));
begin
  if n is null then return null; end if;
  if n !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Enter the % in international format, for example +971567375716', p_what; end if;
  return n;
end $$;
revoke execute on function customer_clean_eid(text), customer_clean_phone(text, text) from public, anon, authenticated;

-- ---------- create, edit, link ----------
create or replace function create_customer(p_name text, p_phone text, p_whatsapp text, p_address text, p_lat double precision, p_lng double precision, p_eid text)
returns uuid language plpgsql security definer set search_path = public as $$
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
  insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, emirates_id, created_by_name)
  values (nm, ph, wa, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, customer_clean_eid(p_eid), (select full_name from profiles where id = actor))
  returning id into new_id;
  return new_id;
end $$;

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
end $$;

-- link a person to a booking in a role; pass a null customer to remove the link
create or replace function link_booking_customer(p_booking_id uuid, p_customer_id uuid, p_role text default 'customer')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('customers.edit');
  if p_role not in ('customer', 'booker', 'receiver') then raise exception 'Unknown role'; end if;
  if not exists (select 1 from bookings b where b.id = p_booking_id) then raise exception 'Booking not found'; end if;
  if p_customer_id is null then
    delete from booking_contacts where booking_id = p_booking_id and role = p_role;
    return;
  end if;
  if not exists (select 1 from customers c where c.id = p_customer_id) then raise exception 'Customer not found'; end if;
  insert into booking_contacts (booking_id, role, customer_id) values (p_booking_id, p_role, p_customer_id)
  on conflict (booking_id, role) do update set customer_id = excluded.customer_id, created_at = now();
end $$;

-- a new customer from what the booking already says about the sender (name, phone, WhatsApp, address, pin), linked as the customer
create or replace function create_customer_from_booking(p_booking_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  new_id uuid;
  actor uuid := auth.uid();
begin
  perform require_perm('customers.edit');
  select * into b from bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  insert into customers (full_name, phone, whatsapp, address, geo_lat, geo_lng, created_by_name)
  values (btrim(left(b.sender_name, 120)),
          case when b.sender_phone ~ '^\+[1-9][0-9]{6,14}$' then b.sender_phone end,
          case when b.sender_whatsapp ~ '^\+[1-9][0-9]{6,14}$' then b.sender_whatsapp end,
          case when b.pickup_address ilike 'Legacy invoice%' then null else left(b.pickup_address, 300) end,
          b.geo_lat, b.geo_lng, (select full_name from profiles where id = actor))
  returning id into new_id;
  insert into booking_contacts (booking_id, role, customer_id) values (b.id, 'customer', new_id)
  on conflict (booking_id, role) do update set customer_id = excluded.customer_id, created_at = now();
  return new_id;
end $$;

-- ---------- search: by name, mobile (any format), Emirates ID, address, or any invoice or booking number of theirs ----------
create or replace function customer_matches(c customers, p_words text[], p_whole_phone text, p_whole_eid text) returns boolean
language sql stable as $$
  select
    (p_whole_phone is not null and (search_digits(c.phone) like '%' || p_whole_phone || '%' or search_digits(c.whatsapp) like '%' || p_whole_phone || '%'))
    or (p_whole_eid is not null and regexp_replace(coalesce(c.emirates_id, ''), '\D', '', 'g') like '%' || p_whole_eid || '%')
    or not exists (
      select 1 from unnest(p_words) w
      where not (
           c.full_name ilike search_like(w)
        or coalesce(c.address, '') ilike search_like(w)
        or coalesce(c.emirates_id, '') ilike search_like(w)
        or (w ~ '^[0-9+()-]+$' and length(search_digits(w)) >= 4 and (
              search_digits(c.phone) like '%' || search_digits(w) || '%'
           or search_digits(c.whatsapp) like '%' || search_digits(w) || '%'))
        or exists (
              select 1 from booking_contacts bc join bookings b on b.id = bc.booking_id
              where bc.customer_id = c.id and (coalesce(b.invoice_no, '') ilike search_like(w) or b.code ilike search_like(w)))
      )
    )
$$;

create or replace function search_customers(p_query text, p_limit int default 8) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  q text := btrim(coalesce(p_query, ''));
  words text[];
  lim int := greatest(least(coalesce(p_limit, 8), 50), 1);
  whole_phone text := null;
  whole_eid text := null;
  res jsonb;
  total bigint;
begin
  if length(regexp_replace(q, '\s', '', 'g')) < 2 then return jsonb_build_object('customers', '[]'::jsonb, 'total', 0); end if;
  words := regexp_split_to_array(lower(q), '\s+');
  if q ~ '^[0-9+() -]+$' and length(search_digits(q)) >= 4 then whole_phone := search_digits(q); end if;
  if q ~ '^[0-9 -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 6 then whole_eid := regexp_replace(q, '\D', '', 'g'); end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select c.id, c.full_name, c.phone, c.whatsapp, c.address, c.geo_lat, c.geo_lng, c.emirates_id,
           (select count(*) from booking_contacts bc where bc.customer_id = c.id and bc.role = 'customer') as invoices,
           (select b.invoice_no from booking_contacts bc join bookings b on b.id = bc.booking_id
             where bc.customer_id = c.id and bc.role = 'customer' and b.invoice_no is not null order by b.created_at desc limit 1) as last_invoice,
           count(*) over () as total
    from customers c
    where customer_matches(c, words, whole_phone, whole_eid)
    order by c.full_name
    limit lim
  ) r;
  return jsonb_build_object('customers', res, 'total', total);
end $$;

-- ---------- the timeline: everything that happened, across all of the customer's invoices ----------
create or replace function customer_timeline(p_customer_id uuid, p_limit int default 40, p_offset int default 0)
returns table (r_at timestamptz, r_kind text, r_title text, r_detail text, r_booking_id uuid, r_invoice text, r_actor text)
language plpgsql stable security definer set search_path = public as $$
declare
  lim int := greatest(least(coalesce(p_limit, 40), 200), 1);
  off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform require_perm('customers.view');
  return query
  with mine as (
    select b.id, b.code, coalesce(b.invoice_no, b.code) as ref, b.created_at, b.collected_at, b.cancelled_at, b.cancellation_reason,
           b.sender_name, b.receiver_name, bc.role
    from booking_contacts bc join bookings b on b.id = bc.booking_id
    where bc.customer_id = p_customer_id
  ), ev as (
    select m.created_at as at, 'booking'::text as kind, 'Booking created' as title,
           m.ref || ' · ' || m.sender_name || ' → ' || coalesce(m.receiver_name, 'receiver not set') as detail, m.id as bid, m.ref as ref, null::text as actor
    from mine m
    union all
    select m.collected_at, 'booking', 'Pickup collected', m.ref, m.id, m.ref, null from mine m where m.collected_at is not null
    union all
    select m.cancelled_at, 'booking', 'Booking cancelled', coalesce(m.cancellation_reason, ''), m.id, m.ref, null from mine m where m.cancelled_at is not null
    union all
    select e.created_at, 'event',
           case e.kind when 'rescheduled' then 'Pickup rescheduled' when 'loaded_without_payment' then 'Loaded without full payment'
                       when 'departed_with_missing' then 'Container left with packages missing' when 'returned' then 'Returned to the customer'
                       when 'return_deleted' then 'Return deleted' when 'moved' then 'Packages moved' else 'Cancelled' end,
           coalesce(e.reason, ''), e.booking_id, m.ref, e.actor_name
    from booking_events e join mine m on m.id = e.booking_id
    union all
    select pe.created_at, 'package', 'Package ' || p.barcode,
           case pe.status when 'in_warehouse' then 'Received in the warehouse' when 'loaded' then 'Loaded into a container'
                          when 'in_transit' then 'In transit' when 'arrived' then 'Arrived at the destination' when 'delivered' then 'Delivered'
                          when 'repacked' then 'Repacked' when 'ready_for_return' then 'Ready for return' when 'returned' then 'Returned' else pe.status end,
           p.booking_id, m.ref, null
    from parcel_events pe join parcels p on p.id = pe.parcel_id join mine m on m.id = p.booking_id
    union all
    select al.changed_at, 'payment',
           case al.action when 'insert' then 'Payment recorded' when 'update' then 'Payment changed' else 'Payment deleted' end,
           coalesce(al.changes ->> 'amount', '') || ' ' || replace(coalesce(al.changes ->> 'method', ''), '_', ' '), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'payments' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'item', case al.action when 'insert' then 'Item added' else 'Item removed' end,
           (al.changes ->> 'quantity') || ' × ' || coalesce(al.changes ->> 'description', '') || ' (' || coalesce(al.changes ->> 'weight_kg', '') || ' kg)',
           al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'booking_items' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'invoice', 'Invoice number issued', al.changes -> 'invoice_no' ->> 'new', al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_no' and (al.changes -> 'invoice_no' ->> 'old') is null
    union all
    select al.changed_at, 'invoice', 'Invoice amount set', coalesce(al.changes -> 'invoice_amount' ->> 'new', ''), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_amount'
    union all
    select n.created_at, 'note', 'Note on ' || m.ref, n.body, n.booking_id, m.ref, n.author_name
    from booking_notes n join mine m on m.id = n.booking_id
    union all
    select cn.created_at, 'note', 'Note on the customer', cn.body, null, null, cn.author_name
    from customer_notes cn where cn.customer_id = p_customer_id
    union all
    select al.changed_at, 'link',
           case al.action when 'insert' then 'Linked to ' || coalesce(bk.invoice_no, bk.code) || ' as ' || (al.changes ->> 'role')
                          else 'Unlinked from ' || coalesce(bk.invoice_no, bk.code) end,
           '', al.booking_id, coalesce(bk.invoice_no, bk.code), al.actor_name
    from audit_log al left join bookings bk on bk.id = al.booking_id
    where al.table_name = 'booking_contacts' and al.action in ('insert', 'delete') and al.changes ->> 'customer_id' = p_customer_id::text
    union all
    select al.changed_at, 'customer', case al.action when 'insert' then 'Customer created' else 'Details changed' end,
           case when al.action = 'update' then (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(al.changes) k where k <> 'updated_at') else '' end,
           null, null, al.actor_name
    from audit_log al where al.table_name = 'customers' and al.row_id = p_customer_id and al.action in ('insert', 'update')
  )
  select ev.at, ev.kind, ev.title, ev.detail, ev.bid, ev.ref, ev.actor from ev order by ev.at desc nulls last limit lim offset off;
end $$;

-- ---------- the to-do list: bookings with no customer yet ----------
create or replace function bookings_without_customer(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; total bigint;
begin
  perform require_perm('customers.view');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select b.id, b.code, b.invoice_no, b.sender_name, b.sender_phone, b.pickup_address, b.status, b.created_at, count(*) over () as total
    from bookings b
    where b.status <> 'cancelled' and not exists (select 1 from booking_contacts bc where bc.booking_id = b.id and bc.role = 'customer')
    order by b.created_at desc
    limit greatest(least(coalesce(p_limit, 100), 500), 1)
  ) r;
  return jsonb_build_object('bookings', res, 'total', total);
end $$;

-- ---------- access ----------
revoke execute on function customer_matches(customers, text[], text, text) from public, anon;
revoke execute on function search_customers(text, int), customer_timeline(uuid, int, int), bookings_without_customer(int),
  create_customer(text, text, text, text, double precision, double precision, text),
  update_customer(uuid, text, text, text, text, double precision, double precision, text),
  link_booking_customer(uuid, uuid, text), create_customer_from_booking(uuid) from public, anon;
grant execute on function customer_matches(customers, text[], text, text) to authenticated;
grant execute on function search_customers(text, int), customer_timeline(uuid, int, int), bookings_without_customer(int),
  create_customer(text, text, text, text, double precision, double precision, text),
  update_customer(uuid, text, text, text, text, double precision, double precision, text),
  link_booking_customer(uuid, uuid, text), create_customer_from_booking(uuid) to authenticated;
