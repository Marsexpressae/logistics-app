-- The stage a booking shows, worked out in the database from its parcels, in ONE place.
--
-- A booking only stores four stages (booked, collected, at warehouse, cancelled). After it reaches the warehouse its real
-- progress lives in its parcels. Every screen, search result and the public tracking page now read the same answer:
--   * every current parcel returned to the customer      -> returned
--   * otherwise the LEAST advanced parcel decides, so cargo still in the warehouse (a partial return, or part of it shipped)
--     keeps the booking "at_warehouse", and it only moves on when every parcel has:
--     at_warehouse -> loaded -> in_transit -> arrived -> delivered
--   * returned parcels do not hold a booking back; repacked parcels are history and are ignored
-- Working it out here, and not in each screen, means it cannot disagree between screens, and it does not depend on who may
-- see the parcels table: only the stage (one word) is returned, never parcel details. (The screens used to join the parcels
-- themselves, so people without warehouse or container permission still saw "at_warehouse".)
-- The stored status is not changed. Nothing here writes data.

-- The rule. Not callable from the app on its own: only the functions below use it.
create or replace function booking_stage_of(p_status text, p_booking uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  total int;
  still_here int;
  least int;
begin
  if p_status <> 'at_warehouse' then return p_status; end if;
  select count(*),
         count(*) filter (where status <> 'returned'),
         min(case status when 'loaded' then 1 when 'in_transit' then 2 when 'arrived' then 3 when 'delivered' then 4 else 0 end)
           filter (where status <> 'returned')
    into total, still_here, least
  from parcels
  where booking_id = p_booking and status <> 'repacked';   -- uses the (booking_id, seq) index
  if total = 0 then return p_status; end if;
  if still_here = 0 then return 'returned'; end if;
  return (array['at_warehouse', 'loaded', 'in_transit', 'arrived', 'delivered'])[least + 1];
end $$;
revoke execute on function booking_stage_of(text, uuid) from public, anon, authenticated;

-- A column on bookings: select=*,stage. It is only available for booking rows the person can already see (row security on
-- bookings still decides that), and it returns one word.
create or replace function stage(b bookings) returns text
language sql stable security definer set search_path = public as $$
  select booking_stage_of(b.status, b.id)
$$;
revoke execute on function stage(bookings) from public, anon;
grant execute on function stage(bookings) to authenticated;

-- Search results and public tracking show the same stage. (Only the stage expression changed in these two functions.)
CREATE OR REPLACE FUNCTION public.global_search(p_query text, p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.track_booking(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  select jsonb_build_object(
    'code', b.code,
    'invoice_no', b.invoice_no,
    'status', stage(b),
    'booked_at', b.created_at,
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'barcode', p.barcode,
        'description', p.description,
        'weight_kg', p.weight_kg,
        'status', p.status,
        'warehouse', w.code,
        'container', c.code,
        'updated_at', p.updated_at,
        'delivery_partner', p.delivery_partner,
        'delivery_tracking', p.delivery_tracking,
        'delivered_at', p.delivered_at,
        'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at)
                                             order by e.created_at), '[]'::jsonb)
                   from parcel_events e where e.parcel_id = p.id)
      ) order by p.seq)
      from parcels p
      left join warehouses w on w.id = p.warehouse_id
      left join containers c on c.id = p.container_id
      where p.booking_id = b.id and p.status <> 'repacked'), '[]'::jsonb)
  ) into result
  from bookings b
  where b.code = upper(trim(p_code)) or b.invoice_no = upper(trim(p_code));
  return result;
end $function$;
