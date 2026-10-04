-- Back to the original rule: only people granted "payments.manage" (set on the Roles page) can edit or delete payments.
drop policy if exists payments_update on payments;
drop policy if exists payments_delete on payments;
create policy payments_update on payments for update to authenticated
  using ((select has_perm('payments.manage'))) with check ((select has_perm('payments.manage')));
create policy payments_delete on payments for delete to authenticated
  using ((select has_perm('payments.manage')));
