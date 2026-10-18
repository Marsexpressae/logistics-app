# Staff Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Richer staff profiles plus points, levels, streaks and badges that reward real work and exploring the app, with manager thank-yous, and no ranking.

**Architecture:** One new migration `0062_staff_rewards.sql` adds the tables, the profile columns, SECURITY DEFINER functions and triggers; the database counts work actions and the app records first-time feature use through one safe function. The sample-data mock mirrors the rules, a small pure library `src/lib/rewards.ts` holds level and progress maths, and four screens read through RPCs.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase (Postgres, RLS, `has_perm()`/`require_perm()`), node:test.

**Spec:** `docs/superpowers/specs/2026-10-18-staff-rewards-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md).
- Migration is numbered `0062_staff_rewards.sql`; functions are `security definer set search_path = public`; browser roles get `execute` only where stated (`revoke execute ... from public, anon; grant ... to authenticated`).
- Rewards tables have RLS on and no insert/update/delete policy for browser roles; only functions write.
- Permissions: `rewards.give`, `rewards.manage`, granted to `manager` and `super_admin` (group "Rewards").
- Mock storage key bumps from `logistics-mock-db-v38` to `logistics-mock-db-v39`.
- Every list heading is sortable (tests/sort.test.mts); touch targets 44px; no raw z-index numbers; hint paragraphs 14px (`text-sm`).
- Commit as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author trailer; never push, deploy or apply the migration without the owner's explicit word. Work on branch `staff-rewards`.
- Copy: sentence case, no "successfully", no "please".

## Review Focus

1. A trigger firing twice for one record must pay once (unique per `source_table`, `source_id`, `rule_key`); test by calling the award function twice.
2. A person with no profile row or an inactive person earns nothing and the work action still succeeds (rewards must never block a booking, payment or scan).
3. A call with `auth.uid()` null (migrations, server jobs, `app.merging_customers`-style bulk edits) awards nothing.
4. Phone and hidden birthdays never reach other staff through any function or select.
5. Existing staff and existing bookings: after the migration every profile works with all new columns empty, and old data earns no points retroactively.

---

### Task 1: Schema, profile fields, permissions, seed data

**Files:**
- Create: `supabase/migrations/0062_staff_rewards.sql`
- Test: `db-tests/rules.test.mts` (append)

**Interfaces:**
- Produces tables `point_rules(key pk, label, kind check in ('work','explore','daily'), points int, daily_cap int, once_per_person bool, active bool)`, `point_log(id bigint identity, person_id uuid references profiles on delete cascade, rule_key, points int, reason text, source_table text, source_id uuid, given_by uuid, created_at)` with unique index on `(person_id, rule_key, source_table, source_id)` where `source_id is not null`, `levels(number int pk, name, min_points int)`, `badges(key pk, name, description, icon, team text null, kind check in ('count','streak','manual'), rule_key text null, threshold int null, active)`, `person_badges(person_id, badge_key, earned_at, given_by, message, pk(person_id, badge_key))`, `reward_limits` as three `app_settings` rows (`rewards_daily_cap` 50, `rewards_thank_you_monthly_points` 200, `rewards_thank_you_monthly_count` 10).
- Produces new `profiles` columns: `photo_path text`, `job_title text`, `team text check in ('sales','pickup','warehouse','office')`, `birthday_day int`, `birthday_month int`, `hide_birthday bool default false`, `about text check length <= 200`, `phone text`, `joined_on date` (backfilled from `created_at`).
- Produces functions `update_my_profile(p_photo_path text, p_birthday_day int, p_birthday_month int, p_hide_birthday bool, p_about text, p_phone text) returns void` (own row only) and `set_staff_details(p_person_id uuid, p_team text, p_job_title text, p_joined_on date) returns void` (needs the existing staff-management permission, check the permission key used by the users API before writing), and `people_directory() returns table(id, full_name, role, team, job_title, about, photo_path, joined_on, birthday text, phone text)` where `birthday` is null when hidden and `phone` is null unless the caller has `rewards.manage` or is that person.
- Seed: eight `levels` (Rookie 0, Helper 100, Handler 300, Pro handler 700, Specialist 1500, Expert 3000, Master 6000, Legend 12000); `point_rules` rows `booking_created` 5, `payment_recorded` 3, `pickup_collected` 5, `parcel_moved` 1 (kind work, daily_cap 100 for parcel_moved, 50 for the others), `active_today` 2 (daily), and `use_bookings`, `use_warehouse`, `use_scan`, `use_accounts`, `use_customers`, `use_pickups`, `use_activity`, `use_search` each 10 (explore, once_per_person); starter `badges` (sales: `first_booking`, `bookings_100`; pickup: `first_pickup`, `pickups_100`; everyone: `scan_master` 1000 parcel_moved, `streak_7`, `explorer` (all explore rules used, manual-checked in Task 3), `team_player` manual).
- Storage: private bucket `staff-photos` (5 MB, jpeg/png/webp); read for any authenticated user, insert only into the caller's own folder `<uid>/...`, delete own folder only.

- [ ] **Step 1: Write failing db tests.** In `db-tests/rules.test.mts`, using the existing pattern that applies the migration file inside the always-rolled-back transaction until it is live: (a) tables exist and RLS blocks `insert into point_log` as a staff user; (b) `update_my_profile` changes only the caller's row and rejects `about` over 200 characters; (c) `set_staff_details` is refused for a staff user and works for a manager; (d) `people_directory()` as a staff user shows a hidden birthday as null and another person's phone as null, as a manager shows the phone; (e) seed counts: 8 levels, 14 point rules.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (file or tables missing).
- [ ] **Step 3: Write the migration** as specified above, with a header comment in the style of 0061.
- [ ] **Step 4: Run** `npm run test:db`. Expected: new tests pass, earlier 63 still pass.
- [ ] **Step 5: Commit** `git add supabase/migrations/0062_staff_rewards.sql db-tests/rules.test.mts && git commit -m "Staff rewards: schema, profile fields, permissions, seed data"`.

### Task 2: Points engine

**Files:**
- Modify: `supabase/migrations/0062_staff_rewards.sql`
- Test: `db-tests/rules.test.mts`

**Interfaces:**
- Produces internal `award_points(p_person uuid, p_rule text, p_source_table text, p_source_id uuid, p_reason text) returns int` (not granted to browser roles): returns points awarded (0 if person null, inactive or missing, rule inactive, `once_per_person` already used, same source already paid, rule `daily_cap` or `rewards_daily_cap` reached; partial awards are not made, over cap means 0). `active_today` pays only when the person has at least one work-kind line today.
- Triggers (all `after`, all call `award_points` with `auth.uid()` and never raise: wrap in `exception when others then null`): `bookings` insert → `booking_created`; `bookings` update where status becomes `collected` → `pickup_collected`; `payments` insert → `payment_recorded`; `parcels` update where status changed → `parcel_moved`. Source is the row id; reason is built from the booking code or barcode.
- Produces `record_feature_use(p_key text) returns int` (granted to authenticated; only keys whose rule kind is `explore` or `daily`; unknown key raises "Unknown feature"; for explore keys pays once; always also tries `active_today`).
- Produces `give_thank_you(p_person uuid, p_points int, p_message text) returns void` (needs `rewards.give`; refuses self, blank message, points < 1 or > 100, inactive person; enforces the monthly points and count limits per giver; writes a point_log line with rule_key `thank_you`, `given_by`, reason = message).
- Produces `my_rewards() returns jsonb` with `{total, level_number, level_name, next_level_name, next_min, streak, today}` and `person_rewards(p_person uuid)` returning the same shape plus `recent` (last 20 log lines: points, reason, created_at), allowed for any authenticated user for active people.
- Streak: consecutive days ending today or yesterday with at least one work-kind log line, in the Asia/Dubai timezone.

- [ ] **Step 1: Failing db tests**, one per rule: booking insert pays the creator 5 and a second `award_points` call for the same booking pays 0; the cap stops the 101st parcel move in a day; `record_feature_use('use_scan')` pays 10 once then 0; unknown key raises; `active_today` pays 0 before any work and 2 after, once; a thank-you from a manager works and appears in the person's total, self thank-you refused, 11th in a month refused, a staff user refused; an `auth.uid()` null insert (via the owner connection) awards nothing; the streak is 2 after lines on yesterday and today and 1 after a gap; an inactive person earns nothing and the booking still saves.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions and triggers above in the migration.
- [ ] **Step 4: Run** `npm run test:db`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: points engine, caps, streaks, thank-yous"`.

