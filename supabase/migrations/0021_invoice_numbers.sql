-- The invoice number is the main identifier of a job.
--   * One invoice per booking, issued automatically when the pickup is collected (the receipt) or when the first
--     payment is recorded, whichever happens first. Bookings cancelled before pickup never get one, and a number is never reused.
--   * Payments are recorded against the invoice number.
--   * Packages, returns and containers are shown under the invoice number.
create sequence if not exists invoice_no_seq start 1001;

alter table bookings add column if not exists invoice_no text unique;
alter table payments add column if not exists invoice_no text;

-- The driver guard must ignore the invoice number, which the server assigns.
create or replace function guard_driver_booking_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user = 'authenticated' and auth.uid() is not null and not has_perm('bookings.edit') then
    if (to_jsonb(new) - 'status' - 'collected_at' - 'updated_at' - 'invoice_no')
       is distinct from (to_jsonb(old) - 'status' - 'collected_at' - 'updated_at' - 'invoice_no') then
      raise exception 'You can only mark pickups as collected';
    end if;
    if new.status is distinct from old.status and not (old.status = 'booked' and new.status = 'collected') then
      raise exception 'You can only mark pickups as collected';
    end if;
  end if;
  return new;
end $$;

-- Marking a pickup collected issues the invoice number.
create or replace function bookings_issue_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_no is null and new.status in ('collected', 'at_warehouse') then
    new.invoice_no := 'INV-' || nextval('invoice_no_seq');
  end if;
  return new;
end $$;
drop trigger if exists bookings_invoice on bookings;
create trigger bookings_invoice before update on bookings
  for each row execute function bookings_issue_invoice();

-- A payment is recorded against the invoice; the first payment issues it if it does not exist yet.
create or replace function payments_attach_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv text;
begin
  select invoice_no into inv from bookings where id = new.booking_id for update;
  if inv is null then
    update bookings set invoice_no = 'INV-' || nextval('invoice_no_seq') where id = new.booking_id returning invoice_no into inv;
  end if;
  new.invoice_no := inv;
  return new;
end $$;
drop trigger if exists payments_invoice on payments;
create trigger payments_invoice before insert on payments
  for each row execute function payments_attach_invoice();

-- Existing test data: bookings that were collected, have parcels, or have payments get an invoice, oldest first.
do $$
declare r record;
begin
  for r in
    select b.id from bookings b
    where b.invoice_no is null
      and (b.status in ('collected', 'at_warehouse')
           or exists (select 1 from payments p where p.booking_id = b.id)
           or exists (select 1 from parcels x where x.booking_id = b.id))
    order by b.created_at, b.code
  loop
    update bookings set invoice_no = 'INV-' || nextval('invoice_no_seq') where id = r.id;
  end loop;
end $$;
update payments p set invoice_no = b.invoice_no from bookings b where b.id = p.booking_id and p.invoice_no is null;

-- Public tracking also accepts the invoice number, and shows it.
create or replace function track_booking(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'code', b.code,
    'invoice_no', b.invoice_no,
    'status', b.status,
    'booked_at', b.created_at,
    'parcels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'barcode', p.barcode,
        'description', p.description,
        'weight_kg', p.weight_kg,
        'status', p.status,
        'warehouse', w.code,
        'container', c.code,
        'updated_at', p.updated_at,
        'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at)
                                             order by e.created_at), '[]'::jsonb)
                   from parcel_events e where e.parcel_id = p.id)
      ) order by p.seq)
      from parcels p
      left join warehouses w on w.id = p.warehouse_id
      left join containers c on c.id = p.container_id
      where p.booking_id = b.id and p.status <> 'repacked'), '[]'::jsonb)
  ) into result
  from bookings b
  where b.code = upper(trim(p_code)) or b.invoice_no = upper(trim(p_code));

  return result;
end $$;
grant execute on function track_booking(text) to anon, authenticated;

-- The container check shows the invoice number too.
drop function if exists container_check(uuid);
create or replace function container_check(p_container_id uuid)
returns table (booking_id uuid, booking_code text, invoice_no text, expected int, loaded int, missing text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('containers.view') or has_perm('containers.manage')) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  return query
  select b.id, b.code, b.invoice_no,
         count(*)::int,
         (count(*) filter (where p.container_id = p_container_id))::int,
         coalesce(array_agg(p.barcode order by p.seq) filter (where p.status = 'in_warehouse'), '{}'::text[])
  from bookings b
  join parcels p on p.booking_id = b.id and (p.container_id = p_container_id or p.status = 'in_warehouse')
  where b.id in (select pp.booking_id from parcels pp where pp.container_id = p_container_id)
  group by b.id, b.code, b.invoice_no
  order by b.code;
end $$;
revoke execute on function container_check(uuid) from public, anon;
grant execute on function container_check(uuid) to authenticated;
