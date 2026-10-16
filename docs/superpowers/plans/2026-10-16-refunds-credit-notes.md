# Refunds and Credit Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a booking is collected, invoiced or paid, staff can issue a credit note (lowers the invoice) and record a refund (money back), with the books always adding up, and no more cancelling of paid bookings.

**Architecture:** Two new additive record types (credit notes with kept-service lines, and refunds), created only through protected database functions. One database function (`money_of`) works out invoice total now, paid, balance due, refund due and the payment state, and every total, list and screen reads it. Real-database tests come first, in rolled-back transactions.

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4 client pages, Supabase Postgres (SQL migrations in `codebase/supabase/migrations/`), `node:test` (`npm test` for the sample-data layer, `npm run test:db` for the real database).

**Spec:** `codebase/docs/superpowers/specs/2026-10-15-refunds-credit-notes-design.md` (approved by the owner). Read it first; section numbers below refer to it.

## Global Constraints

- All money is `numeric(12,2)`; compare and total with `round(x, 2)`.
- Next free migration number is `0054` (last applied is `0053_sortable_lists.sql`). Migrations must be re-runnable (`create table if not exists`, `create or replace function`, `drop trigger if exists`, `on conflict do nothing`).
- New permissions (exact keys and labels): `refunds.issue` "Issue refunds and credit notes" (Manager, Super admin); `refunds.void` "Void refunds and credit notes" (Super admin). Group name `Accounts`.
- New number series kinds: `credit_note` (label "Credit note numbers", prefix `CR-`, start 1001, sort 50) and `refund` (label "Refund numbers", prefix `RF-`, start 1001, sort 60), registered with `register_number_series(kind, label, prefix, start, table, column, sort)`; numbers are taken with `take_next_number('credit_note')` and `take_next_number('refund')`.
- Dates: a given day may not be in the future and may not be before the booking's collection day (`(collected_at at time zone 'Asia/Dubai')::date`). `null` means today in Dubai.
- Only functions create or void these records. App users get no insert/update/delete rights on the new tables; `anon` gets nothing.
- Every change to the live database: say so first, run `npm run db:backup`, then `npm run db:migrate`, then `npm run test:db`. The database change goes live before the screens that need it.
- Never push or deploy unless the owner says so in that message. Commit locally as `ibnhabib <shoaib.amir@hotmail.com>` with no co-author line. Before any push, remind the owner it goes live.
- After every task: `npx tsc --noEmit`, `npx eslint src tests db-tests`, `npm test` all clean.
- Plain-language screen text; errors are short sentences. Phones first: 44px targets, `Button size="large"` for main actions, use `confirmAction` and `askText` from `src/lib/ask.ts` (never browser pop-ups).

## Review Focus

Inputs the spec implies but its rules do not spell out. Each has a named test in the owning task.
1. Two refunds on one invoice, the second above what remains: refused; exactly what remains: accepted (Task 4, `refunds never exceed refund due`).
2. A customer who paid exactly the invoice, with no credit note, asks for a refund: refused (Task 4, `no refund when nothing is due`).
3. A credit note whose new total is above what the customer paid: no refund due, balance due stays (Task 2, `credit above paid leaves a balance`).
4. Voiding in the wrong order (credit note while its refund is active) is refused, and voiding in the right order returns every total to the original (Task 5).
5. A line of 0.00, a negative amount, an unknown category, an amount with three decimals, and a collection-day date are each handled: refused, refused, refused, rounded to two decimals, accepted (Task 3).

## File Structure

