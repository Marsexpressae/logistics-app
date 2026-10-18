# One Team: Shared Badges, Medals and a Team Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every badge visible to everyone, group badges into families with medal tiers, show them as colourful medals on a medal wall, add a Team page and richer colleague profiles, a celebration pop-up, and a screen to add badges.

**Architecture:** One new migration `0063_team_medals.sql` (extends the rewards tables and functions from 0062), mirrored in the sample-data mock; a small pure library for grouping badges and medal colours; new presentational components (medal, level emblem, streak flame, medal wall) replace the plain badge grid; a `/team` page reads one new function.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase (Postgres, RLS, SECURITY DEFINER functions), node:test.

**Spec:** `docs/superpowers/specs/2026-10-18-team-medals-design.md` (builds on `docs/superpowers/specs/2026-10-18-staff-rewards-design.md`). Work continues on branch `staff-rewards`; migration 0062 is live, 0063 is not.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md).
- Migration is `0063_team_medals.sql`; every function is `security definer set search_path = public`, granted `execute` to `authenticated` and revoked from `public, anon`; internal helpers are revoked from `authenticated` too.
- Functions that read people or rewards data refuse anyone without an active profile (`(select app_role()) is null`).
- No new function returns phone numbers, hidden birthdays, point reasons or other people's points (except the existing `person_rewards` total and level).
- Mock storage key bumps from `logistics-mock-db-v39` to `logistics-mock-db-v40`.
- Every list heading is sortable (`SortableTh` + `useSort`); touch targets 44px; no raw z-index numbers (`z-(--z-toast)` style names); hint paragraphs 14px (`text-sm`) on screens; animation is switched off with `prefers-reduced-motion`.
- The DB tests apply the migration inside each rolled-back transaction until it is live (pattern from 0062: a `const withTeamMedals = (db) => db.owner(readFileSync(MIGRATION, "utf8"))` helper, removed after the owner applies the migration).
- Commit as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author trailer; never push, deploy or apply the migration without the owner's explicit word.
- Copy: sentence case, no "successfully", no "please".

## Review Focus

1. A person on any team (including no team) sees and can earn every badge; none are hidden by an empty `team`.
2. The medal wall shows the highest earned tier of a family even when a lower tier was earned later, and never shows two tiers of one family as separate earned medals.
3. `team_overview` and `person_wins` must not leak points, phone numbers, hidden birthdays or point reasons, and must return nothing to a login without an active profile.
4. Adding a badge (`create_badge`) must not break existing earners or the starting set (duplicate name, bad threshold, unknown rule).
5. Confetti and animations are off with reduced motion and never block a tap or cover the page controls.

---

### Task 1: Badge families, tiers, and badges for everyone

**Files:**
- Create: `supabase/migrations/0063_team_medals.sql`
- Test: `db-tests/rules.test.mts` (append)

**Interfaces:**
- Produces on `badges`: `family text`, `tier int check (tier between 1 and 5)`; unique index on `(family, tier)` where both are not null.
- Produces seed (26 badges in total; existing 8 keep their keys): families `bookings` (`first_booking` t1 goal 1, `bookings_10` t2, `bookings_50` t3, `bookings_100` t4, `bookings_500` t5), `pickups` (`first_pickup` t1, `pickups_10` t2, `pickups_50` t3, `pickups_100` t4, `pickups_500` t5; rule `pickup_collected`), `payments` (`payments_10` t1, `payments_50` t2, `payments_200` t3; rule `payment_recorded`; icon `receipt`), `parcels` (`parcels_50` t1, `parcels_250` t2, `scan_master` t3 goal 1000; rule `parcel_moved`), `streaks` (`streak_3` t1, `streak_7` t2, `streak_14` t3, `streak_30` t4; kind `streak`), `appreciated` (`thanks_1` t1, `thanks_5` t2, `thanks_20` t3; rule `thank_you`; icon `heart`). One-offs without family: `explorer`, `team_player`, and new manual `star_of_month` (icon `star`). Every badge gets `team = null`.
- Modifies `check_badges(p_person uuid)` and `person_badges_of(p_person uuid)`: no team filter; `person_badges_of` items gain `family` and `tier` keys (null for one-offs). All other keys unchanged: `key, name, description, icon, earned_at, message, progress, goal`.
- Consumes: 0062 tables and functions.

