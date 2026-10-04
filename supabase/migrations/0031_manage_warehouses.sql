-- Warehouse names you control (Settings > Organization): add, rename, deactivate, delete.
--   * name: what people see ("Tarpal A", "East Shed").  code: a short label for printed labels ("TA", "ES").
--   * A warehouse that has (or ever had) parcels cannot be deleted, because that history must stay.
--     It can be deactivated instead: it disappears from the choices when receiving, but old records keep its name.
--   * There must always be at least one active warehouse.
alter table warehouses add column if not exists active boolean not null default true;

create or replace function warehouse_clean_code(p_name text, p_code text, p_ignore uuid default null) returns text
language plpgsql stable set search_path = public as $$
declare
  base text := upper(regexp_replace(coalesce(nullif(btrim(p_code), ''), ''), '[^A-Za-z0-9]', '', 'g'));
  candidate text;
  n int := 1;
begin
  if base = '' then
    -- first letters of the words, and any numbers: "Tarpal 2" -> T2, "East Shed" -> ES
    base := (select coalesce(string_agg(case when w ~ '^[0-9]+$' then w else upper(left(w, 1)) end, ''), '')
             from regexp_split_to_table(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 ]', '', 'g'), '\s+') w where w <> '');
  end if;
  base := left(base, 6);
  if base = '' then raise exception 'Enter a short code for this warehouse'; end if;
  candidate := base;
  while exists (select 1 from warehouses x where upper(x.code) = candidate and x.id is distinct from p_ignore) loop
    n := n + 1;
    candidate := left(base, 6 - length(n::text)) || n;
  end loop;
  return candidate;
end $$;

create or replace function add_warehouse(p_name text, p_code text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  new_id uuid;
begin
  perform require_perm('settings.manage');
  if length(nm) not between 1 and 40 then raise exception 'Enter a name of up to 40 characters'; end if;
  if exists (select 1 from warehouses w where lower(w.name) = lower(nm)) then raise exception 'A warehouse with this name already exists'; end if;
  insert into warehouses (code, name) values (warehouse_clean_code(nm, p_code), nm) returning id into new_id;
  return new_id;
end $$;

create or replace function update_warehouse(p_id uuid, p_name text, p_code text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  nm text := btrim(coalesce(p_name, ''));
  cd text;
begin
  perform require_perm('settings.manage');
  if not exists (select 1 from warehouses w where w.id = p_id) then raise exception 'Warehouse not found'; end if;
  if length(nm) not between 1 and 40 then raise exception 'Enter a name of up to 40 characters'; end if;
  if exists (select 1 from warehouses w where lower(w.name) = lower(nm) and w.id <> p_id) then raise exception 'A warehouse with this name already exists'; end if;
  cd := warehouse_clean_code(nm, p_code, p_id);
  if not p_active and not exists (select 1 from warehouses w where w.active and w.id <> p_id) then
    raise exception 'There must be at least one active warehouse';
  end if;
  update warehouses set name = nm, code = cd, active = coalesce(p_active, true) where id = p_id;
end $$;

create or replace function delete_warehouse(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('settings.manage');
  if not exists (select 1 from warehouses w where w.id = p_id) then raise exception 'Warehouse not found'; end if;
  if exists (select 1 from parcels x where x.warehouse_id = p_id) then
    raise exception 'This warehouse has parcels, now or in the past, so it cannot be deleted. Deactivate it instead.';
  end if;
  if not exists (select 1 from warehouses w where w.active and w.id <> p_id) then
    raise exception 'There must be at least one active warehouse';
  end if;
  delete from warehouses where id = p_id;
end $$;

revoke execute on function warehouse_clean_code(text, text, uuid) from public, anon, authenticated;
revoke execute on function add_warehouse(text, text) from public, anon;
revoke execute on function update_warehouse(uuid, text, text, boolean) from public, anon;
revoke execute on function delete_warehouse(uuid) from public, anon;
grant execute on function add_warehouse(text, text) to authenticated;
grant execute on function update_warehouse(uuid, text, text, boolean) to authenticated;
grant execute on function delete_warehouse(uuid) to authenticated;

create trigger audit_warehouses after insert or update or delete on warehouses
  for each row execute function audit_row();