- Create `codebase/supabase/migrations/0054_credit_notes_refunds.sql` (stage 1), `0055_money_in_accounts.sql` (stage 2), `0056_money_in_timeline.sql` (stage 3).
- Create `codebase/src/lib/money.ts` (pure `moneyOf`, mirrors the database function for the sample-data layer).
- Modify `codebase/src/lib/mock-supabase.ts` (tables, series, functions mirrored), `codebase/src/lib/types.ts`, `codebase/src/lib/status.ts`.
- Create `codebase/src/components/money/CreditNotePanel.tsx`, `RefundPanel.tsx` and `VoidButton.tsx`. The two print pages are `codebase/src/app/bookings/[id]/credit-notes/[noteId]/page.tsx` and `codebase/src/app/bookings/[id]/refunds/[refundId]/page.tsx`.
- Modify `codebase/src/components/bookings/PaymentsCard.tsx`, `codebase/src/app/bookings/[id]/page.tsx`, `codebase/src/app/accounts/page.tsx`, `codebase/src/app/warehouse-inventory/returns/[id]/page.tsx`.
- Tests: append to `codebase/db-tests/rules.test.mts` (real database; each new test first runs `readFileSync("supabase/migrations/<file>")` inside the transaction until the stage is applied live, then that line is deleted); create `codebase/tests/money.test.mts` and `codebase/tests/credit-refund.test.mts`.

## Stage 1: Database foundation (`0054_credit_notes_refunds.sql`)

### Task 1: Tables, series, permissions, protection

**Files:** Create `supabase/migrations/0054_credit_notes_refunds.sql`. Test: append to `db-tests/rules.test.mts`.

**Interfaces — Produces:** tables `credit_notes`, `credit_note_lines`, `refunds` exactly as below; permissions and series from Global Constraints.

- [ ] **Step 1: Write the failing test** `credit notes and refunds: tables are protected, permissions and series exist`. Assert: `number_series` has kinds `credit_note` and `refund` with prefixes `CR-` and `RF-`; `role_permissions` grants `refunds.issue` to `manager` and `super_admin` and `refunds.void` to `super_admin` only; a person with every permission (`db.person([...])`) gets "permission denied" on a direct `insert into credit_notes ...`, `update refunds ...`, and `delete from credit_note_lines`; `anon` cannot select any of the three.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (relation does not exist).
- [ ] **Step 3: Implement the migration** (additive, re-runnable):
  - `credit_notes(id uuid pk default gen_random_uuid(), number text unique not null, booking_id uuid not null references bookings(id) on delete restrict, invoice_no text not null, return_id uuid references returns(id) on delete set null, note_date date not null, reason text not null check (length(btrim(reason)) > 0), old_total numeric(12,2) not null, new_total numeric(12,2) not null check (new_total >= 0), credit_amount numeric(12,2) not null check (credit_amount > 0), status text not null default 'active' check (status in ('active','void')), void_reason text, voided_at timestamptz, voided_by_name text, created_by uuid, created_by_name text, created_at timestamptz not null default now(), check (credit_amount = old_total - new_total))`.
  - `credit_note_lines(id uuid pk, credit_note_id uuid not null references credit_notes(id) on delete restrict, category text not null check (category in ('transport','packing','labour','other')), amount numeric(12,2) not null check (amount > 0), note text)`.
  - `refunds(id uuid pk, number text unique not null, booking_id uuid not null references bookings(id) on delete restrict, credit_note_id uuid references credit_notes(id) on delete restrict, amount numeric(12,2) not null check (amount > 0), method text not null check (method in ('cash','bank_transfer')), refund_date date not null, note text, handed_by uuid, handed_by_name text, status text not null default 'active' check (status in ('active','void')), void_reason text, voided_at timestamptz, voided_by_name text, created_at timestamptz not null default now())`.
  - Foreign-key indexes on every foreign key above. Row security on; `revoke all` from `anon`; `revoke insert, update, delete` from `authenticated`; `grant select` to `authenticated`.
  - Select policy on `credit_notes` and `refunds` copies `payments_select` exactly: `has_perm('accounts.view') or (has_perm('pickups.collect') and exists (select 1 from bookings b where b.id = booking_id))`, each wrapped in `(select ...)`. `credit_note_lines` select: `exists (select 1 from credit_notes c where c.id = credit_note_id)`.
  - `create trigger audit_<table> after insert or update or delete on <table> for each row execute function audit_row()` for all three.
  - Insert the two permissions (columns `key, group_name, label, description, sort`) and the role grants with `on conflict do nothing`. Register both series.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git add supabase/migrations/0054_credit_notes_refunds.sql db-tests/rules.test.mts && git commit -m "Refunds and credit notes: tables, series, permissions"`.

### Task 2: The money function

**Files:** Modify `0054_credit_notes_refunds.sql`. Test: `db-tests/rules.test.mts`.

**Interfaces — Produces:** `money_of(p_booking uuid) returns table (invoice_now numeric, paid numeric, balance_due numeric, refund_due numeric, pay_status text)` (SQL, stable, security invoker, so row security still applies); `booking_money(p_booking uuid) returns jsonb` (keys equal the column names above; `execute` granted to `authenticated`, revoked from `anon`).

- [ ] **Step 1: Write failing test** `money_of works out invoice total now, paid, balance, refund due and state`. Insert rows as owner and assert, for an invoice of 1000.00: no payments is `unpaid`, balance 1000; payment 400 is `partial`, balance 600; payment 1000 is `paid`, balance 0; no invoice amount is `not_invoiced` and null balance. With paid 1000 and an active credit note `old_total 1000, new_total 650`: invoice_now 650, refund_due 350, state `refund_due`; adding an active refund of 350 gives paid 650, refund_due 0, state `paid`. Test `credit above paid leaves a balance`: paid 100, credit with new_total 650: balance_due 550, refund_due 0, state `partial`. Full credit (`new_total 0`) with paid 0: state `credited`. A voided credit note and a voided refund change nothing.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (function does not exist).
- [ ] **Step 3: Implement** both functions. State order: `not_invoiced`, `refund_due` (paid > invoice_now), `credited` (invoice_now = 0 and paid = 0), `paid` (invoice_now − paid ≤ 0), `partial` (paid > 0), `unpaid`. Only `status = 'active'` rows count. `paid` = sum(payments) − sum(active refunds).
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Refunds and credit notes: the money function"`.

