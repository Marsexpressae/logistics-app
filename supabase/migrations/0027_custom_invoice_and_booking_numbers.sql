-- Invoice and booking numbers you control, like an accounting system:
--   * Automatic numbers come from a series with a PREFIX and a NEXT NUMBER that you can set (Settings > Numbering),
--     for example to continue an old invoice series at INV-3835.
--   * People with "Set invoice and booking numbers" can also TYPE a custom number when creating a booking, or change one later.
--   * Numbers are always unique. A booking number cannot change once parcels exist (their labels carry it).
--   * An invoice number can be changed but never removed. Payments follow the invoice number automatically.
insert into permissions (key, group_name, label, description, sort) values
  ('numbers.edit', 'Bookings', 'Set invoice and booking numbers',
   'Type a custom invoice or booking number, or change one, for example to match the accounting system', 27)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values ('super_admin', 'numbers.edit'), ('manager', 'numbers.edit')
on conflict do nothing;

-- ---------- the series ----------
create table number_series (
  kind        text primary key check (kind in ('invoice', 'booking')),
  prefix      text not null default '' check (prefix ~ '^[A-Z0-9._/-]{0,10}$'),
  next_number bigint not null check (next_number >= 1)
);
alter table number_series enable row level security;
create policy number_series_select on number_series for select to authenticated using (true);
revoke all on number_series from anon;
revoke insert, update, delete on number_series from authenticated;
grant select on number_series to authenticated;

-- Continue from where the old counters were.
insert into number_series (kind, prefix, next_number)
select 'invoice', 'INV-', case when is_called then last_value + 1 else last_value end from invoice_no_seq
on conflict (kind) do nothing;
insert into number_series (kind, prefix, next_number)
select 'booking', 'BK-', case when is_called then last_value + 1 else last_value end from booking_code_seq
on conflict (kind) do nothing;

-- Takes the next free number of a series (skips any that are already used, for example typed by hand).
create or replace function take_next_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare
  s number_series;
  candidate text;
begin
  loop
    update number_series set next_number = next_number + 1 where kind = p_kind returning * into s;
    if not found then raise exception 'Unknown number series'; end if;
    candidate := s.prefix || (s.next_number - 1);
    exit when not exists (
      select 1 from bookings b
      where (p_kind = 'invoice' and b.invoice_no = candidate) or (p_kind = 'booking' and b.code = candidate)
    );
  end loop;
  return candidate;
end $$;
revoke execute on function take_next_number(text) from public, anon, authenticated;

-- Settings > Numbering: change the prefix and the next number.
create or replace function set_number_series(p_kind text, p_prefix text, p_next bigint) returns void
language plpgsql security definer set search_path = public as $$
declare pre text := upper(btrim(coalesce(p_prefix, '')));
begin
  perform require_perm('settings.manage');
  if pre !~ '^[A-Z0-9._/-]{0,10}$' then raise exception 'The prefix can have up to 10 letters, numbers, dashes or slashes'; end if;
  if p_next is null or p_next < 1 then raise exception 'The next number must be 1 or more'; end if;
  update number_series set prefix = pre, next_number = p_next where kind = p_kind;
  if not found then raise exception 'Unknown number series'; end if;
end $$;
revoke execute on function set_number_series(text, text, bigint) from public, anon;
grant execute on function set_number_series(text, text, bigint) to authenticated;

-- ---------- bookings: automatic or typed numbers ----------
alter table bookings alter column code drop default; -- the trigger below fills it in (a default cannot reach the series safely)

