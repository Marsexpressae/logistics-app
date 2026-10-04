-- One search for the whole app (the box in the top bar, and the results page), computed in the database (ADR-0007).
-- It runs as the signed-in person, so the same rules apply as everywhere else: a driver only finds their own pickups,
-- the warehouse team sees parcels, and so on.
--
-- Rules (the same as the search boxes above each list):
--   * several words narrow the result: every word must be found somewhere;
--   * capitals do not matter;
--   * a phone number matches however it was typed (0567375716, 56 737 5716, +971567375716);
--   * a few digits are not enough to match a phone number (4 or more).

create or replace function search_like(p_word text) returns text
language sql immutable as $$
  select '%' || replace(replace(replace(p_word, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

create or replace function search_digits(p_text text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p_text, ''), '\D', '', 'g'), '^00', ''), '^0', '')
$$;

create or replace function booking_matches(bk bookings, p_words text[], p_whole_phone text) returns boolean
language sql stable as $$
  select
    (p_whole_phone is not null and (
        search_digits(bk.sender_phone) like '%' || p_whole_phone || '%'
     or search_digits(bk.sender_whatsapp) like '%' || p_whole_phone || '%'
     or search_digits(bk.receiver_phone) like '%' || p_whole_phone || '%'
     or search_digits(bk.receiver_whatsapp) like '%' || p_whole_phone || '%'))
    or not exists (
      select 1 from unnest(p_words) w
      where not (
           coalesce(bk.invoice_no, '') ilike search_like(w)
        or bk.code ilike search_like(w)
        or bk.sender_name ilike search_like(w)
        or coalesce(bk.receiver_name, '') ilike search_like(w)
        or coalesce(bk.pickup_area, '') ilike search_like(w)
        or coalesce(bk.pickup_address, '') ilike search_like(w)
        or coalesce(bk.receiver_address, '') ilike search_like(w)
        or coalesce(bk.notes, '') ilike search_like(w)
        or (w ~ '^[0-9+()-]+$' and length(search_digits(w)) >= 4 and (  -- only a word of digits is a phone number (not "inv-1002")
              search_digits(bk.sender_phone) like '%' || search_digits(w) || '%'
           or search_digits(bk.sender_whatsapp) like '%' || search_digits(w) || '%'
           or search_digits(bk.receiver_phone) like '%' || search_digits(w) || '%'
           or search_digits(bk.receiver_whatsapp) like '%' || search_digits(w) || '%'))
      )
    )
$$;

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
begin
  if length(regexp_replace(q, '\s', '', 'g')) < 2 then
    return jsonb_build_object('bookings', '[]'::jsonb, 'parcels', '[]'::jsonb, 'containers', '[]'::jsonb,
                              'bookings_total', 0, 'parcels_total', 0, 'containers_total', 0);
  end if;
  words := regexp_split_to_array(lower(q), '\s+');
  if q ~ '^[0-9+() -]+$' and length(search_digits(q)) >= 4 then whole_phone := search_digits(q); end if;

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

  return jsonb_build_object('bookings', b, 'parcels', p, 'containers', c,
                            'bookings_total', bn, 'parcels_total', pn, 'containers_total', cn);
end $$;

revoke execute on function search_like(text), search_digits(text), booking_matches(bookings, text[], text) from public, anon;
revoke execute on function global_search(text, int) from public, anon;
grant execute on function search_like(text), search_digits(text), booking_matches(bookings, text[], text) to authenticated;
grant execute on function global_search(text, int) to authenticated;
