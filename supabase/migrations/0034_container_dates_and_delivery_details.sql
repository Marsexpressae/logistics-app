-- Shipping records that match real life:
--   * your own container number (type 38, or leave empty for CN-120...)
--   * real dates: a container can be marked departed / arrived, and a parcel delivered, on the day it actually happened.
--     The parcel history shows that day instead of today. Dates cannot be in the future or out of order.
--   * delivery details: the local service partner (for example Leopards Courier) and the tracking number.
alter table containers add column if not exists arrived_at timestamptz;
alter table parcels add column if not exists delivered_at timestamptz;
alter table parcels add column if not exists delivery_partner text check (delivery_partner is null or length(delivery_partner) <= 60);
alter table parcels add column if not exists delivery_tracking text check (delivery_tracking is null or length(delivery_tracking) <= 60);

create or replace function containers_normalize_code() returns trigger language plpgsql as $$
begin
  new.code := upper(btrim(new.code));
  if new.code !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
    raise exception 'Use letters, numbers, dashes or slashes for the container number, for example 38 or CN-120';
  end if;
  return new;
end $$;
drop trigger if exists containers_code on containers;
create trigger containers_code before insert or update of code on containers
  for each row execute function containers_normalize_code();

-- A day typed by a person becomes noon on that day. Never in the future.
create or replace function event_time(p_date date) returns timestamptz
language plpgsql stable set search_path = public as $$
begin
  if p_date is null then return null; end if;
  if p_date > current_date then raise exception 'The date cannot be in the future'; end if;
  return (p_date + time '12:00')::timestamptz;
end $$;
revoke execute on function event_time(date) from public, anon, authenticated;

-- ---------- depart ----------
drop function if exists depart_container(uuid, text);
create or replace function depart_container(p_container_id uuid, p_override_reason text default null, p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  short text;
  c containers;
  r record;
  actor uuid := auth.uid();
  ts timestamptz := event_time(p_date);
begin
  perform require_perm('containers.manage');
  select * into c from containers where id = p_container_id and status = 'loading';
  if not found then raise exception 'Container is not open for loading'; end if;

  select string_agg(x.booking_code || ' (' || x.loaded || ' of ' || x.expected || ')', ', ') into short
  from container_check(p_container_id) x where cardinality(x.missing) > 0;

  if short is not null then
    if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'PARCELS_MISSING : %', short;
    end if;
    if not has_perm('containers.override_departure') then
      raise exception 'Parcels are missing (%). Only a manager can send a container with missing parcels.', short;
    end if;
    for r in select * from container_check(p_container_id) x where cardinality(x.missing) > 0 loop
      insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
      values (r.booking_id, 'departed_with_missing',
              btrim(p_override_reason) || ' (' || c.code || ' left without ' || array_to_string(r.missing, ', ') || ')',
              actor, (select full_name from profiles where id = actor));
    end loop;
  end if;

  update containers set status = 'departed', departed_at = coalesce(ts, now()) where id = p_container_id;
  update parcels set status = 'in_transit' where container_id = p_container_id and status = 'loaded';
  get diagnostics n = row_count;

  if ts is not null then -- show the real day in the parcel history
    update parcel_events e set created_at = ts
    where e.status = 'in_transit' and e.created_at = now() and e.parcel_id in (select p.id from parcels p where p.container_id = p_container_id);
    update parcel_events e set created_at = ts - interval '1 minute'
    where e.status = 'loaded' and e.created_at > ts - interval '1 minute' and e.parcel_id in (select p.id from parcels p where p.container_id = p_container_id);
    -- the earlier steps cannot be later than the loading (an old shipment entered today)
    update parcel_events e set created_at = ts - interval '2 minutes'
    where e.status = 'in_warehouse' and e.created_at > ts - interval '2 minutes' and e.parcel_id in (select p.id from parcels p where p.container_id = p_container_id);
  end if;
  return n;
end $$;

-- ---------- arrive ----------
drop function if exists arrive_container(uuid);
create or replace function arrive_container(p_container_id uuid, p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  c containers;
  ts timestamptz := event_time(p_date);
begin
  perform require_perm('containers.manage');
  select * into c from containers where id = p_container_id and status = 'departed';
  if not found then raise exception 'Container has not departed, or has already arrived'; end if;
  if ts is not null and ts::date < c.departed_at::date then raise exception 'The arrival cannot be before the departure (%)', c.departed_at::date; end if;

  update containers set status = 'arrived', arrived_at = coalesce(ts, now()) where id = p_container_id;
  update parcels set status = 'arrived' where container_id = p_container_id and status = 'in_transit';
  get diagnostics n = row_count;

  if ts is not null then
    update parcel_events e set created_at = ts
    where e.status = 'arrived' and e.created_at = now() and e.parcel_id in (select p.id from parcels p where p.container_id = p_container_id);
  end if;
  return n;
end $$;

-- ---------- deliver ----------
drop function if exists deliver_parcel(uuid);
create or replace function deliver_parcel(p_parcel_id uuid, p_partner text default null, p_tracking text default null, p_date date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p parcels;
  arrived timestamptz;
  ts timestamptz := event_time(p_date);
  partner text := nullif(btrim(coalesce(p_partner, '')), '');
  tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
begin
  perform require_perm('containers.manage');
  if length(coalesce(partner, '')) > 60 or length(coalesce(tracking, '')) > 60 then
    raise exception 'The partner and the tracking number can have up to 60 characters';
  end if;
  select * into p from parcels where id = p_parcel_id and status = 'arrived';
  if not found then raise exception 'Parcel must have arrived before it can be delivered'; end if;
  select c.arrived_at into arrived from containers c where c.id = p.container_id;
  if ts is not null and arrived is not null and ts::date < arrived::date then
    raise exception 'The delivery cannot be before the arrival (%)', arrived::date;
  end if;

  update parcels set status = 'delivered', delivered_at = coalesce(ts, now()), delivery_partner = partner, delivery_tracking = tracking
  where id = p_parcel_id;

  if ts is not null then
    update parcel_events e set created_at = ts where e.status = 'delivered' and e.created_at = now() and e.parcel_id = p_parcel_id;
  end if;
end $$;

-- ---------- tracking shows the delivery details ----------
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
        'delivery_partner', p.delivery_partner,
        'delivery_tracking', p.delivery_tracking,
        'delivered_at', p.delivered_at,
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

revoke execute on function depart_container(uuid, text, date) from public, anon;
revoke execute on function arrive_container(uuid, date) from public, anon;
revoke execute on function deliver_parcel(uuid, text, text, date) from public, anon;
grant execute on function depart_container(uuid, text, date) to authenticated;
grant execute on function arrive_container(uuid, date) to authenticated;
grant execute on function deliver_parcel(uuid, text, text, date) to authenticated;
