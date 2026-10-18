-- One team: badges for everyone, in families with medal tiers, a Team overview, and adding badges.
-- Design: docs/superpowers/specs/2026-10-18-team-medals-design.md (builds on 0062_staff_rewards.sql)
--
-- Everyone sees and can earn every badge: the sales-only and pickup-only split is gone (the team on a profile is only information).
-- A badge belongs to a family (bookings, pickups, ...) and has a tier from 1 to 5; the medal colour follows the tier.
-- This migration only adds columns, functions and starter data, so the running app keeps working.

-- ---------- families and tiers ----------
alter table badges add column if not exists family text;
alter table badges add column if not exists tier int;
do $$ begin
  alter table badges add constraint badges_tier_check check (tier is null or tier between 1 and 5);
exception when duplicate_object then null; end $$;
create unique index if not exists badges_family_tier_key on badges (family, tier) where family is not null and tier is not null;

-- everyone sees every badge
update badges set team = null where team is not null;

-- the first eight badges move into families (keys and goals stay)
update badges set family = 'bookings', tier = 1 where key = 'first_booking' and family is null;
update badges set family = 'bookings', tier = 4 where key = 'bookings_100' and family is null;
update badges set family = 'pickups',  tier = 1 where key = 'first_pickup' and family is null;
update badges set family = 'pickups',  tier = 4 where key = 'pickups_100' and family is null;
update badges set family = 'parcels',  tier = 3 where key = 'scan_master' and family is null;
update badges set family = 'streaks',  tier = 2 where key = 'streak_7' and family is null;

insert into badges (key, name, description, icon, team, kind, rule_key, threshold, family, tier) values
  ('bookings_10',  '10 bookings',   'Made 10 bookings',                 'file-plus', null, 'count', 'booking_created',  10,  'bookings', 2),
  ('bookings_50',  '50 bookings',   'Made 50 bookings',                 'file-plus', null, 'count', 'booking_created',  50,  'bookings', 3),
  ('bookings_500', '500 bookings',  'Made 500 bookings',                'file-plus', null, 'count', 'booking_created',  500, 'bookings', 5),
  ('pickups_10',   '10 pickups',    'Collected 10 pickups',             'truck',     null, 'count', 'pickup_collected', 10,  'pickups',  2),
  ('pickups_50',   '50 pickups',    'Collected 50 pickups',             'truck',     null, 'count', 'pickup_collected', 50,  'pickups',  3),
  ('pickups_500',  '500 pickups',   'Collected 500 pickups',            'truck',     null, 'count', 'pickup_collected', 500, 'pickups',  5),
  ('payments_10',  '10 payments',   'Recorded 10 payments',             'receipt',   null, 'count', 'payment_recorded', 10,  'payments', 1),
  ('payments_50',  '50 payments',   'Recorded 50 payments',             'receipt',   null, 'count', 'payment_recorded', 50,  'payments', 2),
  ('payments_200', '200 payments',  'Recorded 200 payments',            'receipt',   null, 'count', 'payment_recorded', 200, 'payments', 3),
  ('parcels_50',   '50 parcels',    'Moved or scanned 50 parcels',      'scan',      null, 'count', 'parcel_moved',     50,  'parcels',  1),
  ('parcels_250',  '250 parcels',   'Moved or scanned 250 parcels',     'scan',      null, 'count', 'parcel_moved',     250, 'parcels',  2),
  ('streak_3',     'Three in a row',   'Worked in the app 3 days in a row',  'flame', null, 'streak', null, 3,  'streaks', 1),
  ('streak_14',    'Fortnight streak', 'Worked in the app 14 days in a row', 'flame', null, 'streak', null, 14, 'streaks', 3),
  ('streak_30',    'Month streak',     'Worked in the app 30 days in a row', 'flame', null, 'streak', null, 30, 'streaks', 4),
  ('thanks_1',     'Thanked',          'Got your first thank-you',        'heart', null, 'count', 'thank_you', 1,  'appreciated', 1),
  ('thanks_5',     'Appreciated',      'Got 5 thank-yous',                'heart', null, 'count', 'thank_you', 5,  'appreciated', 2),
  ('thanks_20',    'Much appreciated', 'Got 20 thank-yous',               'heart', null, 'count', 'thank_you', 20, 'appreciated', 3),
  ('star_of_month','Star of the month','Given by a manager to the person who shone this month', 'star', null, 'manual', null, null, null, null)
on conflict (key) do nothing;

-- ---------- earning and listing no longer look at the team ----------
create or replace function check_badges(p_person uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b badges; prog int[]; got int := 0;
begin
  if not exists (select 1 from profiles where id = p_person and active) then return 0; end if;
  for b in
    select * from badges bd where bd.active and bd.kind in ('count', 'streak')
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

create or replace function person_badges_of(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if (select app_role()) is null then raise exception 'You are not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_person and active) then raise exception 'Person not found'; end if;
  select coalesce(jsonb_agg(x.item order by x.earned desc nulls last, x.name), '[]'::jsonb) into out
  from (
    select b.name, pb.earned_at as earned,
      jsonb_build_object(
        'key', b.key, 'name', b.name, 'description', b.description, 'icon', b.icon, 'family', b.family, 'tier', b.tier,
        'earned_at', pb.earned_at, 'message', pb.message,
        'progress', case when pb.earned_at is null then (badge_progress(p_person, b))[1] end,
        'goal', case when pb.earned_at is null then (badge_progress(p_person, b))[2] end
      ) as item
    from badges b
    left join person_badges pb on pb.badge_key = b.key and pb.person_id = p_person
    where pb.earned_at is not null or b.active
  ) x;
  return out;
end $$;
