-- Every automatic number now comes from one list, Settings > Numbering.
-- Until now only booking and invoice numbers did; returns (RT-) and containers (CN-) had their prefix fixed in the database.
--
-- Adding a new kind of number later is one line in a migration (see register_number_series below). It then shows up in
-- Settings > Numbering by itself, with its own prefix and next number.
--
-- Nothing visible changes: the current prefixes and the next numbers are copied over as they are.

-- ---------- the list becomes open-ended ----------
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'number_series'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table number_series drop constraint %I', c);
  end loop;
end $$;

alter table number_series add column if not exists label text;
alter table number_series add column if not exists sort int not null default 100;
-- Where the numbers of this series are stored, so an automatic number can skip any that are already used.
alter table number_series add column if not exists lookup_table text;
alter table number_series add column if not exists lookup_column text;

update number_series set label = 'Booking numbers', sort = 10, lookup_table = 'bookings', lookup_column = 'code' where kind = 'booking';
update number_series set label = 'Invoice numbers', sort = 20, lookup_table = 'bookings', lookup_column = 'invoice_no' where kind = 'invoice';

-- ---------- registering a series (for migrations; nobody can call this from the app) ----------
create or replace function register_number_series(p_kind text, p_label text, p_prefix text, p_start bigint, p_table text, p_column text, p_sort int default 100)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into number_series (kind, label, prefix, next_number, lookup_table, lookup_column, sort)
  values (p_kind, p_label, upper(p_prefix), greatest(p_start, 1), p_table, p_column, p_sort)
  on conflict (kind) do nothing;
end $$;
revoke execute on function register_number_series(text, text, text, bigint, text, text, int) from public, anon, authenticated;

-- Returns and containers continue from where their counters were.
select register_number_series('return', 'Return numbers', 'RT-', (select case when is_called then last_value + 1 else last_value end from return_code_seq), 'returns', 'code', 30);
select register_number_series('container', 'Container numbers', 'CN-', (select case when is_called then last_value + 1 else last_value end from container_code_seq), 'containers', 'code', 40);

alter table number_series alter column label set not null;

-- ---------- taking the next number: works for any series ----------
create or replace function take_next_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare
  s number_series;
  candidate text;
  taken boolean;
begin
  loop
    update number_series set next_number = next_number + 1 where kind = p_kind returning * into s;
    if not found then raise exception 'Unknown number series'; end if;
    candidate := s.prefix || (s.next_number - 1);
    taken := false;
    if s.lookup_table is not null then
      execute format('select exists (select 1 from %I where %I = $1)', s.lookup_table, s.lookup_column) into taken using candidate;
    end if;
    exit when not taken;
  end loop;
  return candidate;
end $$;
revoke execute on function take_next_number(text) from public, anon, authenticated;

-- ---------- one trigger function for any table that numbers itself from a series ----------
-- create trigger ... before insert on <table> for each row execute function assign_series_number('<kind>', '<column>');
-- It fills the column only when it was left empty, so a number somebody typed is kept.
create or replace function assign_series_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare current_value text := to_jsonb(new) ->> tg_argv[1];
begin
  if current_value is null or btrim(current_value) = '' then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[1], take_next_number(tg_argv[0])));
  end if;
  return new;
end $$;
revoke execute on function assign_series_number() from public, anon, authenticated;

-- ---------- returns and containers use it ----------
alter table returns alter column code drop default;
drop trigger if exists returns_a_number on returns;
create trigger returns_a_number before insert on returns
  for each row execute function assign_series_number('return', 'code');

alter table containers alter column code drop default;
drop trigger if exists containers_a_number on containers;
create trigger containers_a_number before insert on containers
  for each row execute function assign_series_number('container', 'code');