### Task 3: `issue_credit_note`

**Files:** Modify `0054_...sql`. Test: `db-tests/rules.test.mts`.

**Interfaces — Consumes:** `money_of`. **Produces:** `issue_credit_note(p_booking_id uuid, p_reason text, p_lines jsonb, p_date date default null, p_return_id uuid default null) returns uuid` (security definer, `search_path = public`, `require_perm('refunds.issue')`, execute for `authenticated` only). `p_lines` is `[{"category","amount","note"}]`.

- [ ] **Step 1: Write failing tests.** `issues a credit note and numbers it`: booking invoice 1000, collected, paid 1000; lines transport 400, packing 150, labour 100 → returns an id; row has number matching `^CR-\d+$`, `old_total 1000`, `new_total 650`, `credit_amount 350`, three line rows. `full credit when there are no lines`: `new_total 0`, `credit_amount 1000`. `refuses`, each with its own message asserted by regex: booking not collected (`/collected/`), no invoice amount, cancelled, empty reason, a line of 0.00 or −5, category `food`, new total equal to old total (`/below/`), future date, a date before the collection day, a `p_return_id` of another booking, a person without `refunds.issue` (`/permission/i`). Accepts: date equal to the collection day; an amount of `100.005` is stored as `100.01` (rounded).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Lock the booking `for update`; compute `old_total = (money_of(p_booking_id)).invoice_now`; `new_total = round(sum(lines.amount), 2)` (never typed); validate; number via `take_next_number('credit_note')`; insert note and lines; set `created_by`, `created_by_name` from `profiles` as other functions do; `invoice_no` copied from the booking.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Refunds and credit notes: issue_credit_note"`.

### Task 4: `record_refund`

**Interfaces — Consumes:** `money_of`. **Produces:** `record_refund(p_booking_id uuid, p_credit_note_id uuid, p_amount numeric, p_method text, p_date date default null, p_note text default null) returns uuid` (same security settings as Task 3).

- [ ] **Step 1: Failing tests.** `refunds never exceed refund due`: after a credit note leaves refund_due 350, a refund of 350.01 is refused (`/more than/`), 200 is accepted, a second 200 is refused, 150 is accepted, and `money_of.refund_due` is then 0. `no refund when nothing is due`: paid exactly the invoice, no credit note, any refund refused. `plain overpayment can be refunded`: payments 1100 on an invoice of 1000, no credit note id, refund 100 accepted. Refusals: amount 0 or negative, method `card`, future date, date before the collection day, a `p_credit_note_id` of another booking or a voided one, no permission. The number matches `^RF-\d+$`, `handed_by_name` is the signed-in person's name.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with the booking locked `for update`, refund due re-read inside the lock, amount rounded to 2 decimals before comparing.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Refunds and credit notes: record_refund"`.

