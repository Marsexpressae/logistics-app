-- Customer module, step 2: people and identity.
--   * receivers' address book (a receiver is a person record too)
--   * Emirates ID number and photo, taken by the driver at pickup (private storage); optional Settings switch makes it required
--   * warning flag with a note, shown on the customer and on every one of their invoices
--   * possible duplicates (same phone or same Emirates ID), merge and delete (managers only)
-- Everything here is added next to what exists; the running app keeps working.

-- ---------- permission for the ID photo ----------
insert into permissions (key, group_name, label, description, sort) values
  ('customers.id_photo', 'Customers', 'See and add Emirates ID photos', 'Record the Emirates ID and photo at pickup, and see them on the jobs you can open', 93)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('super_admin', 'customers.id_photo'), ('manager', 'customers.id_photo'), ('staff', 'customers.id_photo'), ('driver', 'customers.id_photo')
on conflict do nothing;

-- ---------- warning flag ----------
alter table customers add column if not exists warning_note text check (warning_note is null or length(warning_note) <= 300);

create or replace function set_customer_warning(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('customers.edit');
  update customers set warning_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
  if not found then raise exception 'Customer not found'; end if;
end $$;

-- the warning on a booking's customer, for anyone who can open the booking (drivers included)
create or replace function booking_warning(p_booking_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('bookings.view') or has_perm('pickups.view_all') or has_perm('pickups.view_own') or has_perm('warehouse.view')) then
    return null;
  end if;
  return (select c.warning_note from booking_contacts bc join customers c on c.id = bc.customer_id
          where bc.booking_id = p_booking_id and bc.role = 'customer');
end $$;

-- ---------- receivers' address book ----------
create table customer_receivers (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references customers (id) on delete cascade,
  receiver_id uuid not null references customers (id) on delete cascade,
  address     text check (address is null or length(address) <= 300),
  created_at  timestamptz not null default now()
);
create unique index customer_receivers_unique on customer_receivers (sender_id, receiver_id, (coalesce(address, '')));
create index customer_receivers_receiver_idx on customer_receivers (receiver_id);
alter table customer_receivers enable row level security;
create policy customer_receivers_select on customer_receivers for select to authenticated using ((select has_perm('customers.view')));
revoke all on customer_receivers from anon, authenticated;
grant select on customer_receivers to authenticated;
create trigger audit_customer_receivers after insert or update or delete on customer_receivers for each row execute function audit_row();

-- add a receiver to a sender's address book; the receiver is found by phone, or created as a new person
create or replace function add_receiver(p_sender uuid, p_name text, p_phone text, p_address text, p_receiver_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid := p_receiver_id;
  ph text := customer_clean_phone(p_phone, 'phone number');
  addr text := nullif(btrim(coalesce(p_address, '')), '');
  nm text := btrim(coalesce(p_name, ''));
  entry uuid;
begin
  perform require_perm('customers.edit');
  if not exists (select 1 from customers where id = p_sender) then raise exception 'Customer not found'; end if;
  if rid is null then
    if length(nm) not between 1 and 120 then raise exception 'Enter the receiver''s name'; end if;
    if ph is not null then select id into rid from customers where phone = ph order by created_at limit 1; end if;
    if rid is null then
      insert into customers (full_name, phone, address, created_by_name)
      values (nm, ph, addr, (select full_name from profiles where id = auth.uid())) returning id into rid;
    end if;
  elsif not exists (select 1 from customers where id = rid) then
    raise exception 'Customer not found';
  end if;
  if rid = p_sender then raise exception 'A customer cannot be their own receiver'; end if;
  insert into customer_receivers (sender_id, receiver_id, address) values (p_sender, rid, addr)
  on conflict (sender_id, receiver_id, (coalesce(address, ''))) do update set address = excluded.address
  returning id into entry;
  return entry;
end $$;

create or replace function remove_receiver(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('customers.edit');
  delete from customer_receivers where id = p_id;
end $$;

-- the address book of one sender
create or replace function customer_receivers_of(p_sender uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('customers.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'receiver_id', c.id, 'name', c.full_name, 'phone', c.phone, 'whatsapp', c.whatsapp,
                                        'address', coalesce(r.address, c.address)) order by c.full_name, r.created_at)
    from customer_receivers r join customers c on c.id = r.receiver_id where r.sender_id = p_sender
  ), '[]'::jsonb);
end $$;

-- ---------- Emirates ID number and photo (kept per booking, so the driver can add them at pickup) ----------
create table id_documents (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings (id) on delete cascade,
  emirates_id      text check (emirates_id is null or emirates_id ~ '^784-[0-9]{4}-[0-9]{7}-[0-9]$'),
  photo_path       text check (photo_path is null or length(photo_path) <= 200),
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  check (emirates_id is not null or photo_path is not null)
);
create index id_documents_booking_idx on id_documents (booking_id, created_at desc);
alter table id_documents enable row level security;
-- whoever may open the booking and holds the permission can see and add; the booking's own rules apply to the subquery
create policy id_documents_select on id_documents for select to authenticated
  using ((select has_perm('customers.id_photo')) and exists (select 1 from bookings b where b.id = booking_id));
create policy id_documents_insert on id_documents for insert to authenticated
  with check ((select has_perm('customers.id_photo')) and exists (select 1 from bookings b where b.id = booking_id));
revoke all on id_documents from anon, authenticated;
grant select, insert on id_documents to authenticated;

create or replace function id_documents_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.emirates_id := customer_clean_eid(new.emirates_id);
  new.uploaded_by_name := coalesce(nullif((select p.full_name from profiles p where p.id = auth.uid()), ''), 'Team member');
  return new;
end $$;
create trigger id_documents_before before insert on id_documents for each row execute function id_documents_before();

-- a new Emirates ID number also fills the customer record, when that has none yet
create or replace function id_documents_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.emirates_id is not null then
    update customers set emirates_id = new.emirates_id, updated_at = now()
    where emirates_id is null and id in (select customer_id from booking_contacts where booking_id = new.booking_id and role = 'customer');
  end if;
  return new;
end $$;
create trigger id_documents_after after insert on id_documents for each row execute function id_documents_after();
create trigger audit_id_documents after insert or delete on id_documents for each row execute function audit_row();

-- deleting a photo or number needs a manager and a reason; the file itself is removed by the app afterwards
create or replace function delete_id_document(p_id uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare d id_documents; actor uuid := auth.uid();
begin
  perform require_perm('customers.manage');
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason'; end if;
  select * into d from id_documents where id = p_id;
  if not found then raise exception 'Not found'; end if;
  insert into audit_log (table_name, row_id, booking_id, action, changed_by, actor_name, changes)
  values ('deletion_reason', d.id, d.booking_id, 'delete', actor, (select full_name from profiles where id = actor),
          jsonb_build_object('reason', btrim(p_reason), 'deleted', 'Emirates ID number and photo'));
  delete from id_documents where id = d.id;
  return d.photo_path;
end $$;

-- private storage for the photos: nobody reads a file unless they can see its record
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-ids', 'customer-ids', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy customer_ids_read on storage.objects for select to authenticated
  using (bucket_id = 'customer-ids' and exists (select 1 from public.id_documents d where d.photo_path = name));
create policy customer_ids_add on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-ids' and (select public.has_perm('customers.id_photo')));
create policy customer_ids_remove on storage.objects for delete to authenticated
  using (bucket_id = 'customer-ids' and (select public.has_perm('customers.manage')));

-- Settings switch: the pickup cannot be marked collected without the sender's Emirates ID number
insert into app_settings (key, value, label, description) values
  ('require_id_before_collected', 'false'::jsonb, 'Require the Emirates ID before marking a pickup collected',
   'When on, the driver must enter the sender''s Emirates ID number before a pickup can be marked collected.')
on conflict (key) do nothing;

create or replace function require_id_before_collected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'collected' and old.status is distinct from 'collected'
     and coalesce((select (value)::text = 'true' from app_settings where key = 'require_id_before_collected'), false)
     and not exists (select 1 from id_documents where booking_id = new.id and emirates_id is not null) then
    raise exception 'Enter the sender''s Emirates ID before marking this pickup collected';
  end if;
  return new;
end $$;
create trigger bookings_require_id before update of status on bookings for each row execute function require_id_before_collected();

-- ---------- possible duplicates, merge, delete (managers) ----------
create or replace function possible_duplicates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('customers.view');
  return coalesce((
    select jsonb_agg(g order by g ->> 'kind', g ->> 'value')
    from (
      select jsonb_build_object('kind', k.kind, 'value', k.val, 'customers', (
        select jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone, 'emirates_id', c.emirates_id, 'address', c.address,
          'invoices', (select count(*) from booking_contacts bc where bc.customer_id = c.id and bc.role = 'customer')) order by c.created_at)
        from customers c where (k.kind = 'phone' and c.phone = k.val) or (k.kind = 'emirates_id' and c.emirates_id = k.val))) as g
      from (
        select 'phone' as kind, phone as val from customers where phone is not null group by phone having count(*) > 1
        union all
        select 'emirates_id', emirates_id from customers where emirates_id is not null group by emirates_id having count(*) > 1
      ) k
    ) s
  ), '[]'::jsonb);
