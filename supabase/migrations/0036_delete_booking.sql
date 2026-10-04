-- Delete a booking. In this app a booking, its pickup and its invoice are one job, so deleting it removes all of them,
-- together with its packages, notes, history and return forms. Items and payments can also be deleted one by one on their own.
--
-- Safeguards:
--   * needs the permission "Delete bookings" (super admin by default; ticked per role on the Roles page);
--   * a reason is required, and it is written to the Activity log, which also keeps a full copy of everything that was deleted;
--   * packages that have shipped (loaded, in transit, arrived or delivered) block it: that history must stay, so cancel instead;
--   * money is never deleted by accident: if payments exist, the person must ask for them to be deleted too,
--     and needs the permission "Edit or delete payments" as well.
create or replace function delete_booking(p_booking_id uuid, p_reason text, p_with_payments boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  n_pay int;
  total_pay numeric;
  actor uuid := auth.uid();
begin
  perform require_perm('bookings.delete');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Enter the reason for deleting this booking'; end if;
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if exists (select 1 from parcels x where x.booking_id = b.id and x.status in ('loaded', 'in_transit', 'arrived', 'delivered')) then
    raise exception 'Some packages of % have shipped (in a container, in transit or delivered), so it cannot be deleted. Cancel it instead, or unload the packages from the container first.', coalesce(b.invoice_no, b.code);
  end if;

  select count(*), coalesce(sum(amount), 0) into n_pay, total_pay from payments where booking_id = b.id;
  if n_pay > 0 then
    if not p_with_payments then
      raise exception 'PAYMENTS_EXIST : % payment(s) totalling % are recorded on %', n_pay, total_pay, coalesce(b.invoice_no, b.code);
    end if;
    perform require_perm('payments.manage');
    delete from payments where booking_id = b.id;
  end if;

  -- the reason, next to the automatic record of every deleted row
  insert into audit_log (table_name, row_id, booking_id, action, changed_by, actor_name, changes)
  values ('deletion_reason', b.id, b.id, 'delete', actor, (select full_name from profiles where id = actor),
          jsonb_build_object('reason', btrim(p_reason), 'booking', b.code, 'invoice', b.invoice_no, 'payments_deleted', n_pay, 'payments_total', total_pay));

  delete from returns where booking_id = b.id;
  delete from bookings where id = b.id; -- items, packages, notes, history and notifications go with it
end $$;

revoke execute on function delete_booking(uuid, text, boolean) from public, anon;
grant execute on function delete_booking(uuid, text, boolean) to authenticated;