- [ ] **Step 1: Write failing db tests.** (a) a person with team `pickup` and one with no team both see `first_booking` and `pickups_100` in `person_badges_of`; (b) 26 badges, every family has unique tiers, the 8 original keys still exist with their old goals; (c) a pickup-team person with 99 old `booking_created` lines earns `first_booking` and `bookings_10` and `bookings_50` on their next paid booking (use the `oldLines` helper) and not `bookings_100` until the 100th; (d) a later-earned lower tier never removes a higher one; (e) `thanks_1` is earned by the first `give_thank_you` received and shows progress `n of 5` for `thanks_5`.
- [ ] **Step 2: Run** `node --no-warnings --experimental-transform-types --test --test-name-pattern="team medals" db-tests/rules.test.mts`. Expected: FAIL (migration file missing).
- [ ] **Step 3: Write the migration** (header comment in the style of 0062; idempotent: `add column if not exists`, `on conflict (key) do update` for the family/tier/team of the 8 existing, `on conflict do nothing` for the new ones, `create or replace function`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add supabase/migrations/0063_team_medals.sql db-tests/rules.test.mts && git commit -m "Team medals: badge families, tiers and badges for everyone"`.

### Task 2: Team overview, achievements and adding badges

**Files:**
- Modify: `supabase/migrations/0063_team_medals.sql`
- Test: `db-tests/rules.test.mts` (append)

**Interfaces:**
- Produces `team_overview() returns table(id uuid, full_name text, photo_path text, job_title text, team text, level_number int, level_name text, streak int, badge_count int)`: active people only, requires an active caller profile, no points, no phone, no birthday.
- Produces `person_wins(p_person uuid, p_limit int default 20) returns table(kind text, title text, message text, created_at timestamptz)`: that person's badges earned (`kind 'badge'`, `title` = badge name, `message` = manager's message) and thank-yous received (`kind 'thank_you'`, `title` = `'Thanked by ' || giver`, `message` = the thank-you text), newest first, limit clamped 1..100, no point reasons from work lines, empty for a login without an active profile or for an inactive person.
- Produces `create_badge(p_name text, p_description text, p_icon text, p_family text, p_tier int, p_kind text, p_rule_key text, p_threshold int) returns text` (returns the new key): needs `rewards.manage`; name required and unique (case-insensitive) else "A badge with that name already exists"; icon must be one of `star, file-plus, package, truck, receipt, scan, flame, compass, heart, trophy` else "Choose an icon from the list"; kind in `count, streak, manual`; count needs `p_rule_key` of an existing rule key or `explore` or `thank_you` else "Choose what is counted"; count and streak need `p_threshold >= 1`; `p_tier` null or 1..5 and unique inside a family else "That tier is already taken in this family"; key is the lower-case name with non-letters turned into `_`, made unique with a numeric suffix.
- Consumes: Task 1's `badges.family/tier`, 0062's `streak_of`, `badge_progress`, `levels`.

- [ ] **Step 1: Write failing db tests.** (a) `team_overview` as staff lists only active people, columns exactly as above (assert the key list), shows `badge_count` and `streak`, hides the person who is inactive; (b) a login with no active profile gets 0 rows from `team_overview()` and `person_wins`; (c) `person_wins` shows a badge and a thank-you for a person, and contains no `reason` of a `booking_created` line and no points; (d) `create_badge` refused for staff, creates a count badge for `payment_recorded` goal 7 that is then earned at the 7th payment (use `award_points`), refuses a duplicate name, an icon not in the list, a threshold of 0, an unknown rule key and a taken tier.
- [ ] **Step 2: Run** the team-medals tests. Expected: FAIL (functions missing).
- [ ] **Step 3: Implement** the three functions in the migration, with grants and revokes.
- [ ] **Step 4: Run** the team-medals tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Team medals: team overview, achievements and adding badges"`.

### Task 3: Sample-data mock and badge library

**Files:**
- Modify: `src/lib/mock-rewards.ts`, `src/lib/mock-supabase.ts`, `src/lib/rewards.ts`
- Test: `tests/rewards.test.mts` (append)

**Interfaces:**
- Consumes: Task 1 and 2 SQL names, shapes and messages.
- Produces in `src/lib/rewards.ts`: `BadgeView` gains `family: string | null` and `tier: number | null`; `FAMILY_LABEL: Record<string, string>` (`bookings` "Bookings", `pickups` "Pickups", `payments` "Payments", `parcels` "Parcels", `streaks` "Streaks", `appreciated` "Appreciated"); `groupBadges(badges: BadgeView[]): { family: string | null; label: string; earnedTop: BadgeView | null; next: BadgeView | null; earnedCount: number; items: BadgeView[] }[]` (one group per family sorted by label, one-offs each as their own group with `family: null`; `earnedTop` is the earned badge with the highest tier; `next` is the unearned badge with the lowest tier above it; one-offs: `earnedTop` is the badge itself if earned, else `next` is it); `medalColors(tier: number | null): { ring: string; fill: string; ink: string }` (hex strings from the palette: tier 1 bronze `#BA7517/#FAEEDA/#633806`, 2 silver `#888780/#F1EFE8/#444441`, 3 gold `#EF9F27/#FAEEDA/#412402`, 4 blue `#378ADD/#E6F1FB/#042C53`, 5 purple `#7F77DD/#EEEDFE/#26215C`; null tier uses the teal set `#1D9E75/#E1F5EE/#04342C`); `levelBand(levelNumber: number): 1 | 2 | 3 | 4` (1-2 → 1, 3-4 → 2, 5-6 → 3, 7+ → 4); `TeamMember` type matching `team_overview` rows.
- Produces in the mock: the 26 seeded badges, no team filtering, `team_overview`, `person_wins`, `create_badge` with the same rules and messages as the SQL, `person_badges_of`/`my_badges` items with `family` and `tier`. Key `logistics-mock-db-v40`.

- [ ] **Step 1: Write failing tests** in `tests/rewards.test.mts`: `groupBadges` (top earned tier, next goal, one-offs, label sort, nothing earned gives `earnedTop: null` and `next` = tier 1), `medalColors` (each tier and null), `levelBand` (1,2→1; 3,4→2; 5,6→3; 7,8→4), and mock tests mirroring Task 1 and 2 db tests (everyone sees all 26, tier earned at goal, `team_overview` has no points key and no inactive person, `person_wins` shows badge and thank-you only, `create_badge` rules and messages, an inactive person gets nothing).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the library functions and the mock changes.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`. Expected: all pass and clean.
- [ ] **Step 5: Commit** `git commit -am "Team medals: mock backend and badge library"`.

### Task 4: Medals, level emblem, streak flame and the medal wall

**Files:**
- Create: `src/components/rewards/Medal.tsx`, `src/components/rewards/LevelEmblem.tsx`, `src/components/rewards/StreakFlame.tsx`
- Modify: `src/components/rewards/BadgeGrid.tsx` (becomes the medal wall), `src/components/rewards/ProfileHeader.tsx`, `src/components/rewards/LevelBar.tsx`
- Test: `tests/rewards-screens.test.mts` (append)

**Interfaces:**
- Consumes: `groupBadges`, `medalColors`, `levelBand`, `BadgeView`, `Rewards` from `src/lib/rewards.ts`.
- Produces `Medal({ badge, state }: { badge: BadgeView; state: "earned" | "next" | "locked" })` (round medal with tier colours, ribbon tails, icon from `badge.icon` via the same lucide map as before plus `receipt`, `trophy`; `next` and `locked` are dimmed with an SVG progress ring using `progress/goal`; accessible name "Bookings, 100 bookings, earned" or "..., 61 of 100"), `LevelEmblem({ level, name })` (hexagon via clip-path, colour by `levelBand`), `StreakFlame({ days })` (flame icon with the count, larger at 7 and 30 days, label "days in a row"), `BadgeGrid({ badges })` (the wall: one tile per `groupBadges` group showing `earnedTop` as `earned` and `next` as `next`, or the one-off).

- [ ] **Step 1: Write failing screen tests:** the three new components exist; `BadgeGrid` imports `groupBadges` and `Medal`; `ProfileHeader` uses `LevelEmblem` and `StreakFlame`; none of the new files has a raw `z-` number or a 12px hint paragraph; medals carry an accessible name (`aria-label`); the ring is an inline SVG (no gradients).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build the components** from the mockup shown to the owner (medal disc with a 5px tier-coloured border, two ribbon tails, hexagon emblem, flame in an amber block) using only flat colours; keep sentence-case copy.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; check My profile and a colleague profile on the sample-data dev server (`NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001`) at phone width and desktop width. Expected: clean, medals render, nothing overflows.
- [ ] **Step 5: Commit** `git commit -am "Team medals: medals, level emblem, streak flame and medal wall"`.

### Task 5: Team page and colleague achievements

**Files:**
- Create: `src/app/team/page.tsx`, `src/components/rewards/TeamCard.tsx`, `src/components/rewards/AchievementsList.tsx`
- Modify: `src/config/navigation.ts` (new nav item and access rule), `src/app/people/[id]/page.tsx`, `src/components/layout/BottomNav.tsx` only if the menu needs it
- Test: `tests/access-rules.test.mts`, `tests/rewards-screens.test.mts` (append)

**Interfaces:**
- Consumes: `team_overview`, `person_wins`, `LevelEmblem`, `StreakFlame`, `TeamMember`.
- Produces `/team` (every active colleague as a `TeamCard`, sorted by name, with a name search box if the list has more than 12 people; page wrapped in `Suspense` when it uses `useSort`); a nav item `{ label: "Team", href: "/team", icon: Users, anyOf: ["*"] }` placed after Tracking; `canAccess([], "/team")` is true; `AchievementsList({ person })` calling `person_wins` on the colleague page under the medal wall.

- [ ] **Step 1: Write failing tests:** `canAccess([], "/team")` and `/team/x` follow the rule for everyone signed in; the nav list contains Team and the existing order tests still pass; the page and card files exist; `TeamCard` links to `/people/<id>`; the page has no points (`total` and `points` are not read) and no raw z-index; the colleague page includes `AchievementsList` and still does not include `PointsList` or `ProfileEditor`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build** the page, card and list; add the nav item and rule (check `tests/access-rules.test.mts` and the Tracking order test for ordering assumptions and update them to include Team).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; look at `/team` and a profile on the dev server. Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Team medals: Team page and colleague achievements"`.

### Task 6: Celebration pop-up

**Files:**
- Create: `src/components/rewards/Celebration.tsx`
- Modify: `src/components/rewards/FeatureUseTracker.tsx`, `src/app/globals.css` (keyframes under a reduced-motion guard)
- Test: `tests/rewards-screens.test.mts` (append)

**Interfaces:**
- Consumes: `Medal`, the existing `newBadges` helper and the tracker's `fresh` list.
- Produces `Celebration({ badge, onClose }: { badge: BadgeView; onClose: () => void })`: a large card on `z-(--z-toast)` with the medal, "You earned <name>", the badge message or description, a "See my badges" link to `/account`, a 44px Close button, and about 18 confetti pieces drawn with CSS only (`@keyframes confetti-fall`), `aria-live="polite"`, pointer-events none on the confetti layer; `globals.css` adds the keyframes inside `@media (prefers-reduced-motion: no-preference)` so nothing moves otherwise.

- [ ] **Step 1: Write failing tests:** the component exists and uses `z-(--z-toast)`; `globals.css` has the keyframes inside a `prefers-reduced-motion: no-preference` block; the confetti layer has `pointer-events-none`; the tracker renders `Celebration` instead of its inline card.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build** the component and wire it into the tracker.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; trigger a badge on the dev server (clear `rewards-seen-badges:mock-user` in local storage, earn a badge) and check the pop-up. Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Team medals: celebration pop-up with confetti"`.

### Task 7: Add a badge screen

**Files:**
- Create: `src/components/rewards/AddBadgeForm.tsx`
- Modify: `src/app/settings/rewards/page.tsx`, `src/components/rewards/BadgesTable.tsx` (show family and tier columns, sortable)
- Test: `tests/rewards-screens.test.mts` (append)

**Interfaces:**
- Consumes: `create_badge`, the existing `point_rules` list for the "what is counted" choices (`explore` and `thank_you` added by hand), `BadgeRow` (gains `family`, `tier`).
- Produces `AddBadgeForm({ rules, onAdded })`: fields name, description, icon (radio list of the 10 icons with their medal preview), family (free text or one of the existing families), tier (1 to 5), kind (counts something / days in a row / given by hand), counted thing, goal; shows the plain error message from the database; "Saved" on success; shown only with `rewards.manage`.

- [ ] **Step 1: Write failing tests:** the form exists and calls `create_badge`; the settings page includes it behind `can("rewards.manage")`; `BadgesTable` has sortable Family and Tier columns and still no plain `<th className="px-4 py-3`; buttons carry 44px classes.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build** the form and table changes.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; add a badge on the dev server and see it on a profile. Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Team medals: add a badge screen"`.

### Task 8: Go-live checks (stops for the owner)

**Files:** none new.

- [ ] **Step 1:** Run `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx eslint src tests`, and `npm run build` (with the three Supabase variables empty). Expected: all clean.
- [ ] **Step 2:** Final whole-branch review by a fresh most-capable reviewer; one fix pass with a failing test first for each finding; delete the plan workspace.
- [ ] **Step 3:** Stop and tell the owner: committed on `staff-rewards`, not live; migration 0063 changes the live database immediately and only adds columns, functions and starter data, so the running app keeps working. Wait for "apply", then `npm run db:backup`, `npm run db:migrate`, remove the temporary migration-reading lines from the db tests, `npm run test:db`; only after "push to preview" push the branch, and "merge" to put it on `main`.
