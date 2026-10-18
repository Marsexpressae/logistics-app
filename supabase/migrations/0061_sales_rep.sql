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


-- ---------- the rep in the Accounts list and the searches ----------
-- The three functions below are the live versions with one new field each: accounts_invoices.r_sales_rep (the booking's rep),
-- global_search .sales_rep on booking hits and customer hits, search_customers .sales_rep_id and .sales_rep. Nothing else changes.

drop function if exists accounts_invoices(text, text, integer, integer, text, text);
create or replace function accounts_invoices(p_status text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT NULL::text, p_dir text DEFAULT NULL::text)
 RETURNS TABLE(r_booking_id uuid, r_invoice_no text, r_code text, r_customer text, r_amount numeric, r_paid numeric, r_balance numeric, r_booking_status text, r_pay_status text, r_total bigint, r_credited numeric, r_sales_rep text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  q text := nullif(btrim(coalesce(p_search, '')), '');
  v_sort text := case when p_sort in ('invoice', 'customer', 'salesrep', 'amount', 'paid', 'balance', 'status') then p_sort else null end;
  v_desc boolean := case when v_sort is null then true else lower(coalesce(p_dir, 'asc')) = 'desc' end;
begin
  if not (has_perm('accounts.view') or has_perm('payments.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;

  return query
  with y as (
    select b.id, b.invoice_no, b.code, b.sender_name, b.invoice_amount, b.status, b.sales_rep_name,
           m.invoice_now, m.paid, m.balance_due, m.pay_status,
           case m.pay_status when 'refund_due' then 0 when 'unpaid' then 1 when 'partial' then 2 when 'paid' then 3 when 'credited' then 4 else 5 end as pay_rank,
           (regexp_match(b.invoice_no, '(\d+)\D*$'))[1]::numeric as inv_no
    from bookings b
    left join lateral money_of(b.id) m on true
    where b.invoice_no is not null
      and (q is null or b.invoice_no ilike '%' || q || '%' or b.code ilike '%' || q || '%' or b.sender_name ilike '%' || q || '%')
  )
  select y.id, y.invoice_no, y.code, y.sender_name, y.invoice_now, y.paid, y.balance_due, y.status, y.pay_status, count(*) over (),
         case when y.invoice_amount is null then 0 else y.invoice_amount - y.invoice_now end,
         y.sales_rep_name
  from y
  where case p_status
          when 'all' then true
          when 'outstanding' then y.pay_status in ('unpaid', 'partial') and y.status <> 'cancelled'
          when 'not_invoiced' then y.pay_status = 'not_invoiced' and y.status <> 'cancelled'
          else y.pay_status = p_status
        end
  order by
    case when v_sort = 'customer' and not v_desc then y.sender_name end asc nulls last,
    case when v_sort = 'customer' and v_desc then y.sender_name end desc nulls last,
    case when v_sort = 'salesrep' and not v_desc then y.sales_rep_name end asc nulls last,
    case when v_sort = 'salesrep' and v_desc then y.sales_rep_name end desc nulls last,
    case when v_sort = 'amount' and not v_desc then y.invoice_now end asc nulls last,
    case when v_sort = 'amount' and v_desc then y.invoice_now end desc nulls last,
    case when v_sort = 'paid' and not v_desc then y.paid end asc nulls last,
    case when v_sort = 'paid' and v_desc then y.paid end desc nulls last,
    case when v_sort = 'balance' and not v_desc then y.balance_due end asc nulls last,
    case when v_sort = 'balance' and v_desc then y.balance_due end desc nulls last,
    -- status: money owed back first, then unpaid, partly paid, paid, fully credited, no amount yet
    case when v_sort = 'status' and not v_desc then y.pay_rank end asc,
    case when v_sort = 'status' and v_desc then y.pay_rank end desc,
    case when v_sort = 'invoice' and not v_desc then y.inv_no end asc nulls last,
    case when (v_sort = 'invoice' and v_desc) or v_sort is null then y.inv_no end desc nulls last,
    y.id
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
end $$;
revoke execute on function accounts_invoices(text, text, integer, integer, text, text) from public, anon;
grant execute on function accounts_invoices(text, text, integer, integer, text, text) to authenticated;

create or replace function global_search(p_query text, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  q text := btrim(coalesce(p_query, ''));
  words text[];
  lim int := greatest(least(coalesce(p_limit, 6), 50), 1);
  whole_phone text := null;
  b jsonb; bn bigint;
  p jsonb; pn bigint;
  c jsonb; cn bigint;
  cu jsonb := '[]'::jsonb; cun bigint := 0;
  whole_eid text := null;
begin
  if length(regexp_replace(q, '\s', '', 'g')) < 2 then
    return jsonb_build_object('bookings', '[]'::jsonb, 'parcels', '[]'::jsonb, 'containers', '[]'::jsonb, 'customers', '[]'::jsonb,
                              'bookings_total', 0, 'parcels_total', 0, 'containers_total', 0, 'customers_total', 0);
  end if;
  words := regexp_split_to_array(lower(q), '\s+');
  if q ~ '^[0-9+() -]+$' and length(search_digits(q)) >= 4 then whole_phone := search_digits(q); end if;
  if q ~ '^[0-9 -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 6 then whole_eid := regexp_replace(q, '\D', '', 'g'); end if;

  -- invoices and bookings
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb), coalesce(max(r.total), 0) into b, bn
  from (
    select bk.id, bk.code, bk.invoice_no, bk.sender_name, bk.receiver_name, bk.sender_phone, stage(bk) as status, bk.pickup_date, bk.pickup_area, bk.created_at,
           case when bk.invoice_no is null then null else (select m.pay_status from money_of(bk.id) m) end as pay_status,
           bk.sales_rep_name as sales_rep,
           count(*) over () as total
    from bookings bk
    where booking_matches(bk, words, whole_phone)
    order by bk.created_at desc
    limit lim
  ) r;

  -- parcels
  select coalesce(jsonb_agg(to_jsonb(r) order by r.barcode), '[]'::jsonb), coalesce(max(r.total), 0) into p, pn
  from (
    select pc.id, pc.barcode, pc.description, pc.weight_kg, pc.status, pc.position, pc.booking_id,
           bk.invoice_no, bk.code as booking_code, bk.sender_name, w.name as place, count(*) over () as total
    from parcels pc
    join bookings bk on bk.id = pc.booking_id
    left join warehouses w on w.id = pc.warehouse_id
    where pc.status <> 'repacked'
      and not exists (
        select 1 from unnest(words) x
        where not (
             pc.barcode ilike search_like(x)
          or coalesce(pc.description, '') ilike search_like(x)
          or coalesce(pc.position, '') ilike search_like(x)
          or coalesce(bk.invoice_no, '') ilike search_like(x)
          or bk.code ilike search_like(x)
          or bk.sender_name ilike search_like(x)
          or coalesce(w.name, '') ilike search_like(x)
          or coalesce(pc.delivery_tracking, '') ilike search_like(x)
        )
      )
    order by pc.barcode
    limit lim
  ) r;

  -- containers
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb), coalesce(max(r.total), 0) into c, cn
  from (
    select ct.id, ct.code, ct.destination, ct.status, ct.created_at, count(*) over () as total
    from containers ct
    where not exists (
      select 1 from unnest(words) x
      where not (ct.code ilike search_like(x) or coalesce(ct.destination, '') ilike search_like(x))
    )
    order by ct.created_at desc
    limit lim
  ) r;

  -- customers (only for people who may see them)
  if has_perm('customers.view') then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb), coalesce(max(r.total), 0) into cu, cun
    from (
      select cs.id, cs.full_name, cs.phone, cs.address, cs.sales_rep_name as sales_rep,
             (select count(*) from booking_contacts bc where bc.customer_id = cs.id and bc.role = 'customer') as invoices,
             count(*) over () as total
      from customers cs
      where customer_matches(cs, words, whole_phone, whole_eid)
      order by cs.full_name
      limit lim
    ) r;
  end if;

  return jsonb_build_object('bookings', b, 'parcels', p, 'containers', c, 'customers', cu,
                            'bookings_total', bn, 'parcels_total', pn, 'containers_total', cn, 'customers_total', cun);
end $$;

create or replace function search_customers(p_query text, p_limit integer DEFAULT 8, p_sort text DEFAULT NULL::text, p_dir text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  q text := btrim(coalesce(p_query, ''));
  words text[];
  lim int := greatest(least(coalesce(p_limit, 8), 50), 1);
  whole_phone text := null;
  whole_eid text := null;
  res jsonb;
  total bigint;
  v_sort text := case when p_sort in ('name', 'phone', 'address', 'owner', 'invoices', 'last_invoice') then p_sort else 'name' end;
  v_desc boolean := lower(coalesce(p_dir, 'asc')) = 'desc';
begin
  if length(regexp_replace(q, '\s', '', 'g')) < 2 then return jsonb_build_object('customers', '[]'::jsonb, 'total', 0); end if;
  words := regexp_split_to_array(lower(q), '\s+');
  if q ~ '^[0-9+() -]+$' and length(search_digits(q)) >= 4 then whole_phone := search_digits(q); end if;
  if q ~ '^[0-9 -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 6 then whole_eid := regexp_replace(q, '\D', '', 'g'); end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'rn' - 'last_invoice_at' order by r.rn), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select s.id, s.full_name, s.phone, s.whatsapp, s.address, s.geo_lat, s.geo_lng, s.emirates_id, s.sales_rep_id, s.sales_rep, s.invoices, s.last_invoice, s.last_invoice_at, s.total,
           row_number() over (
             order by
               case when v_sort = 'name' and not v_desc then s.full_name end asc nulls last,
               case when v_sort = 'name' and v_desc then s.full_name end desc nulls last,
               case when v_sort = 'phone' and not v_desc then s.phone end asc nulls last,
               case when v_sort = 'phone' and v_desc then s.phone end desc nulls last,
               case when v_sort = 'address' and not v_desc then s.address end asc nulls last,
               case when v_sort = 'address' and v_desc then s.address end desc nulls last,
               case when v_sort = 'owner' and not v_desc then s.sales_rep end asc nulls last,
               case when v_sort = 'owner' and v_desc then s.sales_rep end desc nulls last,
               case when v_sort = 'invoices' and not v_desc then s.invoices end asc,
               case when v_sort = 'invoices' and v_desc then s.invoices end desc,
               case when v_sort = 'last_invoice' and not v_desc then s.last_invoice_at end asc nulls last,
               case when v_sort = 'last_invoice' and v_desc then s.last_invoice_at end desc nulls last,
               s.full_name, s.id
           ) as rn
    from (
      select c.id, c.full_name, c.phone, c.whatsapp, c.address, c.geo_lat, c.geo_lng, c.emirates_id,
             c.sales_rep_id, c.sales_rep_name as sales_rep,
             x.invoices, x.last_invoice, x.last_invoice_at,
             count(*) over () as total
      from customers c
      left join lateral (
        select count(*) as invoices,
               (array_agg(b.invoice_no order by b.created_at desc) filter (where b.invoice_no is not null))[1] as last_invoice,
               max(b.created_at) filter (where b.invoice_no is not null) as last_invoice_at
        from booking_contacts bc
        join bookings b on b.id = bc.booking_id
        where bc.customer_id = c.id and bc.role = 'customer'
      ) x on true
      where customer_matches(c, words, whole_phone, whole_eid)
    ) s
    order by rn
    limit lim
  ) r;
  return jsonb_build_object('customers', res, 'total', total);
end $$;
