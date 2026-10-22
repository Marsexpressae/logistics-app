-- "Is this booking or invoice number already used?", asked while the number is typed, so nobody fills in a whole booking
-- before the database refuses the number. Read-only. Only people who may type numbers (numbers.edit, the same people who
-- see the boxes) can ask. It tells them only which booking has the number and its status. The unique rules in
-- bookings_a_numbers_* stay as the final check, because two people can still pick the same number at the same moment.
create or replace function number_in_use(p_kind text, p_value text, p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v text := upper(btrim(coalesce(p_value, '')));
  hit bookings;
begin
  perform require_perm('numbers.edit');
  if p_kind not in ('booking', 'invoice') or not exists (select 1 from number_series where kind = p_kind) then raise exception 'Unknown number series'; end if;
  if v = '' then return null; end if;
  select * into hit from bookings b
  where (case when p_kind = 'invoice' then b.invoice_no else b.code end) = v and b.id is distinct from p_exclude
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', hit.id, 'code', hit.code, 'status', hit.status);
end $$;
revoke execute on function number_in_use(text, text, uuid) from public, anon;
grant execute on function number_in_use(text, text, uuid) to authenticated;
