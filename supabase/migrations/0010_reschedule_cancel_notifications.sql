-- Reschedule + cancel with a mandatory reason, by the office AND the pickup team, with the OTHER party notified.
--   * office actor (holds bookings.edit)  -> the assigned driver is notified
--   * pickup-team actor (driver)          -> everyone in the office (bookings.edit) is notified
-- Every change is also kept as a permanent, visible history on the booking (booking_events).

-- ---------- permissions ----------
insert into permissions (key, group_name, label, description, sort) values
  ('notifications.view',  'General',  'Receive notifications', 'See in-app notifications about changes to bookings', 11),
  ('bookings.reschedule', 'Bookings', 'Reschedule bookings', 'Move a booking to another pickup date (a reason is required)', 25),
  ('pickups.cancel',      'Pickups',  'Cancel own pickups', 'Cancel a pickup that has not been collected yet (a reason is required)', 33),
  ('pickups.reschedule',  'Pickups',  'Reschedule own pickups', 'Move a pickup to another date (a reason is required)', 34);

insert into role_permissions (role, permission) values
  ('super_admin', 'notifications.view'), ('super_admin', 'bookings.reschedule'),
  ('super_admin', 'pickups.cancel'),     ('super_admin', 'pickups.reschedule'),
  ('manager',   'notifications.view'), ('manager',   'bookings.reschedule'),
  ('staff',     'notifications.view'), ('staff',     'bookings.reschedule'),
  ('warehouse', 'notifications.view'),
  ('driver',    'notifications.view'), ('driver', 'pickups.cancel'), ('driver', 'pickups.reschedule');

-- ---------- history of schedule changes (visible to anyone who can see the booking) ----------
create table booking_events (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  kind       text not null check (kind in ('rescheduled', 'cancelled')),
  reason     text not null check (length(btrim(reason)) > 0),
  old_date   date,
  new_date   date,
  actor_id   uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on booking_events (booking_id, created_at desc);

alter table booking_events enable row level security;
-- the subquery is itself subject to bookings RLS, so visibility follows the booking
create policy booking_events_select on booking_events for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id));
revoke all on booking_events from anon;
revoke insert, update, delete on booking_events from authenticated;

-- ---------- notifications ----------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  booking_id uuid references bookings (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  actor_name text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;
create policy notifications_select on notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on notifications from anon;
revoke insert, update, delete on notifications from authenticated;
grant update (read_at) on notifications to authenticated; -- people may only mark their own as read

-- instant delivery to open apps (Supabase Realtime respects the policy above)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- ---------- internal: tell the other party ----------
create or replace function notify_other_party(p_booking bookings, p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor      uuid := auth.uid();
  actor_name text := (select full_name from profiles where id = auth.uid());
begin
  if has_perm('bookings.edit') then
    -- office acted -> tell the assigned driver
    insert into notifications (user_id, booking_id, kind, title, body, actor_name)
    select d.user_id, p_booking.id, p_kind, p_title, p_body, actor_name
    from drivers d
    join profiles pr on pr.id = d.user_id and pr.active
    where d.id = p_booking.driver_id and d.user_id is not null and d.user_id is distinct from actor;
  else
    -- pickup team acted -> tell the office
    insert into notifications (user_id, booking_id, kind, title, body, actor_name)
    select pr.id, p_booking.id, p_kind, p_title, p_body, actor_name
    from profiles pr
    join role_permissions rp on rp.role = pr.role and rp.permission = 'bookings.edit'
    where pr.active and pr.id is distinct from actor;
  end if;
end $$;
revoke execute on function notify_other_party(bookings, text, text, text) from public, anon, authenticated;

-- ---------- reschedule ----------
create or replace function reschedule_booking(p_booking_id uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b     bookings;
  today date := (now() at time zone 'Asia/Dubai')::date;
  actor uuid := auth.uid();
  aname text := (select full_name from profiles where id = auth.uid());
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  -- office (any booking) or pickup team (only pickups they are allowed to see)
  if not has_perm('bookings.reschedule') then
    if not (has_perm('pickups.reschedule')
            and (has_perm('pickups.view_all') or b.driver_id = my_driver_id())) then
      raise exception 'You do not have permission to do this' using errcode = '42501';
    end if;
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;
  if b.status <> 'booked' then raise exception 'Only pickups that have not been collected can be rescheduled'; end if;
  if p_new_date is null or p_new_date < today then raise exception 'Choose today or a future date'; end if;
  if p_new_date = b.pickup_date then raise exception 'The pickup is already on that date'; end if;

  update bookings set pickup_date = p_new_date where id = b.id;
  insert into booking_events (booking_id, kind, reason, old_date, new_date, actor_id, actor_name)
  values (b.id, 'rescheduled', btrim(p_reason), b.pickup_date, p_new_date, actor, aname);

  perform notify_other_party(b, 'rescheduled', b.code || ' rescheduled',
    format('Moved from %s to %s. Reason: %s', to_char(b.pickup_date, 'DD Mon YYYY'),
           to_char(p_new_date, 'DD Mon YYYY'), btrim(p_reason)));
end $$;

-- ---------- cancel (replaces the version from migration 0009) ----------
create or replace function cancel_booking(p_booking_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b     bookings;
  actor uuid := auth.uid();
  aname text := (select full_name from profiles where id = auth.uid());
begin
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;

  if has_perm('bookings.cancel') then
    if b.status not in ('booked', 'collected') then
      raise exception 'Only booked or collected bookings can be cancelled';
    end if;
  else
    -- pickup team: only their own, and only before collection
    if not (has_perm('pickups.cancel')
            and (has_perm('pickups.view_all') or b.driver_id = my_driver_id())) then
      raise exception 'You do not have permission to do this' using errcode = '42501';
    end if;
    if b.status <> 'booked' then raise exception 'Only pickups that have not been collected can be cancelled'; end if;
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A cancellation reason is required'; end if;
  if exists (select 1 from parcels where booking_id = b.id) then
    raise exception 'Booking already has parcels in the warehouse and cannot be cancelled';
  end if;

  update bookings
  set status = 'cancelled', cancellation_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = actor
  where id = b.id;
  insert into booking_events (booking_id, kind, reason, old_date, actor_id, actor_name)
  values (b.id, 'cancelled', btrim(p_reason), b.pickup_date, actor, aname);

  perform notify_other_party(b, 'cancelled', b.code || ' cancelled', 'Reason: ' || btrim(p_reason));
end $$;

revoke execute on function reschedule_booking(uuid, date, text), cancel_booking(uuid, text) from public, anon;
grant execute on function reschedule_booking(uuid, date, text), cancel_booking(uuid, text) to authenticated;
