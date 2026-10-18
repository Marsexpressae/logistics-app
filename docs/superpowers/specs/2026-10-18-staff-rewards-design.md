# Staff rewards: richer profiles, points, levels and badges

Status: design agreed in chat on 2026-10-18, waiting for written-spec review.

## Goal

Make staff enjoy using the app and use it more. Staff earn points and badges for real work and for exploring the app, see their progress on a richer profile, and managers can thank people. Everyone is treated equally: the same rules for all staff, no ranking.

## Decisions from the owner

- Points and badges come from both real work in the app (automatic) and manager recognition (by hand).
- Version 1 is recognition only. Spending points on rewards is a later phase; the design leaves room for it.
- Everyone is equal. There is no leaderboard and no ranking of points. A shared "wins" feed celebrates badges and thank-yous.
- Engagement is measured by real activity, not time. There are no timers and no online status. A streak counts days with at least one real action.
- Counting is hybrid: the database counts work actions from real records, and the app records exploring and daily use through one small safe call.
- HR features (leave, attendance, payroll, contracts, reviews) are a separate later module. The richer profile is its starting point.

## Scope

In version 1:

1. Richer staff profiles.
2. Point log, point rules, daily caps, streaks, levels.
3. Manager thank-yous with a monthly limit.
4. Badges (count, streak, manager-given), earned automatically or by hand.
5. Screens: My profile, colleague profile, wins feed, manager settings.
6. Permissions `rewards.give` and `rewards.manage`.

Not in version 1:

- Spending points, a rewards catalog and approvals.
- Badges that need "on time" data, until the app is confirmed to record due times for pickups and deliveries.
- Online status, active-time tracking, leaderboards.
- Any HR module feature.

## 1. Richer profiles

New columns on `profiles`: `photo_path`, `job_title`, `team` (sales, pickup, warehouse, office), `birthday_day` and `birthday_month` (no year), `hide_birthday`, `about`, `phone`, `joined_on` (starts as the date of `created_at`).

- A person edits their own photo, birthday, hide-birthday, about and phone.
- Managers (and users with the existing staff-management permission) edit team, job title and joined date.
- Phone is visible to managers only. Birthday shows as day and month unless hidden.
- Photos use the same private storage approach as the customer ID photos.
- The `/account` page becomes "My profile". Tapping a colleague's name opens a read-only profile.

## 2. Points, levels, streaks

Tables:

- `point_rules` (key, label, points, daily_cap, once_per_person, active, kind: work | explore | daily).
- `point_log` (id, person_id, rule_key, points, reason, source_table, source_id, given_by, created_at). Append only. A correction is a new line. Staff can read their own lines and, for the wins feed, nothing more. Only database functions write.
- `levels` (number, name, min_points), editable by managers.

A person's total is the sum of their log lines. A level is derived from lifetime points and never goes down.

Work actions (booking created, parcel scanned, payment recorded, pickup completed) are awarded by database triggers when the real record is saved. The reason line names the record. A rule's daily cap and a total daily cap stop grinding; points over the cap are not recorded.

Exploring and daily use go through one function, `record_feature_use(feature_key)`:

- It accepts only keys that exist in `point_rules` with kind explore or daily.
- An explore key pays once per person.
- "Active today" pays once per day and only if the person has at least one work-action line that day.

A streak is the number of consecutive days that have at least one work-action line. A missed day resets the streak and never removes points.

Thank-yous: `give_thank_you(person_id, points, message)` needs `rewards.give`, rejects the caller's own id, requires a message, and has a monthly limit per giver (points and count) kept in a setting.

Starting values are small (for example 1 for a scan, 5 for a booking) so levels take months. Managers adjust them on the settings screen.

## 3. Badges

Tables:

- `badges` (key, name, description, icon, team or null for everyone, kind: count | streak | manual, rule_key, threshold, active).
- `person_badges` (person_id, badge_key, earned_at, given_by, message). One row per person per badge. Never deleted by the app.

After a point line is written, a database function checks the person's count and streak badges and inserts any newly earned ones. A manual badge is awarded through `give_badge(person_id, badge_key, message)`, which needs `rewards.give`. A new badge shows a toast on the person's next screen load.

Progress for locked badges (for example 340 of 500) is computed from the same counts.

## 4. Screens

- My profile: photo, level bar, points, streak, badges (earned and locked with progress), recent points with reasons.
- Colleague profile: same layout, read-only, no private fields.
- Wins feed: recent badges and thank-yous for the whole team, on the dashboard. No ranking.
- Manager settings: point rules, levels, badges, "give thank-you" and "give badge".

All new screens follow the project rules: sortable list headings, 44px touch targets, named z-index layers, 14px hint text.

## 5. Permissions and safety

- New permissions `rewards.give` and `rewards.manage` for manager and super_admin.
- Row level security: staff read their own `point_log` and `person_badges`, and the wins feed reads through a function that returns only badge and thank-you events. No direct inserts or updates from the browser on any rewards table.
- All writes go through SECURITY DEFINER functions with `set search_path = public`.
- The change ships as one new numbered migration. The owner is told it changes the live database, a backup is taken, then `npm run db:migrate` and `npm run test:db`.
- The old app keeps working while the migration is live, because it only adds tables and columns.

## 6. Testing

- Unit tests with the sample-data mock (which mirrors the database rules): earning, caps, once-per-person, streaks, levels, badges, thank-you rules.
- Live-structure database tests in `db-tests/rules.test.mts`, always rolled back: a staff member cannot insert into `point_log`, cannot give themselves a thank-you, cannot exceed the daily or monthly cap, cannot call `record_feature_use` with an unknown key, and cannot read another person's private fields.

## Review focus

- Cheating: direct writes, repeated calls, unknown keys, self-thank-you.
- Idempotence: a trigger firing twice for one record must not pay twice.
- Departed staff: inactive people keep their history and do not appear in new feeds.
- Existing staff: all current profiles get default values and work without filling anything in.
- Privacy: phone and hidden birthdays never reach other staff through the API.

## Open items

- Confirm whether pickups and deliveries record a due time. If yes, add "on time" badges in a follow-up.
- Starting point values and level names are proposals; the owner can change them in the settings screen after release.
