-- The customer's ID (Emirates ID) is printed on the return form, under their mobile number.
-- It is read live, so older forms and numbers added later show up too, and the warehouse team needs no access to the customer screens.
-- Adds one function. Nothing existing changes, so the running app keeps working.

-- The number on the customer record, else the latest one recorded on the booking at pickup. Null when there is none.
create or replace function return_customer_eid(p_return_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare bid uuid;
begin
  if not (has_perm('warehouse.view') or has_perm('warehouse.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  select booking_id into bid from returns where id = p_return_id;
  return coalesce(
    (select c.emirates_id from booking_contacts bc join customers c on c.id = bc.customer_id
      where bc.booking_id = bid and bc.role = 'customer' and c.emirates_id is not null limit 1),
    (select d.emirates_id from id_documents d where d.booking_id = bid and d.emirates_id is not null order by d.created_at desc limit 1)
  );
end $$;

revoke execute on function return_customer_eid(uuid) from public, anon;
grant execute on function return_customer_eid(uuid) to authenticated;
