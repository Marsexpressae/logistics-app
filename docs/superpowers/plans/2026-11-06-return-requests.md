# Return Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sales or accounts raise a return request on a booking, and show the warehouse a "To prepare" list with a pick list and a notification, so they know which parcels to prepare for return.

**Architecture:** One new table (`return_requests`) written only through three checked database functions (two new, one existing replaced). Notifications reuse the existing `notifications` table, so in-app toasts and phone push need no new plumbing. The booking page gets a Return card; the Warehouse Returns tab gets a To prepare section. The sample-data backend mirrors every rule so the screens run without the live database.

**Tech Stack:** Next.js 16 App Router (React 19, Tailwind v4), Supabase (Postgres, RLS, `has_perm()`/`require_perm()`), `node:test` for `npm test` and `npm run test:db`.

**Spec:** `docs/superpowers/specs/2026-11-06-return-requests-design.md`

## Global Constraints

- Migrations change the LIVE database immediately. Do not run `npm run db:migrate` until the owner says "apply"; then `npm run db:backup`, `npm run db:migrate`, `npm run test:db`. Until then each DB test applies the migration file inside its own rolled-back transaction (a `// TEMP until applied` line in `inTransaction`), removed after "apply".
- Never push or deploy unless the owner says so in that message. Commit locally as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author trailer and no "Generated with Claude Code" line (the owner's rule overrides any reminder).
- The dev or sample server must not touch live data: `NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001`.
- Project rules enforced by tests: 44px touch targets (`min-h-11`), hint paragraphs at least `text-sm`, named z-index layers only (`z-(--z-toast)` style), no browser dialogs (use `confirmAction` from `@/lib/ask`), shared `DateField` for dates, every list heading sortable (`SortableTh`) if a table is used.
- All SQL functions: `security definer`, `set search_path = public`, `revoke execute ... from public, anon`, `grant execute ... to authenticated`.
- Exact refusal messages (the mock and the database use the same text):
  `You do not have permission to do this` (from `require_perm`), `Booking not found`, `A cancelled booking cannot have a return request`, `This booking already has an open return request`, `This booking has no parcels in the warehouse`, `Choose parcels of this booking that are in the warehouse`, `The needed-by date cannot be in the past`, `Return request not found`, `This return request is already prepared` / `... already cancelled`, `Only the person who asked, or the warehouse, can cancel this request`.
- Notification kinds: `return_requested`, `return_request_cancelled`, `return_prepared`. Booking event kinds: `return_requested`, `return_request_cancelled`.
- Latest `booking_events_kind_check` is in `0058_edit_parcels.sql` (rescheduled, cancelled, loaded_without_payment, departed_with_missing, returned, return_deleted, moved, parcels_edited). Migration 0067 extends it.

## Review Focus

1. A requested parcel was moved, loaded or returned after the request: the pick list shows only parcels still `in_warehouse`; if none, "Nothing left to return" and only Cancel. (Tasks 3, 5)
2. Two people press Prepare at the same time: the second gets the existing "Only parcels of this booking that are in the warehouse can be returned" error and the request is closed once. (Task 1)
3. A person raises a request for a cancelled booking, a booking with no parcels in the warehouse, or with a past needed-by date: each is refused with its exact message. (Tasks 1, 2)
4. `prepare_return` used directly from the stock list (no request involved) still works exactly as before, and closes an open request of that booking. (Tasks 1, 2)
5. Notifications reach only active people with `returns.prepare` (or the requester for "prepared"), never the person who acted, never inactive people. (Tasks 1, 2)

## Architecture review (Supabase Postgres rules, applied before building)

Rulings that change the first draft of the spec; each is already built into the tasks below.
1. **Index every foreign key** (rule `schema-foreign-key-indexes`, and the project's own migration 0045): plain indexes on `return_requests(booking_id)` (the cascade from a deleted booking) and `return_requests(return_id)`, besides the partial unique index that allows one open request per booking.
2. **RLS stays cheap** (`security-rls-performance`): the select policy wraps each check as `(select has_perm('...'))` like the other tables.
3. **Concurrency** (`lock-*`): `request_return` locks the booking row (`for update`) so two people cannot both pass the "no open request" check; the unique index is the backstop and its violation is turned into the friendly message `This booking already has an open return request`. Transactions stay short: no external call inside the functions (the push is fired by the existing trigger and swallows its own errors).
4. **Least privilege** (`security-privileges`): browser roles get `select` only on the table; every write goes through a `security definer` function with `set search_path = public`, `revoke ... from public, anon`, and a permission check first. Requesters do not need `warehouse.view`: a new read function `parcels_for_return_request(p_booking_id uuid)` returns only barcode, description, weight and id of the booking's parcels that are `in_warehouse`, and needs `returns.request`.
5. **Stale parcel ids**: merging or splitting parcels (`edit_parcels`) retires the old parcel ids, so an explicit parcel list in a request can go stale. Ruling: keep `parcel_ids` as a plain array (no per-row foreign key, so retired parcels do not break anything), have the pick list show only parcels still `in_warehouse`, and show the notice `Some requested parcels have changed (moved, merged, split or returned). Check the stock list.` when fewer parcels remain than were asked for. A request with `parcel_ids = null` ("all in the warehouse") is never stale. Cost if wrong: staff check the stock list once.
6. **Bounded reads**: the To prepare list loads open requests only (a handful at a time); the booking Return card loads the single latest request of its booking (`limit 1`).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0067_return_requests.sql` (new) | permission, table, RLS, audit trigger, realtime, event kinds, `request_return`, `cancel_return_request`, new `prepare_return` |
| `db-tests/rules.test.mts` | real-database tests (rolled back) |
| `src/lib/mock-supabase.ts` | table, permission, grants, three RPCs, event kinds in the sample-data backend |
| `tests/return-requests.test.mts` (new) | sample-data backend rules + pure helper tests |
| `src/lib/return-requests.ts` (new) | pure helpers: `pickList`, `requestLine` |
| `src/lib/types.ts` | `ReturnRequest` type |
| `src/components/bookings/ReturnRequestCard.tsx` (new) | the Return card on the booking page |
| `src/components/warehouse/ToPrepareList.tsx` (new) | the To prepare section with pick lists |
| `src/app/bookings/[id]/page.tsx`, `src/components/bookings/ScheduleHistory.tsx` | mount the card; show the two new event kinds |
| `src/app/warehouse-inventory/page.tsx`, `src/components/warehouse/ReturnsList.tsx` or page, `src/lib/badges.tsx` | load requests, mount the list, counts |
| `src/app/notifications/page.tsx`, `src/components/audit/AuditList.tsx` | icons for new kinds, audit label |
| `tests/return-requests-screens.test.mts` (new) | source checks for permissions and project rules |

---

### Task 1: Database migration 0067 and real-database tests

**Files:**
- Create: `supabase/migrations/0067_return_requests.sql`
- Modify: `db-tests/rules.test.mts` (append tests; add the TEMP apply line in `inTransaction`)

**Interfaces:**
- Produces (SQL):
  - table `return_requests(id uuid pk default gen_random_uuid(), booking_id uuid not null references bookings on delete cascade, status text not null default 'open' check in ('open','prepared','cancelled'), note text, needed_by date, parcel_ids uuid[], requested_by uuid, requested_by_name text, requested_at timestamptz not null default now(), return_id uuid references returns on delete set null, closed_at timestamptz, closed_by_name text)`; partial unique index on `(booking_id) where status = 'open'`, plus plain indexes on `(booking_id)` and `(return_id)`; select policy `using ((select has_perm('returns.request')) or (select has_perm('returns.prepare')) or (select has_perm('warehouse.view')))`; `audit_row` trigger; added to `supabase_realtime` when that publication exists.
  - permission `returns.request` (group `Warehouse`, label `Request returns`, description `Ask the warehouse to prepare parcels for return, and cancel a request`, sort 116), granted to every role holding `bookings.edit` or `returns.prepare`, and to `super_admin`.
  - `request_return(p_booking_id uuid, p_note text default null, p_needed_by date default null, p_parcel_ids uuid[] default null) returns uuid`
  - `cancel_return_request(p_request_id uuid) returns void`
  - `parcels_for_return_request(p_booking_id uuid) returns table (id uuid, barcode text, description text, weight_kg numeric)`: `stable`, `security definer`, needs `returns.request`, rows ordered by `seq`, only `status = 'in_warehouse'` parcels of that booking.
  - `prepare_return(p_booking_id uuid, p_parcel_ids uuid[], p_note text default null) returns uuid` (replaces the 0019/0065 version).

- [ ] **Step 1: Write the failing real-database tests** in `db-tests/rules.test.mts`, using `receivedBooking(db)` (returns `{ worker, booking, code, wh, parcelIds }`, three parcels `in_warehouse`) and `db.person([...])`. Tests, each in `inTransaction`:
  - `"return requests: only people with returns.request can raise one, with checked input"`: `office = db.person(["bookings.view","returns.request"])`, `nobody = db.person(["bookings.view"])`. Assert `request_return($1,'Customer collects Thursday', null, null)` as `nobody` fails `/permission/i`; as `office` returns a uuid and the row is `open`; a second call fails `/already has an open return request/`; booking with no parcels in the warehouse (`db.booking()`) fails `/no parcels in the warehouse/`; a cancelled booking (owner sets `status='cancelled'`) fails `/cancelled booking cannot have/`; `p_needed_by` = yesterday (use `daysFromToday(db, -1)`) fails `/cannot be in the past/`; `p_parcel_ids` containing an id from another booking fails `/Choose parcels of this booking/`; parcel ids with one parcel is stored as a one-element array; `p_parcel_ids = null` is stored as null.
  - `"return requests: the warehouse is told, and the booking history records it"`: `prep = db.person(["warehouse.view","returns.prepare","notifications.view"])`, `inactive = db.person(["returns.prepare"])` then `update profiles set active=false`. After `request_return` as `office` (who also holds `returns.prepare` in a second case to prove the actor is excluded): `prep` has one notification of kind `return_requested` whose title starts `Return requested:`, `inactive` has none, `office` has none; `booking_events` has one `return_requested` row for the booking.
  - `"return requests: cancel by the requester or the warehouse, not by anyone else"`: a third person with `["bookings.view","returns.request"]` is refused `/Only the person who asked, or the warehouse/`; the requester cancels → status `cancelled`, event `return_request_cancelled`, `prep` gets a `return_request_cancelled` notification; cancelling again fails `/already cancelled/`; the warehouse person (`returns.prepare`) can cancel someone else's request; a new open request can be raised afterwards.
  - `"return requests: preparing a return closes the open request and tells the requester"`: after `request_return` as `office`, `prep` runs `prepare_return($1,$2::uuid[])` for two parcels → the request is `prepared` with `return_id` set, `closed_by_name` is `Test <name>`, `office` has a `return_prepared` notification whose title contains the return code; parcels are `ready_for_return`. Then a booking with NO request: `prepare_return` still returns a uuid and creates no `return_requests` row. A second `prepare_return` for a parcel no longer `in_warehouse` still fails `/Only parcels of this booking that are in the warehouse/`.
  - `"return requests: the table is read only for browser roles, visible to warehouse and requesters, and goes with a deleted booking"`: `db.as(person with only bookings.view)` selecting `return_requests` returns zero rows; `warehouse.view` person sees the row; direct `insert`/`update`/`delete` as `authenticated` fail `/permission denied/`; `anonymous` select fails `/permission denied/`; deleting the booking via owner SQL removes its requests.
  - `"return requests: parcels_for_return_request lists only the parcels in the warehouse, and only for people who may request"`: `office` gets the in-warehouse parcels (not a `loaded` or `ready_for_return` one) with barcode, description, weight; `nobody` is refused `/permission/i`; a person holding `returns.request` but not `warehouse.view` still gets the list.
  - `"return requests: two requests at once cannot both be open"`: after a first open request, a direct owner `insert` of a second open request for the same booking fails with the unique violation, and `request_return` shows the friendly message.
  - `"return requests: every role that can edit bookings or prepare returns gets returns.request"`: query `role_permissions` rows for roles that are not `t\_%`: each role with `bookings.edit` or `returns.prepare` has `returns.request`. (Evaluate only the migration-time grant; this assertion is allowed to be removed after "apply" if the owner edits roles, as happened with 0065.)

- [ ] **Step 2: Run the new tests and watch them fail**
  Run: `node --no-warnings --experimental-transform-types --test --test-name-pattern="return requests" db-tests/rules.test.mts`
  Expected: FAIL (`function request_return(...) does not exist` / permission key violation).

- [ ] **Step 3: Write `supabase/migrations/0067_return_requests.sql`** with the elements listed under Interfaces, in this order: header comment (what and why, "the running app keeps working"), permission rows and grants, table and index, RLS (`revoke all ... from anon`, `revoke insert, update, delete ... from authenticated`, `grant select`), audit trigger, realtime block (same `do $$ ... if exists (select 1 from pg_publication ...)` pattern as 0010), `booking_events_kind_check` extended with `'return_requested','return_request_cancelled'`, then the three functions. Behaviour per the spec and Global Constraints:
  - `request_return`: `require_perm('returns.request')`; lock the booking row with `select ... for update`; messages and order of checks: booking exists, not cancelled, needed-by not before `(now() at time zone 'Asia/Dubai')::date`, no existing open request (the unique index is the backstop), parcels check (given ids must all be `in_warehouse` parcels of this booking, else `Choose parcels of this booking that are in the warehouse`; null ids need at least one `in_warehouse` parcel else `This booking has no parcels in the warehouse`). Wrap the insert so a `unique_violation` raises `This booking already has an open return request`. Insert with `requested_by = auth.uid()` and name from `profiles`. Insert the booking event (reason = note or `Return requested`). Notify with one `insert ... select` of active profiles whose role has `returns.prepare`, `id is distinct from auth.uid()`.
  - `cancel_return_request`: lock the request; not found → `Return request not found`; status ≠ open → `This return request is already <status>`; allowed if `requested_by = auth.uid()` or `has_perm('returns.prepare')`, else `Only the person who asked, or the warehouse, can cancel this request`; update status/closed; event `return_request_cancelled`; notify warehouse people except the actor.
  - `prepare_return`: the exact body from `0019_warehouse_returns.sql` with `require_perm('returns.prepare')`, plus before `return rid`: close the booking's open request (status `prepared`, `return_id = rid`, `closed_at = now()`, `closed_by_name` = actor's name) and, if one was closed, notify its requester (if active and not the actor) with kind `return_prepared`, title `Return <code> is ready`, body naming the invoice.
  - Notification rows: `insert into notifications (user_id, booking_id, kind, title, body, actor_name)`; title `Return requested: <invoice_no or code> (<sender_name>)`; body = note plus `Needed by <date>` when set.

- [ ] **Step 4: Add the TEMP apply line** in `inTransaction` right after `begin`: `await client.query(readFileSync("supabase/migrations/0067_return_requests.sql", "utf8")); // TEMP until applied`. Run the same command as Step 2.
  Expected: all `return requests` tests PASS. Then run `node --no-warnings --experimental-transform-types --test --test-name-pattern="edit_parcels|warehouse jobs|returns" db-tests/rules.test.mts` to confirm the rewritten `prepare_return` broke nothing. Expected: PASS.

- [ ] **Step 5: Commit** (migration file and test file only; the TEMP line stays until "apply").
  `git add supabase/migrations/0067_return_requests.sql db-tests/rules.test.mts && git commit -m "Return requests: table, permission and functions (migration 0067)"`

---

### Task 2: Sample-data backend mirrors the rules

**Files:**
- Modify: `src/lib/mock-supabase.ts`
- Create: `tests/return-requests.test.mts`

**Interfaces:**
- Consumes: SQL contract and exact messages from Task 1 / Global Constraints.
- Produces (mock): table `return_requests` in the `Db` type and `freshMockData()`; RPCs `request_return`, `cancel_return_request`, `parcels_for_return_request` and an updated `prepare_return`; permission `returns.request` in `PERMISSIONS` and `GRANTS` (manager, staff, accounts? only roles that hold `bookings.edit` or `returns.prepare`: manager, staff, warehouse, super_admin); booking event kinds; notifications to the sample users. `setMockUser(id)` acts as another person (see `tests/rewards.test.mts` for the helper and sample ids `sample-staff`, `mock-user` (super admin), and the warehouse sample).

- [ ] **Step 1: Write the failing tests** in `tests/return-requests.test.mts` (pattern of `tests/celebrations.test.mts`: `createMockClient`, `freshMockData`, `setMockUser`, an `rpc` helper). Mirror every case of Task 1 that does not depend on SQL internals (including `parcels_for_return_request`): permission refusal, each exact message, the one-open-request rule, null versus array `parcel_ids`, events written, notifications reach active people with `returns.prepare` but not the actor, cancel rules, `prepare_return` closes the request and notifies the requester, `prepare_return` without a request unchanged, deleting a booking removes its requests (`delete_booking` mock). Use a booking with parcels in the warehouse from the sample data (BK-1003 has two `in_warehouse` parcels).

- [ ] **Step 2: Run and watch fail**
  Run: `node --experimental-transform-types --test tests/return-requests.test.mts`
  Expected: FAIL (`request_return` is not a function / unknown RPC).

- [ ] **Step 3: Implement the mock** next to the existing `prepare_return` (around `mock-supabase.ts:831`) and `delete_booking`: add `return_requests: Row[]` to the `Db` type and `[]` to the seed; the permission row `["returns.request", "Warehouse", "Request returns", "Ask the warehouse to prepare parcels for return, and cancel a request"]` and grants; the four RPCs with the same checks, messages and order as the SQL; event kinds `return_requested`, `return_request_cancelled`; `delete_booking` also filters `return_requests`. Bump the storage key to `logistics-mock-db-v42`.

- [ ] **Step 4: Run the new tests and the whole suite**
  Run: `node --experimental-transform-types --test tests/return-requests.test.mts && npm test`
  Expected: PASS, no regressions (292 tests before this plan).

- [ ] **Step 5: Commit** `git add src/lib/mock-supabase.ts tests/return-requests.test.mts && git commit -m "Return requests: sample-data backend"`

---

### Task 3: Type and pure helpers

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/return-requests.ts`
- Test: `tests/return-requests.test.mts` (append)

**Interfaces:**
- Produces:
  - `export type ReturnRequest = { id: string; booking_id: string; status: "open" | "prepared" | "cancelled"; note: string | null; needed_by: string | null; parcel_ids: string[] | null; requested_by_name: string | null; requested_at: string; return_id: string | null; closed_at: string | null; closed_by_name: string | null; booking?: Pick<Booking, "code" | "invoice_no" | "sender_name"> | null; return?: { code: string } | null }` in `types.ts`.
  - `pickList<T extends { id: string; status: string; position: string | null; barcode: string }>(request: Pick<ReturnRequest, "parcel_ids">, parcels: T[]): T[]`: only parcels with `status === "in_warehouse"` that are in `parcel_ids` (or all when `parcel_ids` is null), ordered by `position` (empty positions last) then `barcode`.
  - `changedCount(request: Pick<ReturnRequest, "parcel_ids">, parcels: { id: string; status: string }[]): number`: how many explicitly requested ids are no longer `in_warehouse` among `parcels` (0 when `parcel_ids` is null or empty).
  - `requestLine(r: Pick<ReturnRequest, "booking" | "requested_by_name" | "requested_at">): string`: `"<INV or code> · <sender_name>"` style one-line title used by both screens (`invoice_no ?? code`, then sender).

- [ ] **Step 1: Write the failing tests** (append): `pickList` null ids returns every `in_warehouse` parcel; an array limits it; a `loaded` or `ready_for_return` parcel is excluded; ordering `A-01` before `B-02` before a `null` position; empty result when none are left; `changedCount` is 0 for null ids, counts missing and non-`in_warehouse` ids, and is 0 when all are still in the warehouse; `requestLine` with and without `invoice_no`.
- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../src/lib/return-requests.ts'`).
- [ ] **Step 3: Implement** the type and the two functions.
- [ ] **Step 4: Run** `node --experimental-transform-types --test tests/return-requests.test.mts` → PASS.
- [ ] **Step 5: Commit** `git add src/lib/types.ts src/lib/return-requests.ts tests/return-requests.test.mts && git commit -m "Return requests: type and pick-list helper"`

---

### Task 4: The Return card on the booking page

**Files:**
- Create: `src/components/bookings/ReturnRequestCard.tsx`
- Modify: `src/app/bookings/[id]/page.tsx` (mount the card near `ItemsCard`, line ~147), `src/components/bookings/ScheduleHistory.tsx` (show `return_requested` and `return_request_cancelled` like the other event kinds; the reason line without the "Reason:" prefix for `return_requested`)
- Create: `tests/return-requests-screens.test.mts`

**Interfaces:**
- Consumes: `ReturnRequest`, `pickList` (Task 3); RPCs `request_return`, `cancel_return_request` (Tasks 1, 2); `usePermissions().can`, `confirmAction`, `DateField`, `Button`, `Card`, `ErrorMessage`, `Notice` from `@/components/ui/form`, `useQuery`.
- Produces: `export default function ReturnRequestCard({ bookingId, onChanged }: { bookingId: string; onChanged?: () => void })`. Renders nothing without `returns.request`. It loads the booking's latest request (`select('*, return:returns(code)').eq('booking_id', bookingId).order('requested_at', { ascending: false }).limit(1)`) and, through `supabase.rpc('parcels_for_return_request', { p_booking_id })`, the parcels that can be asked for (never a direct read of `parcels`, so people without `warehouse.view` can still request). It shows: a **Request return** button (when no open request and at least one parcel is in the warehouse) opening a panel with a tick list of those parcels (all ticked), a `DateField` "Needed by" (optional), a note box, **Send request**; or, for an open request, who asked, when, the note, needed-by, and a **Cancel request** button (confirm via `confirmAction`, `danger: true`); or for the latest request `prepared`, "Prepared as RT-…" linking to `/warehouse-inventory/returns/<return_id>` when `return_id` is set. Errors from the RPCs show with `ErrorMessage`. If every parcel is unticked, **Send request** is disabled.

- [ ] **Step 1: Write the failing screen tests** in `tests/return-requests-screens.test.mts` (source checks like `tests/celebrations-screens.test.mts`): the card file gates on `can("returns.request")`, calls both RPCs, uses `DateField` (no raw `type="date"`), `confirmAction` (no `confirm(`/`alert(`), `min-h-11` on its buttons, no raw `z-` numbers, hint text not below `text-sm`; the booking page imports and renders `ReturnRequestCard`; `ScheduleHistory` mentions both new event kinds.
- [ ] **Step 2: Run, expect FAIL** (`ENOENT ... ReturnRequestCard.tsx`).
- [ ] **Step 3: Implement the card, the page mount and the history kinds.**
- [ ] **Step 4: Verify** `node --experimental-transform-types --test tests/return-requests-screens.test.mts`, then `npx tsc --noEmit` and `npx eslint src tests` (both clean).
- [ ] **Step 5: Verify in the browser** on the sample-data dev server (BK-1003): the Request return button shows, sending a request shows the open state, cancelling clears it. Stop the server afterwards.
- [ ] **Step 6: Commit** `git add -A src tests && git commit -m "Return requests: Return card on the booking page"`

---

### Task 5: The To prepare list in the warehouse, counts and notification icons

**Files:**
- Create: `src/components/warehouse/ToPrepareList.tsx`
- Modify: `src/app/warehouse-inventory/page.tsx` (load open requests and their parcels, mount the list above `ReturnsList` in the Returns tab, tab count `returns` = open returns + open requests), `src/lib/badges.tsx` (the `/warehouse-inventory` badge also counts open requests), `src/app/notifications/page.tsx` (icons: `return_requested` and `return_prepared` use `Undo2`, `return_request_cancelled` uses `Ban`), `src/components/audit/AuditList.tsx` (`TABLE_LABELS` gets `return_requests: "Return request"`)
- Test: `tests/return-requests-screens.test.mts` (append)

**Interfaces:**
- Consumes: `ReturnRequest`, `pickList`, `requestLine` (Task 3); RPCs `prepare_return`, `cancel_return_request`.
- Produces: `export default function ToPrepareList({ requests, parcels, canPrepare, canCancel, onChanged }: { requests: ReturnRequest[]; parcels: StockParcel[]; canPrepare: boolean; canCancel: boolean; onChanged: () => void })`. Section title **To prepare**, one row card per open request (invoice and customer from `requestLine`, needed-by day, note, requested by and when); a row opens a pick list (barcode in mono, description, weight, **position**, each from `pickList`); **Prepare return** (`canPrepare`, calls `prepare_return` with `p_booking_id` and the pick-list ids, then `router.push("/warehouse-inventory/returns/<id>")`); **Cancel request** (`canCancel`, `confirmAction`). An empty pick list shows "Nothing left to return" and hides Prepare. When `changedCount(request, parcels) > 0` the row also shows the notice `Some requested parcels have changed (moved, merged, split or returned). Check the stock list.` in `text-sm`. An empty `requests` renders nothing. The page loads requests with `supabase.from("return_requests").select("*, booking:bookings(code, invoice_no, sender_name)").eq("status","open").order("needed_by", { nullsFirst: false }).order("requested_at")`; `canPrepare = can("returns.prepare")`, `canCancel = can("returns.prepare")`.

- [ ] **Step 1: Write the failing screen tests**: `ToPrepareList` uses `pickList`, shows `position`, gates Prepare on `canPrepare` and Cancel on `canCancel`, uses `confirmAction`, `min-h-11`, contains the texts "Nothing left to return", "To prepare" and "Some requested parcels have changed", and uses `changedCount`; the warehouse page imports and renders it and mentions `return_requests`; `badges.tsx` queries `return_requests`; the notifications page handles the three kinds; `AuditList` labels `return_requests`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the component and the four small edits.
- [ ] **Step 4: Run** `node --experimental-transform-types --test tests/return-requests-screens.test.mts && npm test && npx tsc --noEmit && npx eslint src tests db-tests` → all clean.
- [ ] **Step 5: Verify in the browser** (sample data): raise a request on BK-1003 as the office user, open Warehouse > Returns as the warehouse sample user (`setMockUser`) and see the row with the pick list and positions; Prepare opens the return form and the request disappears; the Returns tab count and Warehouse badge match. Stop the server.
- [ ] **Step 6: Commit** `git add -A src tests && git commit -m "Return requests: To prepare list, counts and notification icons"`

---

### Task 6: Final checks

**Files:** none new.

- [ ] **Step 1: Full local run:** `npm test`, `npx tsc --noEmit`, `npx eslint src tests db-tests`, `npm run test:db` (with the TEMP line still in place). Expected: everything green. Record the totals.
- [ ] **Step 2: Final whole-branch review** by a fresh reviewer on the most capable model (see executing-plans), then one fix pass (each fix RED then GREEN, suite green).
- [ ] **Step 3: Tell the owner** it is committed locally but NOT live, that migration 0067 is not applied, and ask for "apply". After "apply": `npm run db:backup`, `npm run db:migrate`, remove the `// TEMP until applied` line, run `npm run test:db`, commit. Push only when the owner says so (to a preview branch first).
