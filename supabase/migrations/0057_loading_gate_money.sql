-- Refunds and credit notes: the "payment before loading" rule now uses the same money rules as Accounts.
-- Before, it compared the raw invoice amount with the raw payments, so a partly returned booking (credit note lowered the invoice)
-- still looked unpaid, and a refunded booking still looked paid. Only the money check changes.

-- ---------- loaded into a container ----------
drop function if exists load_parcel(uuid, text, text);
create or replace function load_parcel(p_container_id uuid, p_barcode text, p_override_reason text default null, p_date date default null)
returns parcels language plpgsql security definer set search_path = public as $$
declare
  c containers;
  p parcels;
  b bookings;
  paid numeric;
  owed numeric;
  actor uuid := auth.uid();
  ts timestamptz := event_time(p_date);
begin
  perform require_perm('containers.manage');
  select * into c from containers where id = p_container_id;
  if not found then raise exception 'Container not found'; end if;
  if c.status <> 'loading' then raise exception 'Container % has already departed', c.code; end if;

  select * into p from parcels where barcode = upper(trim(p_barcode)) for update;
  if not found then raise exception 'No parcel with barcode %', p_barcode; end if;
  if p.status = 'repacked' then
    raise exception 'Parcel % was repacked. Scan the new label instead.', p.barcode;
  end if;
  if p.status <> 'in_warehouse' then
    raise exception 'Parcel % is not in a warehouse (status: %)', p.barcode, p.status;
  end if;

  if coalesce((select (value)::text = 'true' from app_settings where key = 'require_payment_before_loading'), false) then
    select * into b from bookings where id = p.booking_id;
    -- the same money rules as Accounts: credit notes lower what is owed, refunds lower what was paid
    select m.paid, m.invoice_now into paid, owed from money_of(b.id) m;
    if b.invoice_amount is null or coalesce(paid, 0) < owed then
      if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
        raise exception 'PAYMENT_REQUIRED % : %', b.code,
          case when b.invoice_amount is null then 'no invoice amount is set yet'
               else 'paid ' || to_char(paid, 'FM999,999,990.00') || ' of ' || to_char(owed, 'FM999,999,990.00') end;
      end if;
      if not has_perm('containers.override_payment') then
        raise exception 'Payment is required before loading % and you cannot override it. Ask a manager.', b.code;
      end if;
      insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
      values (b.id, 'loaded_without_payment', btrim(p_override_reason) || ' (' || p.barcode || ' into ' || c.code || ')',
              actor, (select full_name from profiles where id = actor));
    end if;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;

  if ts is not null then -- show the real day in the parcel history; the earlier step cannot be later than the loading
    update parcel_events e set created_at = ts where e.status = 'loaded' and e.created_at = now() and e.parcel_id = p.id;
    update parcel_events e set created_at = ts - interval '1 minute'
    where e.status = 'in_warehouse' and e.parcel_id = p.id and e.created_at > ts - interval '1 minute';
  end if;
  return p;
end $$;
revoke execute on function load_parcel(uuid, text, text, date) from public, anon;
grant execute on function load_parcel(uuid, text, text, date) to authenticated;