### Task 5: Voiding

**Produces:** `void_credit_note(p_id uuid, p_reason text) returns void` and `void_refund(p_id uuid, p_reason text) returns void` (security definer, `require_perm('refunds.void')`).

- [ ] **Step 1: Failing test** `voiding restores the numbers, in the right order`: with an active credit note and refund, `void_credit_note` is refused (`/refund/`); `void_refund` works (paid rises, refund_due returns to 350); then `void_credit_note` works and `money_of` equals the original (invoice_now 1000, refund_due 0 for the paid-1000 case). Refusals: empty reason, already void, a person with only `refunds.issue` (`/permission/i`). The voided row keeps its data and has `void_reason`, `voided_at`, `voided_by_name`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (lock the booking, update status and void fields only).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Refunds and credit notes: voiding"`.

### Task 6: Apply stage 1 live

- [ ] **Step 1:** Tell the owner this is a live database change (additive only) and wait for "apply".
- [ ] **Step 2:** `npm run db:backup`, then `npm run db:migrate`. Expected output: `Applying 0054_credit_notes_refunds.sql ...`.
- [ ] **Step 3:** Delete the `readFileSync("supabase/migrations/0054...")` line from the stage-1 tests; run `npm run test:db`. Expected: all pass against the live structure.
- [ ] **Step 4:** Confirm through the live API that a signed-out visitor is refused on `booking_money` and that the three tables are not readable. Commit. Report to the owner. No screens change yet, so nothing needs pushing.

## Stage 2: Money maths in Accounts (`0055_money_in_accounts.sql`)

### Task 7: Database: totals, list, search state, cancel rule

**Files:** Create `supabase/migrations/0055_money_in_accounts.sql`. Test: `db-tests/rules.test.mts`.

- [ ] **Step 1: Failing tests.** `accounts_summary counts credits and refunds`: read the summary, add a paid invoice 1000 with a credit to 650 and a refund of 350, read again; deltas are invoiced +650, collected +650, outstanding +0, `refunded` +350 (new key), `refund_due_count` unchanged. `accounts_invoices uses current values`: the row shows `r_amount 650`, `r_paid 650`, `r_balance 0`, new column `r_credited 350`, state `paid`; the new filter value `refund_due` returns only invoices with money owed back; sorting keys from migration 0053 still work. `global_search` shows the same state. `cancel_booking` raises `/Payments exist/` when a payment exists and still cancels an unpaid collected booking.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement:** `accounts_summary()` (keep its shape; add `refunded`, `refund_due_count`, `refund_due_amount`; `collections` keeps the payment rows and adds `refunds: {cash, bank}`), `accounts_invoices(...)` (drop and recreate with the extra `r_credited numeric`; all money columns from `money_of`; filter value `refund_due`; keep every sort from 0053), `global_search` (replace the `pay_status` expression with `(select pay_status from money_of(bk.id))`; change nothing else), `cancel_booking` (add the payments check before the update). Use the live definitions via `pg_get_functiondef` and change only the money expressions. Keep grants identical.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Check live data and report to the owner (no changes):** bookings that would show `refund_due` today (overpaid invoices), the three fully returned bookings with no money recorded. Cancelled bookings holding payments: 0 (checked 2026-10-16). Commit.

### Task 8: Sample-data layer and shared types

**Files:** Create `src/lib/money.ts`, `tests/money.test.mts`. Modify `src/lib/mock-supabase.ts` (bump the storage key to `logistics-mock-db-v35`), `src/lib/types.ts`, `src/lib/status.ts`.

**Interfaces — Produces:** `moneyOf(input: { invoiceAmount: number | null; payments: number[]; credits: number[]; refunds: number[] }): { invoice_now: number | null; paid: number; balance_due: number | null; refund_due: number; pay_status: PayStatus }` where `PayStatus = "not_invoiced" | "refund_due" | "credited" | "paid" | "partial" | "unpaid"`; types `CreditNote`, `CreditNoteLine`, `Refund`, `Money` in `types.ts`; status labels `refund_due` ("Refund due", amber) and `credited` ("Fully credited", slate) in `status.ts`.

