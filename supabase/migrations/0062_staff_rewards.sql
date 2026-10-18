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
  ('rewards_daily_cap', '50'::jsonb, 'Most points one person can earn from work in a day', 'Points over this are not recorded'),
  ('rewards_thank_you_monthly_points', '200'::jsonb, 'Most points a manager can give as thank-yous in a month', null),
  ('rewards_thank_you_monthly_count', '10'::jsonb, 'Most thank-yous a manager can give in a month', null)
on conflict (key) do nothing;

create or replace function setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = p_key), p_default)
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
create policy rules_read on point_rules for select to authenticated using (true);
drop policy if exists levels_read on levels;
create policy levels_read on levels for select to authenticated using (true);
drop policy if exists badges_read on badges;
create policy badges_read on badges for select to authenticated using (true);
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
  birthday_day int, birthday_month int, phone text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.team, p.job_title, p.about, p.photo_path, p.joined_on,
    case when p.hide_birthday and p.id <> (select auth.uid()) then null else p.birthday_day end,
    case when p.hide_birthday and p.id <> (select auth.uid()) then null else p.birthday_month end,
    case when p.id = (select auth.uid()) or has_perm('rewards.manage') then p.phone else null end
  from profiles p
  where p.active and (select auth.uid()) is not null
$$;

revoke execute on function update_my_profile(text, int, int, boolean, text, text), set_staff_details(uuid, text, text, date), people_directory() from public, anon;
grant execute on function update_my_profile(text, int, int, boolean, text, text), set_staff_details(uuid, text, text, date), people_directory() to authenticated;

-- ---------- private storage for staff photos: each person writes only inside their own folder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-photos', 'staff-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists staff_photos_read on storage.objects;
create policy staff_photos_read on storage.objects for select to authenticated using (bucket_id = 'staff-photos');
drop policy if exists staff_photos_add on storage.objects;
create policy staff_photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists staff_photos_change on storage.objects;
create policy staff_photos_change on storage.objects for update to authenticated
  using (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists staff_photos_remove on storage.objects;
create policy staff_photos_remove on storage.objects for delete to authenticated
  using (bucket_id = 'staff-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