### Task 3: Badges

**Files:**
- Modify: `supabase/migrations/0062_staff_rewards.sql`
- Test: `db-tests/rules.test.mts`

**Interfaces:**
- Produces internal `check_badges(p_person uuid) returns int` called at the end of `award_points`: for each active `count` badge whose team is null or equals the person's team, counts `point_log` lines for `rule_key` and inserts `person_badges` when the count reaches `threshold`; for `streak` badges compares the streak to `threshold`; never removes; `explorer` is granted when the person has paid every active explore rule.
- Produces `give_badge(p_person uuid, p_badge text, p_message text) returns void` (needs `rewards.give`; badge must be kind `manual`; refuses self and duplicates with a plain message).
- Produces `my_badges()` and `person_badges_of(p_person uuid)` returning `jsonb[]` of `{key, name, description, icon, earned_at, message, progress, goal}` for every active badge applicable to the person's team (earned ones have `earned_at`; locked ones carry `progress` and `goal`).
- Produces `wins_feed(p_limit int default 20) returns table(kind text, person_id uuid, person_name text, title text, message text, created_at timestamptz)` combining badges earned and thank-yous, newest first, active people only, no points shown.

- [ ] **Step 1: Failing db tests:** the 100th booking creates `bookings_100` for a sales person and not for a pickup person; a badge is not removed when points are later negative-free; `give_badge` refused for staff and for self, refused for a count badge; `my_badges` shows `progress 340 goal 500` shape for a locked count badge; `wins_feed` hides inactive people and does not contain points or phone.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** in the migration; grant `execute` on the public functions to `authenticated` and revoke from `public, anon`.
- [ ] **Step 4: Run** `npm run test:db`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: badges, manual awards, wins feed"`.

