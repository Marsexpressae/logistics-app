-- Staff rewards: richer profiles, points, levels, streaks and badges.
-- Design: docs/superpowers/specs/2026-10-18-staff-rewards-design.md
--
-- Staff earn points for real work in the app (counted by the database when the real record is saved) and for trying features
-- (recorded through one safe function). Managers can thank people and give badges. Everyone is treated the same: there is no
-- ranking. This migration only adds tables, columns and functions, so the running app keeps working.
-- Browser roles can read some of these tables; nothing here is written except through the functions below.

-- ---------- permissions ----------
insert into permissions (key, group_name, label, description, sort) values
  ('rewards.give',   'Rewards', 'Give thank-yous and badges', 'Thank a colleague with points and a message, and give badges by hand', 110),
  ('rewards.manage', 'Rewards', 'Manage the rewards system',  'Change point values, levels and badges, and see colleagues'' phone numbers', 111)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('super_admin', 'rewards.give'), ('super_admin', 'rewards.manage'),
  ('manager', 'rewards.give'), ('manager', 'rewards.manage')
on conflict do nothing;

-- ---------- richer profiles ----------
alter table profiles add column if not exists photo_path text;
alter table profiles add column if not exists job_title text;
alter table profiles add column if not exists team text;
alter table profiles add column if not exists birthday_day int;
alter table profiles add column if not exists birthday_month int;
alter table profiles add column if not exists hide_birthday boolean not null default false;
alter table profiles add column if not exists about text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists joined_on date;
update profiles set joined_on = created_at::date where joined_on is null;
alter table profiles alter column joined_on set default current_date;
do $$ begin
  alter table profiles add constraint profiles_team_check check (team is null or team in ('sales', 'pickup', 'warehouse', 'office'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table profiles add constraint profiles_about_check check (about is null or length(about) <= 200);
exception when duplicate_object then null; end $$;

-- ---------- limits live in the existing settings table ----------
insert into app_settings (key, value, label, description) values
  ('rewards_daily_cap', '100'::jsonb, 'Most points one person can earn from work in a day', 'Points over this are not recorded'),
  ('rewards_thank_you_monthly_points', '200'::jsonb, 'Most points a manager can give as thank-yous in a month', null),
  ('rewards_thank_you_monthly_count', '10'::jsonb, 'Most thank-yous a manager can give in a month', null)
on conflict (key) do nothing;

create or replace function setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = p_key and jsonb_typeof(value) = 'number'), p_default)
$$;
revoke execute on function setting_int(text, int) from public, anon;

-- ---------- the tables ----------
create table if not exists point_rules (
  key             text primary key,
  label           text not null,
  kind            text not null check (kind in ('work', 'explore', 'daily')),
  points          int not null check (points between 0 and 1000),
  daily_cap       int check (daily_cap is null or daily_cap >= 0),
  once_per_person boolean not null default false,
  active          boolean not null default true
);

