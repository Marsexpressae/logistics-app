# Add, merge and split parcels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warehouse staff can add one parcel, merge parcels into one, or split one parcel into several, from the Warehouse page, with untouched parcels keeping their labels and every change in the history.

**Architecture:** One protected database function `edit_parcels` retires chosen in-warehouse parcels and creates new ones (next round, new barcodes) in one locked step, and writes one plain-language booking history line. The sample-data layer mirrors it. One shared screen component handles the three modes (add, merge, split). The 637-line Warehouse page is split into smaller files first, with no visible change.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase Postgres (RLS, `require_perm`), node:test with the sample-data mock (`npm test`) and real-database tests (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-16-parcel-edits-design.md`

## Global Constraints

- Permission is the existing `warehouse.manage` ("Receive and split parcels"); no new permission.
- Function: `edit_parcels(p_booking_id uuid, p_retire_ids uuid[], p_new jsonb, p_warehouse_id uuid default null, p_date date default null) returns int`; `security definer`, `set search_path = public`, `perform require_perm('warehouse.manage')`, execute revoked from `public, anon`, granted to `authenticated`.
- Only parcels with status `in_warehouse` of the same booking can be retired. Retired parcels become `repacked` with `container_id = null`. New parcels: `round` = booking's highest round + 1, `seq` continues, barcode `<code>-R<round>-P<n>` (n counts from 1 within the edit; `<code>-P<n>` when round is 1), status `in_warehouse`.
- Booking row locked `for update`. Booking becomes `at_warehouse` only if it was `collected`.
- New booking history kind: `parcels_edited` (extend the `booking_events_kind_check` constraint to the existing list plus it). Existing list: `'rescheduled','cancelled','loaded_without_payment','departed_with_missing','returned','return_deleted','moved'`.
- History text (exact; short label = the barcode after `<code>-`, for example `P1` or `R2-P1`; a list of labels is joined with commas and ` and ` before the last): Merge `Merged parcels P1 and P2 into new parcel R2-P1`; Split `Split parcel P2 into new parcels R2-P1 and R2-P2`; Add `Added parcel R2-P1`.
- Messages (exact): `Booking not found`; `Booking % has not been collected yet`; `Add one parcel at a time` (no retired ids and not exactly one new); `Splitting needs two or more new parcels` (one retired id and fewer than two new); `Merging makes exactly one new parcel` (two or more retired ids and not exactly one new); `Choose where the new parcel goes` (Add without a warehouse); `The same parcel was chosen twice`; `Only parcels of this booking that are in the warehouse can be changed`; `A parcel weight cannot be negative`; `% is not active` (warehouse name); `Received cannot be before the collection date (%)`; the future-date refusal is whatever `event_time(p_date)` already raises.
- Warehouse for new parcels: the first retired parcel's warehouse, or `p_warehouse_id` for Add.
- Untouched parcels keep label, status, round and position. `split_booking` is not changed.
- A merge or split may change the total weight; the screen shows the difference, the database allows it.
- Sample-data storage key `logistics-mock-db-v35` becomes `logistics-mock-db-v36`.
- Git: commit as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author line; no push or deploy without the owner's explicit word; a migration changes the LIVE database, so tell the owner, take `npm run db:backup`, wait for "apply".

## Review Focus

1. Merge with a parcel that is loaded, in transit, delivered, or on an open return form: refused, nothing changes (Task 2).
2. Two edits in a row on one booking: rounds 2 and 3, all barcodes unique, untouched round-1 parcels still carry their original labels (Task 1).
3. Duplicate ids in the retire list, ids of another booking, an empty retire list for Merge or Split, and a wrong count of new parcels: each refused with its own message (Task 2).
4. A person without `warehouse.manage` and a signed-out visitor: refused (Task 2).
5. The customer history must label the new event "Parcels changed", never "Cancelled" (Task 3).

## File Structure

- Create `supabase/migrations/0058_edit_parcels.sql`.
- Modify `db-tests/rules.test.mts`, `src/lib/mock-supabase.ts`, `src/lib/types.ts` (only if a type is needed).
- Create `tests/parcel-edits.test.mts`.
- Create under `src/components/warehouse/`: `types.ts`, `StockList.tsx`, `IntakeList.tsx`, `ReturnsList.tsx` (the page split), `ParcelEditPanel.tsx` (the three modes).
- Modify `src/app/warehouse-inventory/page.tsx` (becomes the shell: tabs, search, selection bar, data loading).

## Stage 1: Database (`0058_edit_parcels.sql`)

### Task 1: `edit_parcels`, the three uses

**Files:** Create `supabase/migrations/0058_edit_parcels.sql`. Test: append to `db-tests/rules.test.mts`.

**Interfaces — Produces:** `edit_parcels` as in Global Constraints; the booking event kind `parcels_edited`.

- [ ] **Step 1: Write the failing tests** (each begins by reading the migration inside the transaction until applied live: `await db.owner(readFileSync("supabase/migrations/0058_edit_parcels.sql", "utf8"))`). Use a person with `["warehouse.view", "warehouse.manage"]`, a booking made with `db.booking(...)` set to `collected`, received into a warehouse with `split_booking` with three parcels. Tests: `edit_parcels: merge retires the chosen parcels and makes one new parcel` (retire P1 and P2: they are `repacked`; one new `in_warehouse` parcel with barcode `<code>-R2-P1`, round 2, `seq` 4, the weight and description given, the first retired parcel's warehouse; P3 unchanged, same barcode, still round 1; the booking has one `parcels_edited` event whose reason is `Merged parcels P1 and P2 into new parcel R2-P1`, with the actor's name). `edit_parcels: split retires one parcel and makes several` (retire P2, two new: `R2-P1`, `R2-P2`; reason `Split parcel P2 into new parcels R2-P1 and R2-P2`; with three new parcels the reason ends `R2-P1, R2-P2 and R2-P3`). `edit_parcels: add makes one parcel and keeps the rest` (empty retire list, `p_warehouse_id` given: reason `Added parcel R2-P1`, no parcel retired). `edit_parcels: two edits in a row use rounds 2 and 3 with unique barcodes` (merge, then split the merged parcel: barcodes `R2-P1`, then `R3-P1`, `R3-P2`; the booking's barcodes are all unique; P3 still `<code>-P3`). Assert the return value (number of new parcels).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (`ENOENT` on the migration file).
- [ ] **Step 3: Implement the migration** (re-runnable): `alter table booking_events drop constraint if exists booking_events_kind_check; alter table booking_events add constraint booking_events_kind_check check (kind in (...Global Constraints list..., 'parcels_edited'));` then `create or replace function edit_parcels(...)` following `split_booking` in `0050_past_dates.sql` for style (`event_time`, `next_round`, `last_seq`, barcode scheme, `for update` lock) and `move_parcels` in `0033_move_parcels.sql` for the `booking_events` insert (columns `booking_id, kind, reason, actor_id, actor_name`). Build the short labels with `substr(barcode, length(b.code) + 2)`. Revoke and grant as in Global Constraints. Validation comes in Task 2; here do only what the happy paths need, but include the booking lock and the retire/create steps.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git add supabase/migrations/0058_edit_parcels.sql db-tests/rules.test.mts && git commit -m "Parcel edits: edit_parcels (add, merge, split)"`.

### Task 2: Rules and refusals

**Files:** Modify `0058_edit_parcels.sql`. Test: `db-tests/rules.test.mts`.

- [ ] **Step 1: Write failing tests**, each asserting the exact message from Global Constraints and that nothing changed afterwards (parcel statuses, parcel count, event count): booking not found; booking `booked` (not collected); Add with two new parcels; Add without a warehouse; Split with one new parcel; Merge with two new parcels; retire list with one id twice; an id from another booking; a parcel that is `loaded` (set with `update parcels set status = 'loaded'`), one `ready_for_return` (use `prepare_return`), one already `repacked`; a negative weight; an inactive warehouse (`update warehouses set active = false`); a date before the collection day; a future date; a person with only `warehouse.view` (`/permission/i`); `db.anonymous` (`/permission denied/i`). Accepts: weight 0 and an empty description; `p_date` equal to the collection day.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** the validation in the function in this order: permission; load and lock the booking; status; shape (counts); duplicates; the retired parcels all belong to the booking and are `in_warehouse` (count compare, as `move_parcels` does); weights; warehouse (first retired parcel's, or `p_warehouse_id`, must exist and be active); date as in `split_booking`. All checks before any write.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Parcel edits: rules and refusals"`.

### Task 3: Customer history label, then apply live

**Files:** Modify `0058_edit_parcels.sql`. Test: `db-tests/rules.test.mts`.

- [ ] **Step 1: Failing test** `customer timeline labels parcel edits` (read the migration inside the transaction): after a merge on a booking linked to a customer (`db.booking` links one automatically), `customer_timeline(customer, 100, 0)` has a row with `r_kind = 'event'`, `r_title = 'Parcels changed'` and `r_detail` equal to the history line, and no row titled `Cancelled` for it. Also assert the credit note and refund rows from migration 0056 still appear (issue a credit note with the helpers used by the existing `customer timeline lists credit notes and refunds` test).
- [ ] **Step 2: Run.** Expected: FAIL (title is `Cancelled`).
- [ ] **Step 3: Implement.** Append to the migration the whole `customer_timeline` function copied from `0056_money_in_timeline.sql`, with one added branch in its event `case`: `when 'parcels_edited' then 'Parcels changed'` (before `else`). Build it with a small script that extracts the function from 0056 (as 0056 itself was built from 0039) and asserts the replacement happened once. Keep the signature and grants (the grants live on the function name, `create or replace` keeps them).
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS (all tests).
- [ ] **Step 5: Commit.** Then tell the owner this is a LIVE database change (additive; one new function, one widened constraint, one replaced function), wait for "apply", run `npm run db:backup`, `npm run db:migrate` (expected: `Applying 0058_edit_parcels.sql ...`), delete the `readFileSync(".../0058...")` lines from the tests, run `npm run test:db` (expected: all pass), commit. Nothing screen-visible changes yet, so nothing needs pushing.

## Stage 2: Sample-data layer and page split

### Task 4: Sample-data mirror

**Files:** Modify `src/lib/mock-supabase.ts` (storage key to v36). Create `tests/parcel-edits.test.mts`.

**Interfaces — Consumes:** the rules and messages in Global Constraints. **Produces:** `edit_parcels` RPC in the mock with the same arguments (`p_booking_id`, `p_retire_ids`, `p_new`, `p_warehouse_id`, `p_date`) and the same return value and history events (`kind: "parcels_edited"`).

- [ ] **Step 1: Failing tests** `tests/parcel-edits.test.mts` through `createMockClient()` (seed BK-1003 has two `in_warehouse` parcels; use `split_booking` for more): the happy paths of Task 1 (labels, rounds, history text, untouched parcels), every refusal of Task 2 with the exact message, the unchanged state after a refusal, the customer timeline label (`customer_timeline` for the booking's customer contains `Parcels changed`: mirror it in the mock's event title mapping), two edits in a row.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `edit_parcels` in the mock next to `split_booking`, reusing `setParcelStatus`, `eventTime`, `backdate`, `uid`, `now`, and the booking event shape used by `move_parcels` in the mock. Add the `parcels_edited` title to the timeline mapping.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npx eslint src tests db-tests`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -am "Parcel edits: sample-data layer"`.

### Task 5: Split the Warehouse page (no visible change)

**Files:** Create `src/components/warehouse/types.ts`, `StockList.tsx`, `IntakeList.tsx`, `ReturnsList.tsx`. Modify `src/app/warehouse-inventory/page.tsx`.

- [ ] **Step 1: Capture the "before".** Start the sample-data server (`NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001`), and with `get_page_text` save the page text of each tab (intake, unpacked, packed, returns) at desktop width and at phone width (375) to files in the scratchpad.
- [ ] **Step 2: Failing check:** a source test in `tests/parcel-edits.test.mts`: `src/app/warehouse-inventory/page.tsx` has fewer than 300 lines, and the four component files exist.
- [ ] **Step 3: Refactor, behavior-preserving.** Move the types (`Tab`, `StockParcel`) and constants (`TABS`) to `types.ts`; move the rendering of the stock list (today `renderParcels` with its phone cards and wide table), the intake list and the returns list into the three components, passing state and handlers as props (`picked`, `toggle`, `toggleGroup`, `open`, `toggleOpen`, `canOperate`, and so on). The page keeps data loading, search, the tab bar, and the selection bar. Do not change any text, class, or behavior.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx eslint src`, `npm test`. Expected: pass. Capture the "after" page text the same way and diff it with the "before" files. Expected: identical.
- [ ] **Step 5: Commit** `git commit -am "Warehouse page split into smaller files (no visible change)"`.

## Stage 3: The screens

### Task 6: The edit panel and its buttons

**Files:** Create `src/components/warehouse/ParcelEditPanel.tsx`. Modify `src/app/warehouse-inventory/page.tsx`, `StockList.tsx`.

**Interfaces — Consumes:** `edit_parcels`. **Produces:** `ParcelEditPanel({ mode, booking, parcels, warehouses, onDone }: { mode: "add" | "merge" | "split"; booking: { id: string; code: string }; parcels: StockParcel[]; warehouses: { id: string; name: string; active?: boolean }[]; onDone: (created: StockParcel[] | null) => void })`. For `add`, `parcels` is empty; for `merge`, two or more; for `split`, exactly one. Visible only with `can("warehouse.manage")`.

- [ ] **Step 1: Failing tests** in `tests/parcel-edits.test.mts`: the whole flow as the screens call it (merge, split, add through `createMockClient()`, then read the parcels the way the page does: `in_warehouse` stock lists the new parcels and not the retired ones); source checks that `page.tsx` shows Merge only when 2 or more parcels of one booking are ticked and all are `in_warehouse`, Split only when exactly one is ticked, and that the whole block sits behind `canOperate`; that `ParcelEditPanel.tsx` calls `edit_parcels` and `confirmAction`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** The selection bar gets **Merge** and **Split** buttons (icons `Merge` and `Split` from lucide-react, or `Combine` and `Scissors` if absent; large touch targets like the existing buttons); each booking row in `StockList` gets **Add parcel**. The panel opens inline (a `Card`, like `CreditNotePanel`): merge shows one description box and a weight box pre-filled with the sum; split shows rows of description and weight with a running total and the note `Original X kg, new total Y kg`; add shows description, weight, warehouse select (active ones). `confirmAction` names what is retired and created before saving. Errors with `ErrorMessage`. `onDone` clears the selection and reloads the stock.
- [ ] **Step 4:** `npx tsc --noEmit`, lint, `npm test`. Walk all three on the sample-data server (merge two parcels of BK-1003, split one, add one) and confirm the Unpacked and Packed tabs and the history line in the booking page's history.
- [ ] **Step 5: Commit** `git commit -am "Parcel edits: add, merge and split on the Warehouse page"`.

### Task 7: Labels after saving, final checks

**Files:** Modify `ParcelEditPanel.tsx`.

- [ ] **Step 1: Failing test:** source check that after saving the panel shows the new parcels with `ParcelLabel` and a Print labels button (`window.print()`), as `src/app/warehouse-inventory/split/[bookingId]/page.tsx` does, and that the labels are hidden from print except the labels area (reuse the same print classes).
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the result view: after a successful save, `edit_parcels` returns a count, so read the new parcels (`parcels` of the booking with the highest round and `status = 'in_warehouse'`, with `warehouse:warehouses(code)`), show their labels with a Print labels button, and a Done button that calls `onDone`.
- [ ] **Step 4:** Whole suite: `npx tsc --noEmit`, `npx eslint src tests db-tests`, `npm test`, `npm run test:db`. Final browser pass on sample data: the Warehouse page tabs, all three forms, the label print preview, the booking history line, and the customer history entry.
- [ ] **Step 5: Commit.** Report to the owner what is ready; wait for "push to preview", then "merge".

## Self-review notes

- Spec coverage: section 4 (Tasks 1 and 2), 5 (Tasks 1 and 3), 6 (Tasks 6 and 7), 7 (Tasks 3 to 7), 8 (stages), 9 (tests in every task), 10 (global constraints).
- Names are consistent: `edit_parcels`, `parcels_edited`, `ParcelEditPanel`, `mode` values `add | merge | split`.