### Task 4: Sample-data mock and pure library

**Files:**
- Modify: `src/lib/mock-supabase.ts`
- Create: `src/lib/rewards.ts`, `tests/rewards.test.mts`

**Interfaces:**
- Consumes: the SQL function names and return shapes from Tasks 1–3.
- Produces `src/lib/rewards.ts`: `levelFor(total: number, levels: Level[]): { level: Level; next: Level | null; toNext: number; percent: number }`, `streakOf(days: string[], today: string): number`, `birthdayLabel(day: number | null, month: number | null, hidden: boolean): string | null`, and types `Level`, `BadgeView`, `Rewards`.
- Produces in the mock: the same RPCs (`update_my_profile`, `set_staff_details`, `people_directory`, `record_feature_use`, `give_thank_you`, `give_badge`, `my_rewards`, `person_rewards`, `my_badges`, `person_badges_of`, `wins_feed`) with identical rules and messages, seed rows for rules, levels and badges, table support for `point_rules`, `levels`, `badges` reads, and the award triggers on mock inserts of bookings and payments, collected status and parcel status changes. The key becomes `logistics-mock-db-v39`.

- [ ] **Step 1: Write failing tests** in `tests/rewards.test.mts` for `levelFor` (0 points is level 1, exact threshold moves up, top level has `next: null`), `streakOf` (gap resets, today missing but yesterday present keeps the streak), `birthdayLabel`; and mock tests mirroring the db tests of Tasks 2–3 (booking pays 5 once, cap, once-per-person, unknown key, thank-you rules, badge at threshold, hidden birthday and phone in `people_directory`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/lib/rewards.ts` (import `./format.ts` style relative imports, no `@/` alias, so node can run it) and the mock changes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass (existing 225 plus the new ones), then `npx tsc --noEmit` and `npx eslint src tests` clean.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: mock backend and level/streak library"`.

### Task 5: My profile and colleague profile

**Files:**
- Modify: `src/app/account/page.tsx` (keep the password card; add the profile on top), `src/lib/types.ts`
- Create: `src/app/people/[id]/page.tsx`, `src/components/rewards/{LevelBar,BadgeGrid,PointsList,ProfileHeader,ProfileEditor}.tsx`
- Test: `tests/rewards-screens.test.mts` (static checks in the style of `tests/touch-targets.test.mts`)

**Interfaces:**
- Consumes: `my_rewards`, `person_rewards`, `my_badges`, `person_badges_of`, `people_directory`, `update_my_profile`, `levelFor`, `birthdayLabel`.
- Produces `ProfileHeader({ person, rewards })`, `LevelBar({ rewards })`, `BadgeGrid({ badges })` (earned green, locked dashed with `progress of goal`), `PointsList({ lines })` (sortable headings: When, Why, Points), `ProfileEditor` (photo upload to `staff-photos/<uid>/`, birthday, hide birthday, about, phone, "Saved" feedback, errors shown plainly).

- [ ] **Step 1: Failing screen tests:** the new components contain no raw `z-` numbers, every button/link has `min-h-11` or an equivalent 44px class, hint paragraphs use `text-sm`, and the account page imports `ProfileHeader`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build the screens** per the spec section 4; the page title becomes "My profile"; the colleague page is read-only and shows no phone to non-managers (the directory already enforces it). Link staff names in Sales rep and Owner displays to `/people/<id>` only where an id is already on screen; do not add new queries for that.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; check both pages on the sample-data dev server (`NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001`). Expected: clean, pages render.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: my profile and colleague profile"`.

### Task 6: Feature tracking, new-badge toast and wins feed

**Files:**
- Create: `src/components/rewards/{FeatureUseTracker,WinsFeed}.tsx`
- Modify: `src/components/layout/AppShell.tsx`, `src/app/page.tsx`
- Test: `tests/rewards-screens.test.mts` (append)

**Interfaces:**
- Produces `FeatureUseTracker`: mounted once in AppShell; maps the current route to a feature key (`/bookings` → `use_bookings`, `/warehouse-inventory` → `use_warehouse`, `/scan` → `use_scan`, `/accounts` → `use_accounts`, `/customers` → `use_customers`, `/pickups` → `use_pickups`, `/activity` → `use_activity`, search opening → `use_search`); calls `record_feature_use` at most once per key per browser session (in-memory set; errors ignored); after a call that returned points or after login, compares `my_badges()` to the last seen set in `localStorage` (wrapped in try/catch) and shows one toast per new badge through the existing notification toast.
- Produces `WinsFeed({ limit })` calling `wins_feed`, shown on the dashboard, no points, no ranking.

- [ ] **Step 1: Failing tests:** a pure helper `featureKeyFor(pathname: string): string | null` in `src/lib/rewards.ts` (add to Task 4's file, tested here) returns the keys above and null otherwise; static test that AppShell mounts `FeatureUseTracker`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, tracker, feed and mounting.
- [ ] **Step 4: Run** the full checks as in Task 5 and watch the toast and feed on the sample server. Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: feature tracking, badge toast, wins feed"`.

### Task 7: Manager settings

**Files:**
- Create: `src/app/settings/rewards/page.tsx`, `src/components/rewards/{RulesTable,LevelsTable,BadgesTable,GiveForm}.tsx`
- Modify: the Settings index page and nav list (follow `src/lib/nav-settings.ts`), `supabase/migrations/0062_staff_rewards.sql`, `src/lib/mock-supabase.ts`
- Test: `db-tests/rules.test.mts`, `tests/rewards.test.mts`, `tests/sort.test.mts` (existing all-headings test must pass)

**Interfaces:**
- Produces RPCs (all need `rewards.manage` except the two give forms which reuse Task 2–3 functions): `save_point_rule(p_key text, p_points int, p_daily_cap int, p_active bool)`, `save_level(p_number int, p_name text, p_min_points int)` (thresholds must stay increasing), `save_badge(p_key text, p_name text, p_description text, p_active bool, p_threshold int)`; the page shows tables with sortable headings, inline editing with "Saved", and two forms "Give a thank-you" and "Give a badge" gated by `rewards.give`.

- [ ] **Step 1: Failing tests:** db and mock: a staff user cannot save a rule, a manager can, level thresholds out of order are refused with a plain message, a negative or over-1000 point value is refused; sort test covers the new tables.
- [ ] **Step 2: Run** `npm run test:db` and `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** RPCs, mock mirrors and the page.
- [ ] **Step 4: Run** `npm run test:db`, `npm test`, `npx tsc --noEmit`, `npx eslint src tests`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -am "Staff rewards: manager settings for rules, levels and badges"`.

### Task 8: Go-live checks (stops for the owner)

**Files:** none new.

- [ ] **Step 1:** Run the full suite once more (`npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx eslint src tests`, `npm run build`). Expected: all clean.
- [ ] **Step 2:** Final whole-branch review by a fresh most-capable reviewer; one fix pass; delete the plan workspace.
- [ ] **Step 3:** Stop and tell the owner: committed on `staff-rewards`, not live; migration 0062 changes the live database immediately and only adds tables and columns, so the running app keeps working. Wait for "apply", then `npm run db:backup`, `npm run db:migrate`, `npm run test:db` (remove the temporary migration-reading lines from the db tests), and only after the owner says "push to preview" push the branch, and "merge" to put it on `main`.