create table if not exists point_log (
  id           bigint generated always as identity primary key,
  person_id    uuid not null references profiles (id) on delete cascade,
  rule_key     text not null,
  points       int not null check (points > 0),
  reason       text not null,
  source_table text,
  source_id    uuid,
  given_by     uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists point_log_source_once on point_log (person_id, rule_key, source_table, source_id) where source_id is not null;
create index if not exists point_log_person_idx on point_log (person_id, created_at desc);

create table if not exists levels (
  number     int primary key,
  name       text not null,
  min_points int not null check (min_points >= 0)
);

create table if not exists badges (
  key         text primary key,
  name        text not null,
  description text not null default '',
  icon        text not null default 'star',
  team        text check (team is null or team in ('sales', 'pickup', 'warehouse', 'office')),
  kind        text not null check (kind in ('count', 'streak', 'manual')),
  rule_key    text,
  threshold   int check (threshold is null or threshold > 0),
  active      boolean not null default true
);

create table if not exists person_badges (
  person_id  uuid not null references profiles (id) on delete cascade,
  badge_key  text not null references badges (key) on delete cascade,
  earned_at  timestamptz not null default now(),
  given_by   uuid references profiles (id) on delete set null,
  message    text,
  primary key (person_id, badge_key)
);

-- Read-only for browser roles. Only the functions in this file write.
alter table point_rules enable row level security;
alter table point_log enable row level security;
alter table levels enable row level security;
alter table badges enable row level security;
alter table person_badges enable row level security;
revoke all on point_rules, point_log, levels, badges, person_badges from anon, authenticated;
grant select on point_rules, levels, badges to authenticated;
grant select on point_log, person_badges to authenticated;
drop policy if exists rules_read on point_rules;
create policy rules_read on point_rules for select to authenticated using ((select app_role()) is not null);
drop policy if exists levels_read on levels;
create policy levels_read on levels for select to authenticated using ((select app_role()) is not null);
drop policy if exists badges_read on badges;
create policy badges_read on badges for select to authenticated using ((select app_role()) is not null);
drop policy if exists log_read on point_log;
create policy log_read on point_log for select to authenticated
  using (person_id = (select auth.uid()) or (select has_perm('rewards.manage')));
drop policy if exists person_badges_read on person_badges;
create policy person_badges_read on person_badges for select to authenticated
  using (person_id = (select auth.uid()) or (select has_perm('rewards.manage')));

-- ---------- starting values (managers change them later) ----------
insert into levels (number, name, min_points) values
  (1, 'Rookie', 0), (2, 'Helper', 100), (3, 'Handler', 300), (4, 'Pro handler', 700),
  (5, 'Specialist', 1500), (6, 'Expert', 3000), (7, 'Master', 6000), (8, 'Legend', 12000)
on conflict (number) do nothing;

insert into point_rules (key, label, kind, points, daily_cap, once_per_person) values
  ('booking_created',  'Create a booking',          'work',    5,  50,   false),
  ('pickup_collected', 'Mark a pickup collected',   'work',    5,  50,   false),
  ('payment_recorded', 'Record a payment',          'work',    3,  50,   false),
  ('parcel_moved',     'Scan or move a parcel',     'work',    1,  100,  false),
  ('active_today',     'Use the app today',         'daily',   2,  null, false),
  ('use_bookings',     'Try the Bookings page',     'explore', 10, null, true),
  ('use_warehouse',    'Try the Warehouse page',    'explore', 10, null, true),
  ('use_scan',         'Try scanning',              'explore', 10, null, true),
  ('use_accounts',     'Try the Accounts page',     'explore', 10, null, true),
  ('use_customers',    'Try the Customers page',    'explore', 10, null, true),
  ('use_pickups',      'Try the Pickups page',      'explore', 10, null, true),
  ('use_activity',     'Try the Activity page',     'explore', 10, null, true),
  ('use_search',       'Try the search',            'explore', 10, null, true)
on conflict (key) do nothing;

insert into badges (key, name, description, icon, team, kind, rule_key, threshold) values
  ('first_booking', 'First booking',   'Made your first booking',            'file-plus',  'sales',  'count',  'booking_created',  1),
  ('bookings_100',  '100 bookings',    'Made 100 bookings',                  'package',    'sales',  'count',  'booking_created',  100),
  ('first_pickup',  'First pickup',    'Collected your first pickup',        'truck',      'pickup', 'count',  'pickup_collected', 1),
  ('pickups_100',   '100 pickups',     'Collected 100 pickups',              'truck',      'pickup', 'count',  'pickup_collected', 100),
  ('scan_master',   'Scan master',     'Moved or scanned 1,000 parcels',     'scan',       null,     'count',  'parcel_moved',     1000),
  ('streak_7',      'Seven in a row',  'Worked in the app 7 days in a row',  'flame',      null,     'streak', null,               7),
  ('explorer',      'Explorer',        'Tried every main page of the app',   'compass',    null,     'count',  'explore',          null),
  ('team_player',   'Team player',     'Given by a manager for helping out', 'heart',      null,     'manual', null,               null)
on conflict (key) do nothing;

-- ---------- profile functions ----------
create or replace function update_my_profile(p_photo_path text, p_birthday_day int, p_birthday_month int, p_hide_birthday boolean, p_about text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or not exists (select 1 from profiles where id = uid and active) then raise exception 'You are not signed in' using errcode = '42501'; end if;
  if p_photo_path is not null and p_photo_path not like uid::text || '/%' then raise exception 'The photo must be in your own folder'; end if;
  if (p_birthday_day is null) <> (p_birthday_month is null) then raise exception 'Enter both the day and the month of your birthday'; end if;
  if p_birthday_day is not null then
    begin
      perform make_date(2024, p_birthday_month, p_birthday_day);
    exception when others then raise exception 'That birthday is not a real date';
    end;
  end if;
  if length(coalesce(p_about, '')) > 200 then raise exception 'Keep the about line under 200 characters'; end if;
  update profiles set
    photo_path = coalesce(p_photo_path, photo_path),
    birthday_day = p_birthday_day, birthday_month = p_birthday_month,
    hide_birthday = coalesce(p_hide_birthday, false),
    about = nullif(btrim(coalesce(p_about, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), '')
  where id = uid;
end $$;

create or replace function set_staff_details(p_person_id uuid, p_team text, p_job_title text, p_joined_on date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('users.manage');
  if p_team is not null and p_team not in ('sales', 'pickup', 'warehouse', 'office') then raise exception 'Team must be sales, pickup, warehouse or office'; end if;
  update profiles set team = p_team, job_title = nullif(btrim(coalesce(p_job_title, '')), ''), joined_on = coalesce(p_joined_on, joined_on)
  where id = p_person_id;
  if not found then raise exception 'Person not found'; end if;
end $$;

-- Everyone can see their colleagues' basics. Phone numbers only for managers (and the person), and a hidden birthday is hidden from everyone else.
create or replace function people_directory() returns table (
  id uuid, full_name text, role text, team text, job_title text, about text, photo_path text, joined_on date,
  birthday_day int, birthday_month int, hide_birthday boolean, phone text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.team, p.job_title, p.about, p.photo_path, p.joined_on,
    case when p.hide_birthday and p.id <> (select auth.uid()) then null else p.birthday_day end,
    case when p.hide_birthday and p.id <> (select auth.uid()) then null else p.birthday_month end,
    p.hide_birthday and p.id = (select auth.uid()),
    case when p.id = (select auth.uid()) or has_perm('rewards.manage') then p.phone else null end
  from profiles p
  where p.active and (select app_role()) is not null
$$;

revoke execute on function update_my_profile(text, int, int, boolean, text, text), set_staff_details(uuid, text, text, date), people_directory() from public, anon;
grant execute on function update_my_profile(text, int, int, boolean, text, text), set_staff_details(uuid, text, text, date), people_directory() to authenticated;

-- ---------- private storage for staff photos: each person writes only inside their own folder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists staff_photos_read on storage.objects;
create policy staff_photos_read on storage.objects for select to authenticated using (bucket_id = 'staff-photos' and (select app_role()) is not null);
drop policy if exists staff_photos_add on storage.objects;
create policy staff_photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists staff_photos_change on storage.objects;
create policy staff_photos_change on storage.objects for update to authenticated
  using (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists staff_photos_remove on storage.objects;
create policy staff_photos_remove on storage.objects for delete to authenticated
  using (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ======================================================================================================================
-- Points engine
-- ======================================================================================================================

-- "Today" always means today in Dubai, wherever the server runs.
create or replace function dubai_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Dubai')::date $$;

-- The number of days in a row (ending today or yesterday) on which the person did real work in the app.
create or replace function streak_of(p_person uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare cur date := dubai_today(); n int := 0;
begin
  if not exists (select 1 from point_log l join point_rules r on r.key = l.rule_key and r.kind = 'work'
                 where l.person_id = p_person and (l.created_at at time zone 'Asia/Dubai')::date = cur) then
    cur := cur - 1;
  end if;
  while exists (select 1 from point_log l join point_rules r on r.key = l.rule_key and r.kind = 'work'
                where l.person_id = p_person and (l.created_at at time zone 'Asia/Dubai')::date = cur) loop
    n := n + 1;
    cur := cur - 1;
  end loop;
  return n;
end $$;

-- Pay points for one rule, once per record, within the caps. Returns the points paid (0 when nothing was paid).
-- Not callable from the browser: it is used by the triggers and the functions below.
create or replace function award_points(p_person uuid, p_rule text, p_source_table text, p_source_id uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare
  r point_rules;
  day_start timestamptz := dubai_today()::timestamp at time zone 'Asia/Dubai';
  day_end timestamptz := (dubai_today() + 1)::timestamp at time zone 'Asia/Dubai';
begin
  if p_person is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_person::text, 7));
  if not exists (select 1 from profiles where id = p_person and active) then return 0; end if;
  select * into r from point_rules where key = p_rule and active;
  if not found or r.points = 0 then return 0; end if;
  if r.once_per_person and exists (select 1 from point_log where person_id = p_person and rule_key = p_rule) then return 0; end if;
  if p_source_id is not null and exists (select 1 from point_log where person_id = p_person and rule_key = p_rule and source_table is not distinct from p_source_table and source_id = p_source_id) then return 0; end if;
  if r.kind = 'daily' then
    if exists (select 1 from point_log where person_id = p_person and rule_key = p_rule and created_at >= day_start and created_at < day_end) then return 0; end if;
    -- "active today" is for people who did real work today, not for opening the app
    if not exists (select 1 from point_log l join point_rules w on w.key = l.rule_key and w.kind = 'work'
                   where l.person_id = p_person and l.created_at >= day_start and l.created_at < day_end) then return 0; end if;
  end if;
  if r.daily_cap is not null
     and coalesce((select sum(points) from point_log where person_id = p_person and rule_key = p_rule and created_at >= day_start and created_at < day_end), 0) + r.points > r.daily_cap then
    return 0;
  end if;
  if r.kind = 'work'
     and coalesce((select sum(l.points) from point_log l join point_rules w on w.key = l.rule_key and w.kind = 'work'
                   where l.person_id = p_person and l.created_at >= day_start and l.created_at < day_end), 0) + r.points > setting_int('rewards_daily_cap', 100) then
    return 0;
  end if;
  insert into point_log (person_id, rule_key, points, reason, source_table, source_id) values (p_person, p_rule, r.points, left(p_reason, 200), p_source_table, p_source_id);
  perform check_badges(p_person);
  if r.kind = 'work' then perform award_points(p_person, 'active_today', 'feature', null, 'Used the app today'); end if;
  return r.points;
exception when unique_violation then
  return 0;
end $$;
revoke execute on function award_points(uuid, text, text, uuid, text), streak_of(uuid), dubai_today() from public, anon, authenticated;

-- ---------- work actions are counted when the real record is saved ----------
-- A rewards problem must never stop a booking, a payment or a scan: every award is wrapped so it can only fail quietly.
create or replace function rewards_on_booking_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform award_points((select auth.uid()), 'booking_created', 'bookings', new.id, 'Booking ' || new.code); exception when others then null; end;
  return null;
end $$;
drop trigger if exists rewards_booking_created on bookings;
create trigger rewards_booking_created after insert on bookings for each row execute function rewards_on_booking_created();

create or replace function rewards_on_pickup_collected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform award_points((select auth.uid()), 'pickup_collected', 'bookings', new.id, 'Collected ' || new.code); exception when others then null; end;
  return null;
end $$;
drop trigger if exists rewards_pickup_collected on bookings;
create trigger rewards_pickup_collected after update of status on bookings for each row
  when (old.status is distinct from new.status and new.status = 'collected') execute function rewards_on_pickup_collected();

create or replace function rewards_on_payment_recorded() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform award_points((select auth.uid()), 'payment_recorded', 'payments', new.id, 'Payment for ' || coalesce((select code from bookings where id = new.booking_id), 'a booking')); exception when others then null; end;
  return null;
end $$;
drop trigger if exists rewards_payment_recorded on payments;
create trigger rewards_payment_recorded after insert on payments for each row execute function rewards_on_payment_recorded();

-- One payment per parcel and status per person, so moving the same parcel to the same place twice pays once.
create or replace function rewards_on_parcel_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform award_points((select auth.uid()), 'parcel_moved', 'parcels', md5(new.id::text || new.status)::uuid, 'Parcel ' || new.barcode || ' ' || replace(new.status, '_', ' ')); exception when others then null; end;
  return null;
end $$;
drop trigger if exists rewards_parcel_moved on parcels;
create trigger rewards_parcel_moved after update of status on parcels for each row
  when (old.status is distinct from new.status and new.status in ('in_warehouse', 'loaded', 'delivered')) execute function rewards_on_parcel_moved();

-- ---------- trying a feature, and using the app today ----------
create or replace function record_feature_use(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := (select auth.uid()); r point_rules; paid int;
begin
  select * into r from point_rules where key = p_key and kind in ('explore', 'daily') and active;
  if not found then raise exception 'Unknown feature'; end if;
  paid := award_points(uid, p_key, 'feature', null, r.label);
  if p_key <> 'active_today' then perform award_points(uid, 'active_today', 'feature', null, 'Used the app today'); end if;
  return paid;
end $$;

-- ---------- thank-yous from managers ----------
create or replace function give_thank_you(p_person uuid, p_points int, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := (select auth.uid());
  month_start timestamptz := date_trunc('month', dubai_today())::timestamp at time zone 'Asia/Dubai';
  used_points int; used_count int;
begin
  perform require_perm('rewards.give');
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 8));
  if p_person = uid then raise exception 'You cannot thank yourself'; end if;
  if btrim(coalesce(p_message, '')) = '' then raise exception 'Write a short message to go with the thank-you'; end if;
  if p_points is null or p_points < 1 or p_points > 100 then raise exception 'Give between 1 and 100 points'; end if;
  if not exists (select 1 from profiles where id = p_person and active) then raise exception 'That person is not active'; end if;
  select coalesce(sum(points), 0), count(*) into used_points, used_count from point_log where given_by = uid and rule_key = 'thank_you' and created_at >= month_start;
  if used_count >= setting_int('rewards_thank_you_monthly_count', 10) then raise exception 'You have used your thank-yous for this month'; end if;
  if used_points + p_points > setting_int('rewards_thank_you_monthly_points', 200) then raise exception 'That is more than your points for this month'; end if;
  insert into point_log (person_id, rule_key, points, reason, source_table, given_by) values (p_person, 'thank_you', p_points, left(btrim(p_message), 200), 'thank_you', uid);
  perform check_badges(p_person);
end $$;

-- ---------- reading a person's progress ----------
create or replace function person_rewards(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tot int; lvl levels; nxt levels;
  day_start timestamptz := dubai_today()::timestamp at time zone 'Asia/Dubai';
begin
  if (select app_role()) is null then raise exception 'You are not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_person and active) then raise exception 'Person not found'; end if;
  select coalesce(sum(points), 0) into tot from point_log where person_id = p_person;
  select * into lvl from levels where min_points <= tot order by number desc limit 1;
  select * into nxt from levels where min_points > tot order by number limit 1;
  return jsonb_build_object(
    'total', tot,
    'level_number', lvl.number, 'level_name', lvl.name, 'level_min', lvl.min_points,
    'next_level_name', nxt.name, 'next_min', nxt.min_points,
    'streak', streak_of(p_person),
    'today', coalesce((select sum(points) from point_log where person_id = p_person and created_at >= day_start), 0),
    'recent', case when p_person <> (select auth.uid()) and not has_perm('rewards.manage') then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('points', x.points, 'reason', x.reason, 'created_at', x.created_at) order by x.created_at desc, x.id desc)
                        from (select * from point_log where person_id = p_person order by created_at desc, id desc limit 20) x), '[]'::jsonb) end
  );
end $$;

create or replace function my_rewards() returns jsonb
language sql stable security definer set search_path = public as $$
  select person_rewards((select auth.uid()))
$$;

revoke execute on function record_feature_use(text), give_thank_you(uuid, int, text), person_rewards(uuid), my_rewards() from public, anon;
grant execute on function record_feature_use(text), give_thank_you(uuid, int, text), person_rewards(uuid), my_rewards() to authenticated;

-- ======================================================================================================================
-- Badges
-- ======================================================================================================================

-- How far a person is toward a badge: {progress, goal}. Count badges count point-log lines; the explorer badge counts the
-- explore rules tried; streak badges use the current streak. Manual badges have no progress.
create or replace function badge_progress(p_person uuid, b badges) returns int[]
language plpgsql stable security definer set search_path = public as $$
declare done int; goal int;
begin
  if b.kind = 'streak' then
    return array[streak_of(p_person), b.threshold];
  elsif b.kind = 'count' and b.rule_key = 'explore' then
    select count(distinct l.rule_key) into done from point_log l join point_rules r on r.key = l.rule_key and r.kind = 'explore' and r.active where l.person_id = p_person;
    select count(*) into goal from point_rules where kind = 'explore' and active;
    return array[done, goal];
  elsif b.kind = 'count' then
    select count(*) into done from point_log where person_id = p_person and rule_key = b.rule_key;
    return array[done, b.threshold];
  end if;
  return null;
end $$;

-- Give every count and streak badge the person has now reached. Called after points are paid. Badges are never taken away.
create or replace function check_badges(p_person uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b badges; prog int[]; team_of text; got int := 0;
begin
  select team into team_of from profiles where id = p_person and active;
  if not found then return 0; end if;
  for b in
    select * from badges bd where bd.active and bd.kind in ('count', 'streak') and (bd.team is null or bd.team = team_of)
      and not exists (select 1 from person_badges pb where pb.person_id = p_person and pb.badge_key = bd.key)
  loop
    prog := badge_progress(p_person, b);
    if prog is not null and prog[2] > 0 and prog[1] >= prog[2] then
      insert into person_badges (person_id, badge_key) values (p_person, b.key) on conflict do nothing;
      got := got + 1;
    end if;
  end loop;
  return got;
end $$;

create or replace function give_badge(p_person uuid, p_badge text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := (select auth.uid());
begin
  perform require_perm('rewards.give');
  if p_person = uid then raise exception 'You cannot give yourself a badge'; end if;
  if not exists (select 1 from badges where key = p_badge and kind = 'manual' and active) then raise exception 'That badge cannot be given by hand'; end if;
  if not exists (select 1 from profiles where id = p_person and active) then raise exception 'That person is not active'; end if;
  if exists (select 1 from person_badges where person_id = p_person and badge_key = p_badge) then raise exception 'They already have that badge'; end if;
  insert into person_badges (person_id, badge_key, given_by, message) values (p_person, p_badge, uid, nullif(left(btrim(coalesce(p_message, '')), 200), ''));
end $$;

-- The badges that apply to a person (their team's and everyone's, plus any they already hold), earned first.
create or replace function person_badges_of(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare team_of text; out jsonb;
begin
  if (select app_role()) is null then raise exception 'You are not signed in' using errcode = '42501'; end if;
  select team into team_of from profiles where id = p_person and active;
  if not found then raise exception 'Person not found'; end if;
  select coalesce(jsonb_agg(x.item order by x.earned desc nulls last, x.name), '[]'::jsonb) into out
  from (
    select b.name, pb.earned_at as earned,
      jsonb_build_object(
        'key', b.key, 'name', b.name, 'description', b.description, 'icon', b.icon,
        'earned_at', pb.earned_at, 'message', pb.message,
        'progress', case when pb.earned_at is null then (badge_progress(p_person, b))[1] end,
        'goal', case when pb.earned_at is null then (badge_progress(p_person, b))[2] end
      ) as item
    from badges b
    left join person_badges pb on pb.badge_key = b.key and pb.person_id = p_person
    where pb.earned_at is not null or (b.active and (b.team is null or b.team = team_of))
  ) x;
  return out;
end $$;

create or replace function my_badges() returns jsonb
language sql stable security definer set search_path = public as $$
  select person_badges_of((select auth.uid()))
$$;

-- Recent celebrations for the whole team: badges earned and thank-yous. No points, no ranking.
create or replace function wins_feed(p_limit int default 20) returns table (
  kind text, person_id uuid, person_name text, title text, message text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'badge'::text as kind, p.id as person_id, p.full_name as person_name, b.name as title, coalesce(pb.message, '') as message, pb.earned_at as created_at
    from person_badges pb join badges b on b.key = pb.badge_key join profiles p on p.id = pb.person_id and p.active
    union all
    select 'thank_you', p.id, p.full_name, 'Thanked by ' || coalesce(g.full_name, 'a colleague'), l.reason, l.created_at
    from point_log l join profiles p on p.id = l.person_id and p.active left join profiles g on g.id = l.given_by
    where l.rule_key = 'thank_you'
  ) w
  where (select app_role()) is not null
  order by created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke execute on function badge_progress(uuid, badges), check_badges(uuid) from public, anon, authenticated;
revoke execute on function give_badge(uuid, text, text), person_badges_of(uuid), my_badges(), wins_feed(int) from public, anon;
grant execute on function give_badge(uuid, text, text), person_badges_of(uuid), my_badges(), wins_feed(int) to authenticated;

-- ======================================================================================================================
-- Manager settings: point values, levels and badges
-- ======================================================================================================================
create or replace function save_point_rule(p_key text, p_points int, p_daily_cap int, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('rewards.manage');
  if p_points is null or p_points < 0 or p_points > 1000 then raise exception 'Points must be between 0 and 1000'; end if;
  if p_daily_cap is not null and p_daily_cap < 0 then raise exception 'The daily limit cannot be negative'; end if;
  update point_rules set points = p_points, daily_cap = p_daily_cap, active = coalesce(p_active, active) where key = p_key;
  if not found then raise exception 'Rule not found'; end if;
end $$;

-- Levels keep their order: each needs more points than the one before and fewer than the one after. The first starts at 0.
create or replace function save_level(p_number int, p_name text, p_min_points int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('rewards.manage');
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Give the level a name'; end if;
  if p_number is null or p_number < 1 then raise exception 'Level numbers start at 1'; end if;
  if p_min_points is null or p_min_points < 0 then raise exception 'Points cannot be negative'; end if;
  if p_number = 1 and p_min_points <> 0 then raise exception 'The first level starts at 0 points'; end if;
  if exists (select 1 from levels where number < p_number and min_points >= p_min_points) then raise exception 'Each level needs more points than the one before it'; end if;
  if exists (select 1 from levels where number > p_number and min_points <= p_min_points) then raise exception 'Each level needs fewer points than the one after it'; end if;
  insert into levels (number, name, min_points) values (p_number, btrim(p_name), p_min_points)
  on conflict (number) do update set name = excluded.name, min_points = excluded.min_points;
end $$;

create or replace function save_badge(p_key text, p_name text, p_description text, p_active boolean, p_threshold int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('rewards.manage');
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Give the badge a name'; end if;
  if p_threshold is not null and p_threshold < 1 then raise exception 'The goal must be more than 0'; end if;
  update badges set name = btrim(p_name), description = coalesce(btrim(p_description), ''), active = coalesce(p_active, active),
    threshold = case when kind = 'manual' then null else coalesce(p_threshold, threshold) end
  where key = p_key;
  if not found then raise exception 'Badge not found'; end if;
end $$;

revoke execute on function save_point_rule(text, int, int, boolean), save_level(int, text, int), save_badge(text, text, text, boolean, int) from public, anon;
grant execute on function save_point_rule(text, int, int, boolean), save_level(int, text, int), save_badge(text, text, text, boolean, int) to authenticated;