create or replace function bookings_numbers_check(p_code text, p_invoice text, p_old_code text, p_old_invoice text, p_is_insert boolean, p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  -- "api" = a person using the app. Server work (the migration, or the server numbering a payment or collection) is trusted.
  -- (current_user cannot be used here: inside a SECURITY DEFINER function it is the function owner.)
  api boolean := auth.uid() is not null and coalesce(current_setting('app.server_numbering', true), '') <> 'on';
begin
  if p_code is distinct from p_old_code and p_code is not null and not p_is_insert then
    if api and not has_perm('numbers.edit') then raise exception 'You do not have permission to change the booking number'; end if;
    if exists (select 1 from parcels x where x.booking_id = p_booking) then
      raise exception 'The booking number cannot change once parcels exist, because their labels carry it';
    end if;
  elsif p_is_insert and p_code is not null and api and not has_perm('numbers.edit') then
    raise exception 'You do not have permission to type a booking number';
  end if;

  if p_invoice is distinct from p_old_invoice and p_invoice is not null then
    if api and not has_perm('numbers.edit') then raise exception 'You do not have permission to set the invoice number'; end if;
  end if;
  if p_old_invoice is not null and p_invoice is null then raise exception 'An invoice number cannot be removed'; end if;
end $$;
revoke execute on function bookings_numbers_check(text, text, text, text, boolean, uuid) from public, anon, authenticated;

-- These triggers are named so they run BEFORE the others (alphabetical order): they must see what the person typed,
-- not a number the server assigns later.
create or replace function bookings_a_numbers_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare typed boolean := new.code is not null and btrim(new.code) <> '';
begin
  if typed then
    new.code := upper(btrim(new.code));
  else
    new.code := take_next_number('booking');
  end if;
  if new.invoice_no is not null then new.invoice_no := nullif(upper(btrim(new.invoice_no)), ''); end if;
  -- only a number somebody typed needs the permission; an automatic one does not
  perform bookings_numbers_check(case when typed then new.code end, new.invoice_no, null, null, true, new.id);
  if new.code !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then raise exception 'Use letters, numbers, dashes or slashes for the booking number, for example BK-1050'; end if;
  if new.invoice_no is not null and new.invoice_no !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
    raise exception 'Use letters, numbers, dashes or slashes for the invoice number, for example INV-3603';
  end if;
  return new;
end $$;
drop trigger if exists bookings_a_numbers_insert on bookings;
create trigger bookings_a_numbers_insert before insert on bookings
  for each row execute function bookings_a_numbers_insert();

create or replace function bookings_a_numbers_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.code := upper(btrim(new.code));
  if new.invoice_no is not null then new.invoice_no := nullif(upper(btrim(new.invoice_no)), ''); end if;
  if new.code is distinct from old.code or new.invoice_no is distinct from old.invoice_no then
    perform bookings_numbers_check(new.code, new.invoice_no, old.code, old.invoice_no, false, new.id);
    if new.code is distinct from old.code and new.code !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
      raise exception 'Use letters, numbers, dashes or slashes for the booking number, for example BK-1050';
    end if;
    if new.invoice_no is distinct from old.invoice_no and new.invoice_no !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
      raise exception 'Use letters, numbers, dashes or slashes for the invoice number, for example INV-3603';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bookings_a_numbers_update on bookings;
create trigger bookings_a_numbers_update before update on bookings
  for each row execute function bookings_a_numbers_update();

-- Automatic invoice numbers now come from the series.
create or replace function bookings_issue_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_no is null and new.status in ('collected', 'at_warehouse') then
    new.invoice_no := take_next_number('invoice');
  end if;
  return new;
end $$;

create or replace function payments_attach_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv text;
begin
  select invoice_no into inv from bookings where id = new.booking_id for update;
  if inv is null then
    perform set_config('app.server_numbering', 'on', true); -- this number is assigned by the server, not typed by a person
    update bookings set invoice_no = take_next_number('invoice') where id = new.booking_id returning invoice_no into inv;
    perform set_config('app.server_numbering', 'off', true);
  end if;
  new.invoice_no := inv;
  return new;
end $$;

-- A payment always carries its booking's current invoice number, and cannot move to another booking.
create or replace function payments_protect_links() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.booking_id is distinct from old.booking_id then
    raise exception 'A payment cannot be moved to another booking';
  end if;
  new.invoice_no := (select b.invoice_no from bookings b where b.id = new.booking_id);
  return new;
end $$;

-- When an invoice number changes, the payments recorded against it follow.
create or replace function bookings_numbers_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update payments set invoice_no = new.invoice_no where booking_id = new.id and invoice_no is distinct from new.invoice_no;
  return new;
end $$;
drop trigger if exists bookings_numbers_after on bookings;
create trigger bookings_numbers_after after update of invoice_no on bookings
  for each row when (old.invoice_no is distinct from new.invoice_no) execute function bookings_numbers_after();
