# Packing list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "Package items" card becomes a "Packing list" with serial numbers, a stored order, and move up / move down buttons; the printed pickup receipt follows the same order with a "#" column.

**Architecture:** A new `booking_items.position` column holds the order. A protected database function `move_booking_item` swaps an item with its neighbour, running with the caller's own rights so the existing item permissions decide who may use it. Serial numbers are the row's place in the list, worked out when shown. The sample-data layer mirrors the column and function.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase Postgres (RLS), node:test with the sample-data mock (`npm test`) and real-database tests (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-17-packing-list-design.md`

## Global Constraints

- Migration file: `supabase/migrations/0060_packing_list.sql`. Additive and re-runnable (`add column if not exists`, `create or replace`, `drop trigger if exists`).
- `booking_items.position int not null`; backfill per booking in `id` order as 1, 2, 3 ...; index on `(booking_id, position)`; a `before insert` trigger sets a missing position to the booking's highest position plus one.
- `move_booking_item(p_item_id uuid, p_direction text) returns void`, `language plpgsql`, security **invoker** (no `security definer`), `set search_path = public`; `execute` revoked from `public, anon`, granted to `authenticated`.
- Messages (exact): `Item not found`; `Direction must be up or down`; `It is already first`; `It is already last`; `You cannot change this packing list`.
- Who may move: whoever the existing policy `items_write` lets update the item (`items.edit` while the booking is `booked`; `items.edit_after` any time). No new permission.
- The serial number is never stored: it is the row's index in the list sorted by `position`, then `id`, plus 1.
- Order everywhere items are read: `.order("position").order("id")` in `src/app/bookings/[id]/page.tsx`, `src/app/pickups/[id]/page.tsx`, `src/app/pickups/[id]/receipt/page.tsx`, `src/app/warehouse-inventory/split/[bookingId]/page.tsx`.
- Card title text: `Packing list`. Buttons: accessible labels `Move <description> up` and `Move <description> down`, at least 44px on touch (`p-3` icon buttons like the existing ones), first row without Up, last row without Down.
- Receipt: a first column `#`; the warehouse split page gets the order but no number column.
- Sample-data storage key `logistics-mock-db-v36` becomes `logistics-mock-db-v37`.
- Git: commit as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author line; no push or deploy without the owner's explicit word; a migration changes the LIVE database, so tell the owner, take `npm run db:backup`, wait for "apply".

## Review Focus

1. Existing items keep the order people see today after the backfill, and a new item lands last (Task 1).
2. Move up on the first item and move down on the last item are refused with the exact messages and change nothing (Task 2).
3. A person without the item permissions cannot move; `items.edit` works on a booked booking but not a collected one; `items.edit_after` works after collection (Task 2).
4. Moving never touches another booking's items, and two moves in a row give the expected order (Task 2).
5. The receipt "#" column and the order agree with the card, and a removed item renumbers the list without a gap (Task 5).

## File Structure

- Create `supabase/migrations/0060_packing_list.sql`.
- Modify `db-tests/rules.test.mts`, `src/lib/mock-supabase.ts`, `src/lib/types.ts` (add `position?: number` to `BookingItem`), `src/components/bookings/ItemsCard.tsx`, the four pages listed in Global Constraints, `src/app/pickups/[id]/receipt/page.tsx`.
- Create `tests/packing-list.test.mts`.

## Stage 1: Database (`0060_packing_list.sql`)

### Task 1: The position column

**Files:** Create `supabase/migrations/0060_packing_list.sql`. Test: append to `db-tests/rules.test.mts`.

- [ ] **Step 1: Write the failing test** `packing list: existing items keep today's order and new items go last`. Inside the transaction: `alter table booking_items drop column if exists position` (so the test also works after the migration is live), insert three items for a booking with the owner (explicit ids chosen so their `id` order is known, for example `'00000000-0000-4000-8000-000000000003'` first in the statement but largest id), then run the migration file with `readFileSync`, then assert positions 1, 2, 3 follow `id` order; then insert a fourth item without a position and assert it gets 4; an item for a second booking starts at 1; deleting item 2 leaves positions 1, 3, 4 (a gap is fine).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (`ENOENT` on the migration file).
- [ ] **Step 3: Implement the migration**: `alter table booking_items add column if not exists position int;` backfill with `update booking_items i set position = r.n from (select id, row_number() over (partition by booking_id order by id) n from booking_items) r where r.id = i.id and i.position is null;` then `alter column position set not null`; `create index if not exists booking_items_booking_position_idx on booking_items (booking_id, position)`; the trigger function `booking_items_set_position()` (`before insert`, sets `new.position := coalesce((select max(position) from booking_items where booking_id = new.booking_id), 0) + 1` when `new.position is null`) and `drop trigger if exists` / `create trigger`. The column must be nullable for the insert trigger to run: use `default null` first, make it `not null` after the backfill, and the trigger fills it before the constraint is checked.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git add supabase/migrations/0060_packing_list.sql db-tests/rules.test.mts && git commit -m "Packing list: item position column"`.

### Task 2: `move_booking_item`

**Files:** Modify `0060_packing_list.sql`. Test: `db-tests/rules.test.mts`.

**Interfaces — Produces:** `move_booking_item(p_item_id uuid, p_direction text)` as in Global Constraints.

- [ ] **Step 1: Write failing tests** (each reads the migration first): `move_booking_item: up and down swap with the neighbour` (three items; move item 2 up gives order 2,1,3; move item 1 down gives 2,3,1; assert with a query ordered by `position`, `id`); `move_booking_item: the edges are refused and change nothing` (first up gives `It is already first`, last down gives `It is already last`, a bad direction gives `Direction must be up or down`, an unknown id gives `Item not found`; order unchanged after each); `move_booking_item: only people who may edit the items can move them` (person with only `bookings.view` gets `You cannot change this packing list` and nothing changes; person with `items.edit` can move on a booking whose status is `booked` but is refused once the booking is `collected`; person with `items.edit_after` can move on a collected booking; `db.anonymous` gets `permission denied`); `move_booking_item: other bookings are untouched and repeated moves give the expected order` (a second booking's positions are the same before and after; moving the same item up twice from the bottom of five items places it third).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (function does not exist).
- [ ] **Step 3: Implement** the function: look the item up (`Item not found`), validate the direction, lock the booking `for update`, find the neighbour (`select id, position ... where booking_id = ... and (position, id) < or > (this.position, this.id) order by position desc/asc, id desc/asc limit 1`), raise `It is already first` / `It is already last` when none, then swap the two positions in one `update ... set position = case id when ... end where id in (...)`. If the update changed fewer than 2 rows, raise `You cannot change this packing list` (row security hid the rows or refused the write) and let the transaction roll back. Grants as in Global Constraints.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Packing list: move_booking_item"`.

### Task 3: Apply live

- [ ] **Step 1:** Tell the owner this is a LIVE database change (additive: one column, one trigger, one function), and wait for "apply".
- [ ] **Step 2:** `npm run db:backup`, then `npm run db:migrate`. Expected: `Applying 0060_packing_list.sql ...`.
- [ ] **Step 3:** In the tests keep the `readFileSync(".../0060...")` line only in the backfill test of Task 1 (it re-applies the migration after dropping the column); delete it from the Task 2 tests. Run `npm run test:db`. Expected: all pass. Commit.

## Stage 2: Sample-data layer

### Task 4: Mirror

**Files:** Modify `src/lib/mock-supabase.ts` (storage key to v37), `src/lib/types.ts`. Create `tests/packing-list.test.mts`.

**Interfaces — Consumes:** the rules and messages in Global Constraints. **Produces:** items carry `position`; a new item gets the next position; an RPC `move_booking_item({ p_item_id, p_direction })` with the same messages; a sort helper is not needed.

- [ ] **Step 1: Failing tests** `tests/packing-list.test.mts` through `createMockClient()` (seed BK-1002 has two items): seed items have positions 1 and 2; a new item goes last; move up and down swap with the neighbour; the edges and bad direction give the exact messages and change nothing; an unknown id gives `Item not found`; other bookings untouched; deleting an item leaves the others in order; the read the pages use (`.select("*").eq("booking_id", id).order("position").order("id")`) returns the new order.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** in the mock: add `position` to the seed items; in the insert path for `booking_items` set `position = max + 1` for the booking when missing; add the `move_booking_item` RPC next to `edit_parcels`; add `position?: number` to `BookingItem` in `types.ts`. Check that `order("position")` works in the mock's query builder (it already supports `.order` on other columns).
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npx eslint src tests db-tests`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -am "Packing list: sample-data layer"`.

## Stage 3: Screens

### Task 5: Packing list card, ordering, receipt

**Files:** Modify `src/components/bookings/ItemsCard.tsx`, `src/app/bookings/[id]/page.tsx`, `src/app/pickups/[id]/page.tsx`, `src/app/pickups/[id]/receipt/page.tsx`, `src/app/warehouse-inventory/split/[bookingId]/page.tsx`.

- [ ] **Step 1: Failing source tests** in `tests/packing-list.test.mts`: `ItemsCard.tsx` has the title `Packing list` and not `Package items`, calls `move_booking_item` with `'up'` and `'down'`, labels `Move ${...} up` and `down`, and shows the serial number; each of the four pages orders by `position` then `id`; the receipt has a `#` header cell and the serial number cell, in the same order.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ItemsCard`: rename the card; show `index + 1` before each description (a fixed-width number column that stays aligned); add the two icon buttons (`ArrowUp`, `ArrowDown` from lucide-react) before edit and delete, hide Up on the first row and Down on the last, disable them while a move is saving, call `supabase.rpc("move_booking_item", { p_item_id, p_direction })` through the existing `run` helper so errors show with `ErrorMessage` and the list reloads through `onChanged`. Receipt: add `<th>#</th>` first and a cell with `index + 1`; widen the totals row `colSpan` by one. Add `.order("position")` before `.order("id")` in all four reads.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx eslint src tests`, `npm test`, `npm run test:db`. Then in the dev server (sample data): the booking page and the pickup page show the Packing list with numbers and arrows; moving works in both directions; the first row has no Up, the last no Down; the receipt shows `#` and the same order; remove an item and the numbers close up.
- [ ] **Step 5: Commit** `git commit -am "Packing list: card, order everywhere, receipt number column"`. Report to the owner what is ready and wait for "push to preview", then "merge".

## Self-review notes

- Spec coverage: section 4 (Task 1), 5 (Task 2), 6 (Task 5), 7 (Task 4), 8 (tests in every task), 9 (stages and Task 3).
- Names are consistent: `position`, `move_booking_item`, `Packing list`.
