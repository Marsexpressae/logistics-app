# One team: shared badges, medals and a Team page

Status: design agreed in chat on 2026-10-18, waiting for written-spec review. Builds on `2026-10-18-staff-rewards-design.md` (version 1 of rewards, already built on the branch `staff-rewards`, migration 0062 live).

## Why

The owner looked at the first version and said two things: the badges look plain, not like a game, and the staff are one team, all equal. They want everyone to be motivated and to look at each other's profiles. So:

- Everyone sees the same badges. There is no sales-only or pickup-only badge set.
- Everyone can look at everyone's profile and medal wall.
- The badges look like medals, with colour and levels, so earning one feels like winning something.

## Decisions

- No ranking and no leaderboard. The Team page is sorted by name. Cards show level, streak and badge count, not points.
- The team field on a profile (sales, pickup, warehouse, office) stays as information only. It no longer decides which badges a person can see or earn.
- Booking-level point history stays private (it names bookings that some staff cannot open). A profile shows achievements instead: badges earned and thank-yous.
- A person's total points and level stay visible on their profile, as in version 1.
- No online status, no timers, no "on time" badges (still waiting on due-time data).

## 1. Badges for everyone, in families with levels

A badge belongs to a **family** and has a **tier** (1 to 5). A family is one thing you keep doing (bookings, pickups, and so on) with several steps. The medal colour follows the tier: bronze, silver, gold, blue, purple. The icon follows the family.

Database changes on `badges` (migration `0063_team_medals.sql`):

- New columns `family text` and `tier int` (both nullable; a one-off badge has no family).
- `team` is set to null on every badge (everyone sees every badge). The column stays for later use.
- The existing badges are placed in families and keep their keys: `first_booking` (bookings, tier 1), `bookings_100` (bookings, tier 4), `first_pickup` (pickups, tier 1), `pickups_100` (pickups, tier 4), `scan_master` (parcels, tier 3), `streak_7` (streaks, tier 2), `explorer` (one-off), `team_player` (one-off, by hand).
- New badges, each a goal on an existing rule:
  - Bookings: 10, 50 and 500 bookings (tiers 2, 3, 5).
  - Pickups: 10, 50 and 500 pickups (tiers 2, 3, 5).
  - Payments: 10, 50 and 200 payments recorded (tiers 1, 2, 3).
  - Parcels: 50 and 250 parcels moved or scanned (tiers 1, 2); `scan_master` at 1,000 stays tier 3.
  - Streaks: 3, 14 and 30 days in a row (tiers 1, 3, 4); `streak_7` stays tier 2.
  - Appreciated: 1, 5 and 20 thank-yous received (tiers 1, 2, 3), counting `thank_you` lines.
  - One-off, by hand: Star of the month.
- `check_badges` and `person_badges_of` stop filtering by team. Nothing else about earning changes. Existing history does not earn the new badges retroactively beyond what the existing counts already show; a person earns a new badge the next time they are paid points and the count has passed the goal.
- Managers can add a badge from a screen (see section 5) through a new function `create_badge`.

## 2. Medal wall

The badge grid becomes a wall grouped by family. For each family:

- The highest tier earned shows as a full-colour medal with a ribbon.
- The next tier shows beside it as a dimmed medal with a progress ring (for example 61 of 100).
- One-off badges show as single medals, locked ones dimmed.

Earned medals keep their date and message (for example a manager's "Stayed late to help").

## 3. Level emblem and streak flame

- The level is shown as a hexagon emblem with the level number; its colour changes with the level band (1-2, 3-4, 5-6, 7-8).
- The progress bar to the next level is thicker.
- The streak shows as a flame with the day count; it gets bigger at 7 and 30 days.

## 4. Team page and profiles

- New page `/team`, open to everyone signed in, with a "Team" link in the menu. It shows every active colleague as a card: photo or initials, name, job title, level emblem, streak, number of badges. Sorted by name. Tapping a card opens that person's profile.
- A new function `team_overview()` returns, for every active person, `id, full_name, photo_path, job_title, team, level_number, level_name, streak, badge_count`. It requires an active profile (`app_role()` not null). It returns no points and no private fields.
- A colleague's profile shows: header (emblem, streak, level, total points, about line), the medal wall, and recent achievements. Achievements come from a new function `person_wins(p_person, p_limit)` (badges earned and thank-yous received by that person, no point reasons).
- Your own profile keeps your recent points list and the edit form.

## 5. Earned pop-up and adding badges

- The new-badge pop-up becomes a large card with the medal, the name, the points gained so far today and a short confetti burst. The confetti uses plain CSS animation and is switched off when the device asks for reduced motion.
- A new section on Settings, Rewards ("Add a badge") lets a person with `rewards.manage` create a badge: name, description, icon (from a fixed list), family, tier, and the rule: count of an existing rule, a streak length, or given by hand. It calls `create_badge(p_name, p_description, p_icon, p_family, p_tier, p_kind, p_rule_key, p_threshold)`, which makes a key from the name, checks the inputs, and refuses duplicates.

## 6. Safety and privacy

- All new functions are `security definer set search_path = public`, granted to `authenticated`, revoked from `public, anon`, and refuse anyone without an active profile.
- `create_badge` needs `rewards.manage`.
- The Team page and profiles never include phone numbers, hidden birthdays or point reasons.
- Migration 0063 only adds columns and functions and changes starter data, so the running app keeps working. The owner is told it changes the live database, a backup is taken, then `npm run db:migrate` and `npm run test:db`.

## 7. Testing

- Database tests (rolled back): every person sees the same badges whatever their team; a new tier is earned at its goal; `team_overview` returns active people only and no points or private fields; a login without an active profile gets nothing; `person_wins` shows badges and thank-yous and no point reasons; `create_badge` is refused for staff, validates its inputs and refuses a duplicate name.
- The sample-data backend mirrors every rule and has matching tests.
- Screen tests: the Team page exists and is linked in the menu with an access rule for everyone signed in; the medal wall groups by family; no raw z-index numbers; 14px hints; 44px targets; confetti respects reduced motion.

## Review focus

- A person on any team can earn and see every badge; none are hidden by an empty team.
- Tier numbers are unique inside a family, and the wall shows the highest earned tier even when a lower one was earned later.
- `team_overview` must not leak points, phone numbers or hidden birthdays.
- Adding a badge must not break existing earners or the starting set.
- Confetti and animations stay off with reduced motion, and never block a tap.

## Open items

- Medal colours and icons are proposals; the owner can adjust them after seeing the dev page.
- Point values and badge goals are starting values and are changed on the settings screen.
