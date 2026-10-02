-- Anyone who can record payments (pickup team, office) can also correct or remove them.
-- The Activity log records every change, so nothing is lost.
drop policy if exists payments_update on payments;
drop policy if exists payments_delete on payments;
create policy payments_update on payments for update to authenticated
  using ((select has_perm('payments.manage')) or (select has_perm('pickups.collect')) or (select has_perm('bookings.edit')))
  with check ((select has_perm('payments.manage')) or (select has_perm('pickups.collect')) or (select has_perm('bookings.edit')));
create policy payments_delete on payments for delete to authenticated
  using ((select has_perm('payments.manage')) or (select has_perm('pickups.collect')) or (select has_perm('bookings.edit')));
