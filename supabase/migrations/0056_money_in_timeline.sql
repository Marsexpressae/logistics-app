-- Refunds and credit notes (stage 3): the customer's history lists credit notes and refunds, and their voiding.
-- Design: docs/superpowers/specs/2026-10-15-refunds-credit-notes-design.md
-- The function keeps every existing entry and its signature; two kinds are added, read straight from the tables.

create or replace function customer_timeline(p_customer_id uuid, p_limit int default 40, p_offset int default 0)
returns table (r_at timestamptz, r_kind text, r_title text, r_detail text, r_booking_id uuid, r_invoice text, r_actor text)
language plpgsql stable security definer set search_path = public as $$
declare
  lim int := greatest(least(coalesce(p_limit, 40), 200), 1);
  off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform require_perm('customers.view');
  return query
  with mine as (
    select b.id, b.code, coalesce(b.invoice_no, b.code) as ref, b.created_at, b.collected_at, b.cancelled_at, b.cancellation_reason,
           b.sender_name, b.receiver_name, bc.role
    from booking_contacts bc join bookings b on b.id = bc.booking_id
    where bc.customer_id = p_customer_id
  ), ev as (
    select m.created_at as at, 'booking'::text as kind, 'Booking created' as title,
           m.ref || ' · ' || m.sender_name || ' → ' || coalesce(m.receiver_name, 'receiver not set') as detail, m.id as bid, m.ref as ref, null::text as actor
    from mine m
    union all
    select m.collected_at, 'booking', 'Pickup collected', m.ref, m.id, m.ref, null from mine m where m.collected_at is not null
    union all
    select m.cancelled_at, 'booking', 'Booking cancelled', coalesce(m.cancellation_reason, ''), m.id, m.ref, null from mine m where m.cancelled_at is not null
    union all
    select e.created_at, 'event',
           case e.kind when 'rescheduled' then 'Pickup rescheduled' when 'loaded_without_payment' then 'Loaded without full payment'
                       when 'departed_with_missing' then 'Container left with packages missing' when 'returned' then 'Returned to the customer'
                       when 'return_deleted' then 'Return deleted' when 'moved' then 'Packages moved' else 'Cancelled' end,
           coalesce(e.reason, ''), e.booking_id, m.ref, e.actor_name
    from booking_events e join mine m on m.id = e.booking_id
    union all
    select pe.created_at, 'package', 'Package ' || p.barcode,
           case pe.status when 'in_warehouse' then 'Received in the warehouse' when 'loaded' then 'Loaded into a container'
                          when 'in_transit' then 'In transit' when 'arrived' then 'Arrived at the destination' when 'delivered' then 'Delivered'
                          when 'repacked' then 'Repacked' when 'ready_for_return' then 'Ready for return' when 'returned' then 'Returned' else pe.status end,
           p.booking_id, m.ref, null
    from parcel_events pe join parcels p on p.id = pe.parcel_id join mine m on m.id = p.booking_id
    union all
    select al.changed_at, 'payment',
           case al.action when 'insert' then 'Payment recorded' when 'update' then 'Payment changed' else 'Payment deleted' end,
           coalesce(al.changes ->> 'amount', '') || ' ' || replace(coalesce(al.changes ->> 'method', ''), '_', ' '), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'payments' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'item', case al.action when 'insert' then 'Item added' else 'Item removed' end,
           (al.changes ->> 'quantity') || ' × ' || coalesce(al.changes ->> 'description', '') || ' (' || coalesce(al.changes ->> 'weight_kg', '') || ' kg)',
           al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'booking_items' and al.action in ('insert', 'delete')
    union all
    select al.changed_at, 'invoice', 'Invoice number issued', al.changes -> 'invoice_no' ->> 'new', al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_no' and (al.changes -> 'invoice_no' ->> 'old') is null
    union all
    select al.changed_at, 'invoice', 'Invoice amount set', coalesce(al.changes -> 'invoice_amount' ->> 'new', ''), al.booking_id, m.ref, al.actor_name
    from audit_log al join mine m on m.id = al.booking_id
    where al.table_name = 'bookings' and al.action = 'update' and al.changes ? 'invoice_amount'
    union all
    select n.created_at, 'note', 'Note on ' || m.ref, n.body, n.booking_id, m.ref, n.author_name
    from booking_notes n join mine m on m.id = n.booking_id
    union all
    select cn.created_at, 'note', 'Note on the customer', cn.body, null, null, cn.author_name
    from customer_notes cn where cn.customer_id = p_customer_id
    union all
    select al.changed_at, 'link',
           case al.action when 'insert' then 'Linked to ' || coalesce(bk.invoice_no, bk.code) || ' as ' || (al.changes ->> 'role')
                          else 'Unlinked from ' || coalesce(bk.invoice_no, bk.code) end,
           '', al.booking_id, coalesce(bk.invoice_no, bk.code), al.actor_name
    from audit_log al left join bookings bk on bk.id = al.booking_id
    where al.table_name = 'booking_contacts' and al.action in ('insert', 'delete') and al.changes ->> 'customer_id' = p_customer_id::text
    union all
    select al.changed_at, 'customer', case al.action when 'insert' then 'Customer created' else 'Details changed' end,
           case when al.action = 'update' then (select string_agg(replace(k, '_', ' '), ', ') from jsonb_object_keys(al.changes) k where k <> 'updated_at') else '' end,
           null, null, al.actor_name
    from audit_log al where al.table_name = 'customers' and al.row_id = p_customer_id and al.action in ('insert', 'update')
    union all
    select cn.created_at, 'credit_note', 'Credit note ' || cn.number || ' issued',
           'Invoice lowered by ' || cn.credit_amount || '. ' || cn.reason, cn.booking_id, m.ref, cn.created_by_name
    from credit_notes cn join mine m on m.id = cn.booking_id
    union all
    select cn.voided_at, 'credit_note', 'Credit note ' || cn.number || ' voided', coalesce(cn.void_reason, ''), cn.booking_id, m.ref, cn.voided_by_name
    from credit_notes cn join mine m on m.id = cn.booking_id
    where cn.status = 'void' and cn.voided_at is not null
    union all
    select rf.created_at, 'refund', 'Refund ' || rf.number || ' paid', rf.amount || ' ' || replace(rf.method, '_', ' '), rf.booking_id, m.ref, rf.handed_by_name
    from refunds rf join mine m on m.id = rf.booking_id
    union all
    select rf.voided_at, 'refund', 'Refund ' || rf.number || ' voided', coalesce(rf.void_reason, ''), rf.booking_id, m.ref, rf.voided_by_name
    from refunds rf join mine m on m.id = rf.booking_id
    where rf.status = 'void' and rf.voided_at is not null
  )
  select ev.at, ev.kind, ev.title, ev.detail, ev.bid, ev.ref, ev.actor from ev order by ev.at desc nulls last limit lim offset off;
end $$;