- [ ] **Step 1: Failing tests** `tests/money.test.mts`: the same scenario table as Task 2 (1000 unpaid, 400 partial, 1000 paid, credit to 650, refund 350, full credit, credit above paid), plus `status.ts` has both new labels.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `moneyOf` (two-decimal rounding), the types, the labels. Mirror in the mock: tables `credit_notes`, `credit_note_lines`, `refunds`; series `credit_note` and `refund` in `number_series`; functions `issue_credit_note`, `record_refund`, `void_credit_note`, `void_refund`, `booking_money` with the same rules and messages as Tasks 3 to 5; `accounts_summary`, `accounts_invoices` (with `refund_due` filter and `r_credited`), `global_search` state and `cancel_booking` rule updated like Task 7.
- [ ] **Step 4:** `npm test`. Expected: PASS. Add `tests/credit-refund.test.mts` covering the Task 3 to 5 refusals through `createMockClient()`.
- [ ] **Step 5: Commit** `git commit -am "Refunds and credit notes: sample-data layer"`.

### Task 9: Accounts and payments screens

**Files:** Modify `src/app/accounts/page.tsx`, `src/components/bookings/PaymentsCard.tsx`, `src/app/bookings/[id]/page.tsx`.

- [ ] **Step 1:** Add a test in `tests/credit-refund.test.mts`: Accounts filter list contains `refund_due` (read from the exported `FILTERS`, export it), and `booking_money` is used by the payments card (a source check, like `tests/disclosure.test.mts`).
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Accounts: chip "Refund due"; under Collected the note `Refunded: X`; in the collections table a `Refunded` row (cash, bank, negative); under the Amount cell a small `credited X` when `r_credited > 0`. Payments card: load `booking_money`, `credit_notes` (with `credit_note_lines`) and `refunds` for the booking; show original invoice, credits, invoice total now, paid, refunded, balance due or refund due; list credit notes and refunds beside payments, marked as money going out. Reuse `money()` and `StatusBadge`.
- [ ] **Step 4:** `npx tsc --noEmit`, lint, `npm test`. Then in dev (owner signs in): BK-1219 card shows the new lines with no credit notes yet.
- [ ] **Step 5: Commit.**

### Task 10: Apply stage 2 and ship

- [ ] **Step 1:** Tell the owner; wait for "apply". Backup, `npm run db:migrate`, delete the `readFileSync("...0055...")` lines, `npm run test:db`.
- [ ] **Step 2:** Check Accounts in dev against live data, then wait for "push to preview", then "merge".

## Stage 3: The screens (`0056_money_in_timeline.sql`)

### Task 11: Credit note and refund panels

**Files:** Create `src/components/money/CreditNotePanel.tsx`, `src/components/money/RefundPanel.tsx`. Modify `PaymentsCard.tsx`.

**Interfaces — Consumes:** `issue_credit_note`, `record_refund`, `booking_money`. **Produces:** `CreditNotePanel({ booking, money, returns, onDone }: { booking: Booking; money: Money; returns: { id: string; code: string }[]; onDone: () => void })` and `RefundPanel({ booking, money, creditNoteId?: string, onDone: () => void })`.

- [ ] **Step 1: Failing tests** in `tests/credit-refund.test.mts` (through `createMockClient()`): the full flow as the screens use it: issue a credit note with kept lines, then a refund of exactly `refund_due`; the Accounts totals and `booking_money` match Task 2's numbers; a refund after the credit note leaves `pay_status` `paid`; voiding both restores the original.
- [ ] **Step 2:** `npm test`. Expected: FAIL until the panels exist (add a source check that `PaymentsCard.tsx` renders both panels only when `can("refunds.issue")` and the booking is collected or at warehouse with an invoice amount, and not cancelled).
- [ ] **Step 3: Implement.** The "Credit note / refund" button in the payments card opens `CreditNotePanel` inline (a `Card`, like `BookingChangePanel`): reason (required), `DateField` (no future), kept-service lines (category select, amount, note, add and remove), optional related return, live summary (invoice total now, new total, credit), `confirmAction` "This cannot be edited or deleted." After saving, when `refund_due > 0` show "The customer is owed X. Record the refund now?" and open `RefundPanel` (amount prefilled with `refund_due`, method select, `DateField`, note); "Later" closes it. A "Refund" button stays in the payments card while `refund_due > 0` (also for a plain overpayment). Errors from the database shown with `ErrorMessage`.
- [ ] **Step 4:** `npm test` passes. In dev, create nothing on live data; walk the screens only as far as the confirm dialog, or use the sample-data server for a full walkthrough.
- [ ] **Step 5: Commit.**