end $$;

create or replace function merge_customers(p_keep uuid, p_remove uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k customers; r customers;
begin
  perform require_perm('customers.manage');
  if p_keep = p_remove then raise exception 'Choose two different customers'; end if;
  select * into k from customers where id = p_keep;
  select * into r from customers where id = p_remove;
  if k.id is null or r.id is null then raise exception 'Customer not found'; end if;

  update booking_contacts set customer_id = k.id where customer_id = r.id;
  update customer_notes set customer_id = k.id where customer_id = r.id;
  -- address book: move what is not there yet, drop the rest
  delete from customer_receivers x where (x.sender_id = r.id or x.receiver_id = r.id)
    and exists (select 1 from customer_receivers y where y.id <> x.id
      and y.sender_id = case when x.sender_id = r.id then k.id else x.sender_id end
      and y.receiver_id = case when x.receiver_id = r.id then k.id else x.receiver_id end
      and coalesce(y.address, '') = coalesce(x.address, ''));
  update customer_receivers set sender_id = k.id where sender_id = r.id;
  update customer_receivers set receiver_id = k.id where receiver_id = r.id;
  delete from customer_receivers where sender_id = receiver_id;

  update customers set
    phone = coalesce(k.phone, r.phone),
    whatsapp = coalesce(k.whatsapp, r.whatsapp),
    address = coalesce(k.address, r.address),
    geo_lat = coalesce(k.geo_lat, r.geo_lat),
    geo_lng = coalesce(k.geo_lng, r.geo_lng),
    emirates_id = coalesce(k.emirates_id, r.emirates_id),
    warning_note = coalesce(k.warning_note, r.warning_note),
    updated_at = now()
  where id = k.id;
  insert into customer_notes (customer_id, body)
  values (k.id, left('Merged with the record of ' || r.full_name || coalesce(' (' || r.phone || ')', '') || '. All invoices, notes and receivers moved here.', 2000));
  delete from customers where id = r.id;
end $$;

create or replace function delete_customer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('customers.manage');
  if exists (select 1 from booking_contacts where customer_id = p_id) then
    raise exception 'This customer is linked to invoices. Merge them into another customer, or unlink the invoices first.';
  end if;
  delete from customers where id = p_id;
  if not found then raise exception 'Customer not found'; end if;
end $$;

-- ---------- access ----------
revoke execute on function set_customer_warning(uuid, text), booking_warning(uuid), add_receiver(uuid, text, text, text, uuid), remove_receiver(uuid),
  customer_receivers_of(uuid), delete_id_document(uuid, text), possible_duplicates(), merge_customers(uuid, uuid), delete_customer(uuid) from public, anon;
grant execute on function set_customer_warning(uuid, text), booking_warning(uuid), add_receiver(uuid, text, text, text, uuid), remove_receiver(uuid),
  customer_receivers_of(uuid), delete_id_document(uuid, text), possible_duplicates(), merge_customers(uuid, uuid), delete_customer(uuid) to authenticated;
