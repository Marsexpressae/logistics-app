-- Refunds and credit notes (stage 2): the money maths reaches Accounts, search and the cancel rule.
-- Design: docs/superpowers/specs/2026-10-15-refunds-credit-notes-design.md
--
-- Everything below reads money_of() (migration 0054), so Accounts, search and the booking page cannot disagree.
-- Invoiced      = invoice totals now (cancelled bookings excluded, as before)
-- Collected     = payments received minus refunds handed back
-- Outstanding   = balances due
-- Refunded      = refunds handed back; refund_due_* = money owed back to customers
-- A booking that has any payment can no longer be cancelled: use a credit note and a refund.

-- ---------- Accounts: the summary cards ----------
create or replace function accounts_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not (has_perm('accounts.view') or has_perm('payments.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;

  with x as (
    select b.status, b.invoice_no, b.invoice_amount, b.estimated_bill, m.invoice_now, m.paid, m.balance_due, m.refund_due
    from bookings b
    left join lateral money_of(b.id) m on true
  )
  select jsonb_build_object(
    'invoiced',          coalesce(sum(x.invoice_now) filter (where x.status <> 'cancelled' and x.invoice_amount is not null), 0),
    'collected',         coalesce(sum(x.paid), 0),
    'outstanding',       coalesce(sum(x.balance_due) filter (where x.status <> 'cancelled' and x.invoice_amount is not null), 0),
    'refunded',          coalesce((select sum(r.amount) from refunds r where r.status = 'active'), 0),
    'refund_due_count',  count(*) filter (where x.refund_due > 0),
    'refund_due_amount', coalesce(sum(x.refund_due), 0),
    'no_amount_count',   count(*) filter (where x.status <> 'cancelled' and x.invoice_no is not null and x.invoice_amount is null),
    'estimated_pending', coalesce(sum(x.estimated_bill) filter (where x.status <> 'cancelled' and x.invoice_no is not null and x.invoice_amount is null), 0),
    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'cash', c.cash, 'bank', c.bank) order by c.name), '[]'::jsonb)
      from (
        select coalesce(d.name, 'Office / not recorded') as name,
               coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) as cash,
               coalesce(sum(p.amount) filter (where p.method <> 'cash'), 0) as bank
        from payments p
        left join drivers d on d.id = p.received_by_driver
        group by d.id, d.name
      ) c
    ),
    'refunds', (
      select jsonb_build_object(
        'cash', coalesce(sum(r.amount) filter (where r.method = 'cash'), 0),
        'bank', coalesce(sum(r.amount) filter (where r.method <> 'cash'), 0))
      from refunds r where r.status = 'active'
    )
  ) into result
  from x;
  return result;
end $$;

-- ---------- Accounts: the invoice list ----------
-- New: r_credited (how much of the invoice has been credited), the states refund_due and credited, and the filter value refund_due.
-- The filter 'outstanding' means unpaid or partly paid (money owed TO you); refund_due is money owed BACK.
drop function if exists accounts_invoices(text, text, integer, integer, text, text);
create function accounts_invoices(p_status text default 'all', p_search text default null, p_limit integer default 25, p_offset integer default 0, p_sort text default null, p_dir text default null)
returns table (r_booking_id uuid, r_invoice_no text, r_code text, r_customer text, r_amount numeric, r_paid numeric, r_balance numeric, r_booking_status text, r_pay_status text, r_total bigint, r_credited numeric)
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
  with y as (
    select b.id, b.invoice_no, b.code, b.sender_name, b.invoice_amount, b.status,
           m.invoice_now, m.paid, m.balance_due, m.pay_status,
           case m.pay_status when 'refund_due' then 0 when 'unpaid' then 1 when 'partial' then 2 when 'paid' then 3 when 'credited' then 4 else 5 end as pay_rank,
           (regexp_match(b.invoice_no, '(\d+)\D*$'))[1]::numeric as inv_no
    from bookings b
    left join lateral money_of(b.id) m on true
    where b.invoice_no is not null
      and (q is null or b.invoice_no ilike '%' || q || '%' or b.code ilike '%' || q || '%' or b.sender_name ilike '%' || q || '%')
  )
  select y.id, y.invoice_no, y.code, y.sender_name, y.invoice_now, y.paid, y.balance_due, y.status, y.pay_status, count(*) over (),
         case when y.invoice_amount is null then 0 else y.invoice_amount - y.invoice_now end
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

-- ---------- search shows the same payment state ----------
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
           case when bk.invoice_no is null then null else (select m.pay_status from money_of(bk.id) m) end as pay_status,
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

-- ---------- a booking with payments is not cancelled: use a credit note and a refund ----------
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b     bookings;
  actor uuid := auth.uid();
  aname text := (select full_name from profiles where id = auth.uid());
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if has_perm('bookings.cancel') then
    if b.status not in ('booked', 'collected') then
      raise exception 'Only booked or collected bookings can be cancelled';
    end if;
  else
    -- pickup team: only their own, and only before collection
    if not (has_perm('pickups.cancel')
            and (has_perm('pickups.view_all') or b.driver_id = my_driver_id())) then
      raise exception 'You do not have permission to do this' using errcode = '42501';
    end if;
    if b.status <> 'booked' then raise exception 'Only pickups that have not been collected can be cancelled'; end if;
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A cancellation reason is required'; end if;
  if exists (select 1 from parcels where booking_id = b.id) then
    raise exception 'Booking already has parcels in the warehouse and cannot be cancelled';
  end if;
  if exists (select 1 from payments where booking_id = b.id) then
    raise exception 'Payments exist. Use a credit note and refund instead of cancelling.';
  end if;

  update bookings
  set status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = actor
  where id = b.id;
  insert into booking_events (booking_id, kind, reason, old_date, actor_id, actor_name)
  values (b.id, 'cancelled', btrim(p_reason), b.pickup_date, actor, aname);

  perform notify_other_party(b, 'cancelled', b.code || ' cancelled', 'Reason: ' || btrim(p_reason));
end $function$;