### Task 12: Return shortcut and customer timeline

**Files:** Modify `src/app/warehouse-inventory/returns/[id]/page.tsx`; create `supabase/migrations/0056_money_in_timeline.sql`.

- [ ] **Step 1: Failing real-database test** `customer timeline lists credit notes and refunds`: after issuing both for a customer's booking, `customer_timeline` contains rows with `r_kind` `credit_note` and `refund` with titles "Credit note CR-… issued" and "Refund RF-… paid" (voids add "… voided").
- [ ] **Step 2:** Run `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** two more `union all` branches in `customer_timeline` reading `credit_notes` and `refunds` directly (not the change log), keep every existing branch and the signature. Add to the return page a button "Credit note and refund for this booking" that links to the booking page with `?credit=1&return=<id>`, and make the payments card open the panel with that return pre-selected when those parameters are present.
- [ ] **Step 4:** Tests pass; mirror the timeline branches in the sample-data layer.
- [ ] **Step 5: Commit. Apply `0056` only after the owner says "apply".**

## Stage 4: Documents and voiding

### Task 13: Printable credit note and refund receipt

**Files:** Create `src/app/bookings/[id]/credit-notes/[noteId]/page.tsx`, `src/app/bookings/[id]/refunds/[refundId]/page.tsx`. Modify `PaymentsCard.tsx` (Print and Share links).

- [ ] **Step 1: Failing test** (source check plus data check): each page reads the permission `documents.print` before showing Print and Share, uses `ShareButton`, and prints `VOID` when `status === "void"`; the data the pages need (number, date, invoice, customer, reason, lines, totals) is returned by one query per page.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** both pages in the layout of `src/app/pickups/[id]/receipt/page.tsx` (read it first): company name and number from the organization settings, number and date, invoice and booking, customer, reason, kept lines, totals (old total, kept total, credit; for the receipt the amount returned, method, handed over by, a signature box). A voided record shows a clear VOID mark.
- [ ] **Step 4:** Tests pass; check both pages in dev with sample data and the print preview.
- [ ] **Step 5: Commit.**

### Task 14: Void screens and final checks

**Files:** Create `src/components/money/VoidButton.tsx`. Modify `PaymentsCard.tsx`.

**Produces:** `VoidButton({ kind, id, onDone }: { kind: "credit_note" | "refund"; id: string; onDone: () => void })`, shown only with `can("refunds.void")` on an active record; it asks for a reason with `askText`, then calls `void_credit_note` or `void_refund`.

- [ ] **Step 1: Failing test:** through `createMockClient()` voiding in the wrong order returns the refusal message, in the right order restores the numbers (as Task 5); a source check that the button is gated by `refunds.void`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the button and show voided records struck through with their void reason in the history list.
- [ ] **Step 4:** Whole suite: `npx tsc --noEmit`, lint, `npm test`, `npm run test:db`. Final browser pass on the Accounts page, a booking page, and both documents.
- [ ] **Step 5: Commit.** Report to the owner what is ready and wait for "push to preview", then "merge".

## Self-review notes

- Spec coverage: section 4 (Task 1), 5 (Tasks 3 to 5, cancel rule in 7), 6 (Task 2), 7 (Tasks 7 and 9), 8 (Tasks 11 and 12), 9 (Task 13), voiding (Tasks 5 and 14), 10 (stages), 11 (tests inside every task), 12 (nothing planned), 13 (live-data check in Task 7).
- Type names are consistent across tasks: `money_of`, `booking_money`, `issue_credit_note`, `record_refund`, `void_credit_note`, `void_refund`, `moneyOf`, `PayStatus`, `Money`.
