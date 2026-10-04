-- The invoice list gets an "outstanding" filter (unpaid or partly paid), matching the Outstanding total on the Accounts cards.
-- "Outstanding" and "no amount yet" leave out cancelled bookings, like the totals do.
create or replace function accounts_invoices(
  p_status text default 'all',   -- all | outstanding | unpaid | partial | paid | not_invoiced
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
  where case p_status
          when 'all' then true
          when 'outstanding' then y.pay_status in ('unpaid', 'partial') and y.status <> 'cancelled'
          when 'not_invoiced' then y.pay_status = 'not_invoiced' and y.status <> 'cancelled'
          else y.pay_status = p_status
        end
  order by substring(y.invoice_no from 5)::bigint desc
  limit greatest(least(p_limit, 100), 1) offset greatest(p_offset, 0);
end $$;

