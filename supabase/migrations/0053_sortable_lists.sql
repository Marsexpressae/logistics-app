-- Sorting for the Customers and Accounts lists.
--
-- Both lists are sent to the screen one page at a time, so the sort has to happen here: sorting only the page on screen
-- would be wrong as soon as there is more than one page. Each function gets two optional values, p_sort and p_dir.
--   * p_sort is checked against a fixed list of columns. Anything else is ignored (the normal order), so what a person
--     types in a web address can never reach the SQL.
--   * Ties and empty values are handled the same way as on the other lists: empty last, then the normal order.
-- With no sort given, the result is exactly what these functions returned before, so the running app keeps working.
-- The old versions are dropped first: leaving them would make calls without p_sort ambiguous.

drop function if exists list_customers(integer, integer);
drop function if exists search_customers(text, integer);
drop function if exists accounts_invoices(text, text, integer, integer);

-- ---------- customers: the whole list ----------
create or replace function list_customers(p_limit integer default 50, p_offset integer default 0, p_sort text default null, p_dir text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  res jsonb;
  total bigint;
  v_sort text := case when p_sort in ('name', 'phone', 'address', 'invoices', 'last_invoice') then p_sort else 'name' end;
  v_desc boolean := lower(coalesce(p_dir, 'asc')) = 'desc';
begin
  select coalesce(jsonb_agg(to_jsonb(r) - 'rn' - 'last_invoice_at' order by r.rn), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select s.id, s.full_name, s.phone, s.whatsapp, s.address, s.emirates_id, s.invoices, s.last_invoice, s.last_invoice_at, s.total,
           row_number() over (
             order by
               case when v_sort = 'name' and not v_desc then s.full_name end asc nulls last,
               case when v_sort = 'name' and v_desc then s.full_name end desc nulls last,
               case when v_sort = 'phone' and not v_desc then s.phone end asc nulls last,
               case when v_sort = 'phone' and v_desc then s.phone end desc nulls last,
               case when v_sort = 'address' and not v_desc then s.address end asc nulls last,
               case when v_sort = 'address' and v_desc then s.address end desc nulls last,
               case when v_sort = 'invoices' and not v_desc then s.invoices end asc,
               case when v_sort = 'invoices' and v_desc then s.invoices end desc,
               case when v_sort = 'last_invoice' and not v_desc then s.last_invoice_at end asc nulls last,
               case when v_sort = 'last_invoice' and v_desc then s.last_invoice_at end desc nulls last,
               s.full_name, s.id
           ) as rn
    from (
      select c.id, c.full_name, c.phone, c.whatsapp, c.address, c.emirates_id,
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
    ) s
    order by rn
    limit greatest(least(coalesce(p_limit, 50), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
  ) r;
  return jsonb_build_object('customers', res, 'total', total);
end $$;
revoke execute on function list_customers(integer, integer, text, text) from public, anon;
grant execute on function list_customers(integer, integer, text, text) to authenticated;

-- ---------- customers: search ----------
create or replace function search_customers(p_query text, p_limit integer default 8, p_sort text default null, p_dir text default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  q text := btrim(coalesce(p_query, ''));
  words text[];
  lim int := greatest(least(coalesce(p_limit, 8), 50), 1);
  whole_phone text := null;
  whole_eid text := null;
  res jsonb;
  total bigint;
  v_sort text := case when p_sort in ('name', 'phone', 'address', 'invoices', 'last_invoice') then p_sort else 'name' end;
  v_desc boolean := lower(coalesce(p_dir, 'asc')) = 'desc';
begin
  if length(regexp_replace(q, '\s', '', 'g')) < 2 then return jsonb_build_object('customers', '[]'::jsonb, 'total', 0); end if;
  words := regexp_split_to_array(lower(q), '\s+');
  if q ~ '^[0-9+() -]+$' and length(search_digits(q)) >= 4 then whole_phone := search_digits(q); end if;
  if q ~ '^[0-9 -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 6 then whole_eid := regexp_replace(q, '\D', '', 'g'); end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'rn' - 'last_invoice_at' order by r.rn), '[]'::jsonb), coalesce(max(r.total), 0) into res, total
  from (
    select s.id, s.full_name, s.phone, s.whatsapp, s.address, s.geo_lat, s.geo_lng, s.emirates_id, s.invoices, s.last_invoice, s.last_invoice_at, s.total,
           row_number() over (
             order by
               case when v_sort = 'name' and not v_desc then s.full_name end asc nulls last,
               case when v_sort = 'name' and v_desc then s.full_name end desc nulls last,
               case when v_sort = 'phone' and not v_desc then s.phone end asc nulls last,
               case when v_sort = 'phone' and v_desc then s.phone end desc nulls last,
               case when v_sort = 'address' and not v_desc then s.address end asc nulls last,
               case when v_sort = 'address' and v_desc then s.address end desc nulls last,
               case when v_sort = 'invoices' and not v_desc then s.invoices end asc,
               case when v_sort = 'invoices' and v_desc then s.invoices end desc,
               case when v_sort = 'last_invoice' and not v_desc then s.last_invoice_at end asc nulls last,
               case when v_sort = 'last_invoice' and v_desc then s.last_invoice_at end desc nulls last,
               s.full_name, s.id
           ) as rn
    from (
      select c.id, c.full_name, c.phone, c.whatsapp, c.address, c.geo_lat, c.geo_lng, c.emirates_id,
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
revoke execute on function search_customers(text, integer, text, text) from public, anon;
grant execute on function search_customers(text, integer, text, text) to authenticated;

-- ---------- accounts: the invoices ----------
-- The normal order is newest invoice first. It used to read the number as substring(invoice_no from 5)::bigint, which assumed
-- the prefix is exactly four characters ("INV-"). The prefix can now be changed in Settings and typed numbers are allowed, so
-- a different prefix or a number like "T-OLD-1" would have made this page fail. It now reads the number at the END of the
-- invoice number, and an invoice number with no number in it simply sorts last.
create or replace function accounts_invoices(p_status text default 'all', p_search text default null, p_limit integer default 25, p_offset integer default 0, p_sort text default null, p_dir text default null)
returns table (r_booking_id uuid, r_invoice_no text, r_code text, r_customer text, r_amount numeric, r_paid numeric, r_balance numeric, r_booking_status text, r_pay_status text, r_total bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(btrim(coalesce(p_search, '')), '');
  v_sort text := case when p_sort in ('invoice', 'customer', 'amount', 'paid', 'balance', 'status') then p_sort else null end;
  v_desc boolean := case when v_sort is null then true else lower(coalesce(p_dir, 'asc')) = 'desc' end;
begin
  if not (has_perm('accounts.view') or has_perm('payments.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;

  return query
  with x as (
    select b.id, b.invoice_no, b.code, b.sender_name, b.invoice_amount, b.status,
           coalesce((select sum(p.amount) from payments p where p.booking_id = b.id), 0) as paid
    from bookings b
    where b.invoice_no is not null
      and (q is null or b.invoice_no ilike '%' || q || '%' or b.code ilike '%' || q || '%' or b.sender_name ilike '%' || q || '%')
  ), y as (
    select x.*,
           case when x.invoice_amount is null then 'not_invoiced'
                when x.invoice_amount - x.paid <= 0 then 'paid'
                when x.paid > 0 then 'partial'
                else 'unpaid' end as pay_status,
           case when x.invoice_amount is null then null else greatest(x.invoice_amount - x.paid, 0) end as balance,
           (regexp_match(x.invoice_no, '(\d+)\D*$'))[1]::numeric as inv_no
    from x
  )
  select y.id, y.invoice_no, y.code, y.sender_name, y.invoice_amount, y.paid, y.balance, y.status, y.pay_status, count(*) over ()
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
    case when v_sort = 'amount' and not v_desc then y.invoice_amount end asc nulls last,
    case when v_sort = 'amount' and v_desc then y.invoice_amount end desc nulls last,
    case when v_sort = 'paid' and not v_desc then y.paid end asc nulls last,
    case when v_sort = 'paid' and v_desc then y.paid end desc nulls last,
    case when v_sort = 'balance' and not v_desc then y.balance end asc nulls last,
    case when v_sort = 'balance' and v_desc then y.balance end desc nulls last,
    -- status: the ones needing attention first (unpaid, partly paid, paid, no amount yet)
    case when v_sort = 'status' and not v_desc then case y.pay_status when 'unpaid' then 0 when 'partial' then 1 when 'paid' then 2 else 3 end end asc,
    case when v_sort = 'status' and v_desc then case y.pay_status when 'unpaid' then 0 when 'partial' then 1 when 'paid' then 2 else 3 end end desc,
    case when v_sort = 'invoice' and not v_desc then y.inv_no end asc nulls last,
    case when (v_sort = 'invoice' and v_desc) or v_sort is null then y.inv_no end desc nulls last,
    y.id
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
end $$;
revoke execute on function accounts_invoices(text, text, integer, integer, text, text) from public, anon;
grant execute on function accounts_invoices(text, text, integer, integer, text, text) to authenticated;
