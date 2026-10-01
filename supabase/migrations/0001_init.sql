-- Mars Express schema. Run in the Supabase SQL editor (or `supabase db push`).

-- ---------- Sequences (human-friendly codes) ----------
create sequence if not exists booking_code_seq   start 1001;
create sequence if not exists container_code_seq start 101;

-- ---------- Tables ----------
create table drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  user_id    uuid references auth.users (id) on delete set null, -- links a driver to a login
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table warehouses (
  id   uuid primary key default gen_random_uuid(),
  code text unique not null,          -- A, B
  name text not null
);
insert into warehouses (code, name) values ('A', 'Warehouse A'), ('B', 'Warehouse B');

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null default ('BK-' || nextval('booking_code_seq')),
  sender_name      text not null,
  sender_phone     text,
  receiver_name    text not null,
  receiver_phone   text,
  receiver_address text,
  pickup_address   text not null,
  driver_id        uuid references drivers (id) on delete set null,
  status           text not null default 'booked'
                   check (status in ('booked', 'collected', 'at_warehouse', 'cancelled')),
  payment_method   text not null default 'cash' check (payment_method in ('cash', 'bank_transfer')),
  amount_due       numeric(12,2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  collected_at     timestamptz
);
create index on bookings (driver_id, status);

-- Items the driver records at pickup
create table booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings (id) on delete cascade,
  description text not null,
  quantity    int  not null default 1 check (quantity > 0),
  weight_kg   numeric(10,2) not null default 0 check (weight_kg >= 0)
);
create index on booking_items (booking_id);

-- Payment tracking: a booking can have several payments (deposit + balance etc.)
create table payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references bookings (id) on delete cascade,
  amount             numeric(12,2) not null check (amount > 0),
  method             text not null check (method in ('cash', 'bank_transfer')),
  received_by_driver uuid references drivers (id) on delete set null,
  note               text,
  created_at         timestamptz not null default now()
);
create index on payments (booking_id);

create table containers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null default ('CN-' || nextval('container_code_seq')),
  destination text,
  status      text not null default 'loading' check (status in ('loading', 'departed', 'arrived')),
  departed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Repacked parcels; barcode = booking code + -P<n>, e.g. BK-1001-P2
create table parcels (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references bookings (id) on delete cascade,
  seq          int  not null,
  barcode      text unique not null,
  description  text,
  weight_kg    numeric(10,2) not null default 0,
  status       text not null default 'in_warehouse'
               check (status in ('in_warehouse', 'loaded', 'in_transit', 'delivered')),
  warehouse_id uuid references warehouses (id),
  container_id uuid references containers (id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (booking_id, seq)
);
create index on parcels (status);
create index on parcels (container_id);

-- Status history shown on the public tracking page
create table parcel_events (
  id         uuid primary key default gen_random_uuid(),
  parcel_id  uuid not null references parcels (id) on delete cascade,
  status     text not null,
  created_at timestamptz not null default now()
);
create index on parcel_events (parcel_id);

-- ---------- Triggers: log every parcel status change ----------
create or replace function log_parcel_insert() returns trigger language plpgsql as $$
begin
  insert into parcel_events (parcel_id, status) values (new.id, new.status);
  return new;
end $$;

create trigger parcels_after_insert after insert on parcels
  for each row execute function log_parcel_insert();

create or replace function touch_parcel() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into parcel_events (parcel_id, status) values (new.id, new.status);
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger parcels_before_update before update on parcels
  for each row execute function touch_parcel();

-- ---------- Business functions ----------

-- Split a collected booking into repacked parcels at a warehouse.
-- p_parcels example: [{"description": "Clothes", "weight_kg": 12.5}, ...]
create or replace function split_booking(p_booking_id uuid, p_warehouse_id uuid, p_parcels jsonb)
returns int language plpgsql as $$
declare
  b bookings;
  n int := 0;
  p jsonb;
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('collected', 'at_warehouse') then
    raise exception 'Booking % has not been collected yet', b.code;
  end if;
  if jsonb_array_length(p_parcels) = 0 then raise exception 'Add at least one parcel'; end if;
  if exists (select 1 from parcels where booking_id = b.id and status <> 'in_warehouse') then
    raise exception 'Some parcels of % have already left the warehouse; cannot re-split', b.code;
  end if;

  delete from parcels where booking_id = b.id;

  for p in select * from jsonb_array_elements(p_parcels) loop
    n := n + 1;
    insert into parcels (booking_id, seq, barcode, description, weight_kg, warehouse_id)
    values (b.id, n, b.code || '-P' || n, p->>'description',
            coalesce((p->>'weight_kg')::numeric, 0), p_warehouse_id);
  end loop;

  update bookings set status = 'at_warehouse' where id = b.id;
  return n;
end $$;

-- Load a parcel into a container by barcode (typed or scanned).
create or replace function load_parcel(p_container_id uuid, p_barcode text)
returns parcels language plpgsql as $$
declare
  c containers;
  p parcels;
begin
  select * into c from containers where id = p_container_id;
  if not found then raise exception 'Container not found'; end if;
  if c.status <> 'loading' then raise exception 'Container % has already departed', c.code; end if;

  select * into p from parcels where barcode = upper(trim(p_barcode)) for update;
  if not found then raise exception 'No parcel with barcode %', p_barcode; end if;
  if p.status <> 'in_warehouse' then
    raise exception 'Parcel % is not in a warehouse (status: %)', p.barcode, p.status;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;
  return p;
end $$;

create or replace function unload_parcel(p_parcel_id uuid)
returns void language plpgsql as $$
begin
  update parcels set status = 'in_warehouse', container_id = null
  where id = p_parcel_id and status = 'loaded';
  if not found then raise exception 'Parcel cannot be unloaded'; end if;
end $$;

-- Departure: every loaded parcel becomes in_transit.
create or replace function depart_container(p_container_id uuid)
returns int language plpgsql as $$
declare n int;
begin
  update containers set status = 'departed', departed_at = now()
  where id = p_container_id and status = 'loading';
  if not found then raise exception 'Container is not open for loading'; end if;

  update parcels set status = 'in_transit'
  where container_id = p_container_id and status = 'loaded';
  get diagnostics n = row_count;
  return n;
end $$;

-- Public tracking: callable without login, exposes only non-sensitive fields.
create or replace function track_booking(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'code', b.code,
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
      where p.booking_id = b.id), '[]'::jsonb)
  ) into result
  from bookings b
  where b.code = upper(trim(p_code));

  return result; -- null when not found
end $$;

grant execute on function track_booking(text) to anon, authenticated;

-- ---------- Row Level Security ----------
-- Staff and drivers sign in (Supabase Auth) and get full access.
-- Anonymous visitors can only call track_booking().
do $$
declare t text;
begin
  foreach t in array array['drivers','warehouses','bookings','booking_items','payments',
                           'containers','parcels','parcel_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "authenticated full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
