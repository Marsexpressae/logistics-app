-- Customers join the global search (top bar and results page), and the customers screen gets a list function.
-- Same rules as before: only people with "View customers" see customer results.

create or replace function global_search(p_query text, p_limit int default 6) returns jsonb
language plpgsql stable set search_path = public as $$
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
    select bk.id, bk.code, bk.invoice_no, bk.sender_name, bk.receiver_name, bk.sender_phone, bk.status, bk.pickup_date, bk.pickup_area, bk.created_at,
           case when bk.invoice_no is null then null
                when bk.invoice_amount is null then 'not_invoiced'
                when bk.invoice_amount - coalesce(pd.paid, 0) <= 0 then 'paid'
                when coalesce(pd.paid, 0) > 0 then 'partial'
                else 'unpaid' end as pay_status,
           count(*) over () as total
    from bookings bk
    left join lateral (select sum(py.amount) as paid from payments py where py.booking_id = bk.id) pd on true
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
      select cs.id, cs.full_name, cs.phone, cs.address,
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


create or replace function list_customers(p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable set search_path = public as $$
declare res jsonb; total bigint;
begin
  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select c.id, c.full_name, c.phone, c.whatsapp, c.address, c.emirates_id,
           (select count(*) from booking_contacts bc where bc.customer_id = c.id and bc.role = 'customer') as invoices,
           (select b.invoice_no from booking_contacts bc join bookings b on b.id = bc.booking_id
             where bc.customer_id = c.id and bc.role = 'customer' and b.invoice_no is not null order by b.created_at desc limit 1) as last_invoice,
           count(*) over () as total
    from customers c
    order by c.full_name
    limit greatest(least(coalesce(p_limit, 50), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
  ) r;
  return jsonb_build_object('customers', res, 'total', total);
end $$;

revoke execute on function list_customers(int, int) from public, anon;
grant execute on function list_customers(int, int) to authenticated;
revoke execute on function global_search(text, int) from public, anon;
grant execute on function global_search(text, int) to authenticated;
