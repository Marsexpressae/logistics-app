-- Accounts totals and the invoice list are computed in the database (see ADR-0007).
-- They stay correct and fast at any size; the browser no longer downloads every booking and adds them up.

-- 1. Summary: invoiced, collected, outstanding, amounts not set, and collections by who and how.
--    Rules: money received counts even on cancelled bookings; cancelled bookings are not invoiced or owed.
create or replace function accounts_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not (has_perm('accounts.view') or has_perm('payments.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;

  with x as (
    select b.status, b.invoice_no, b.invoice_amount, b.estimated_bill,
           coalesce((select sum(p.amount) from payments p where p.booking_id = b.id), 0) as paid
    from bookings b
  )
  select jsonb_build_object(
    'invoiced',          coalesce(sum(x.invoice_amount) filter (where x.status <> 'cancelled' and x.invoice_amount is not null), 0),
    'collected',         coalesce(sum(x.paid), 0),
    'outstanding',       coalesce(sum(greatest(x.invoice_amount - x.paid, 0)) filter (where x.status <> 'cancelled' and x.invoice_amount is not null), 0),
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
    )
  ) into result
  from x;
  return result;
end $$;

-- 2. The invoice list: one page at a time, filtered by payment status and text.
create or replace function accounts_invoices(
  p_status text default 'all',   -- all | unpaid | partial | paid | not_invoiced
  p_search text default null,    -- invoice number, booking code or customer name
  p_limit int default 25,
  p_offset int default 0
)
returns table (r_booking_id uuid, r_invoice_no text, r_code text, r_customer text, r_amount numeric, r_paid numeric,
               r_balance numeric, r_booking_status text, r_pay_status text, r_total bigint)
language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_search, '')), '');
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
                else 'unpaid' end as pay_status
    from x
  )
  select y.id, y.invoice_no, y.code, y.sender_name, y.invoice_amount, y.paid,
         case when y.invoice_amount is null then null else greatest(y.invoice_amount - y.paid, 0) end,
         y.status, y.pay_status, count(*) over ()
  from y
  where p_status = 'all' or y.pay_status = p_status
  order by substring(y.invoice_no from 5)::bigint desc
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
end $$;

revoke execute on function accounts_summary() from public, anon;
revoke execute on function accounts_invoices(text, text, int, int) from public, anon;
grant execute on function accounts_summary() to authenticated;
grant execute on function accounts_invoices(text, text, int, int) to authenticated;
