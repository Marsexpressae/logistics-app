# Refunds and credit notes: design

Date: 2026-10-15
Status: written, waiting for the owner's review. Nothing is built yet.

## 1. Purpose

After a booking is collected, invoiced or paid, the app today offers only "Cancel booking". Cancelling does not touch the invoice or the payments, so the books end up wrong (for example BK-1219: invoice INV-3829 for 3,259.00, paid in full, then cancelled, leaving 3,259.00 collected for a cancelled job with no refund recorded).

The goal: after collection, the correct actions are a **return** (parcels go back, already built) and a **refund** (money goes back). The invoice, the payments, the balances and the Accounts totals must always agree afterwards, and the history must stay honest (nothing edited or deleted).

## 2. Decisions already made with the owner

1. Return and refund are independent decisions. A return can happen with no refund, and a refund can happen with no return.
2. Two money records are needed: a **credit note** (lowers an invoice, no money moves) and a **refund** (money handed back). Either can exist without the other.
3. Some services are non-refundable (transport, packing, labour). Staff **type the kept services at credit-note time** (category, amount, note). The invoice itself stays a single total, with no breakdown by service.
4. A new permission, **"Issue refunds and credit notes"**, goes to Manager and Super admin at first. The owner can give it to other roles (for example Accounts) on the Roles page. No two-person approval step.
5. The customer gets a printable **credit note** and **refund receipt** in the style of the pickup receipt, with Print and Share as PDF.
6. Mistakes are fixed by **voiding** (the record stays, marked VOID, with reason, who and when). Nothing is deleted. Voiding needs a separate permission, **"Void refunds and credit notes"**, for Super admin only at first.
7. Cancelling a booking is for bookings **before collection**. Once any payment exists, cancel is blocked and staff are told to use a credit note and refund.
8. Approach A: two new record types. Existing payments and invoices are not changed. (Rejected: rebuilding all money as one signed ledger, too risky for live data. Rejected: storing refunds as negative payments, loses the audit trail and cannot print a credit note.)

## 3. Words used here

- **Invoice total now**: the original invoice amount minus all active credits.
- **Paid**: payments received minus active refunds handed back.
- **Balance due**: invoice total now minus paid, never below zero.
- **Refund due**: paid minus invoice total now, when the customer paid more than they now owe. Never below zero.
- **Active**: not voided. Only active records count in any total.

## 4. Data model

All amounts are `numeric(12,2)`. All new tables have row security on, no direct insert/update/delete rights for app users, and the existing change-log trigger (`audit_row`) so every change appears in Activity.

### credit_notes
- `id`, `number` (unique, from the number series below), `booking_id` (required), `invoice_no` (copied at the time), `return_id` (optional, one of this booking's returns), `note_date` (date), `reason` (required text).
- `old_total` (invoice total now, before this credit), `new_total` (the sum of the kept lines, 0 when there are none), `credit_amount` (= old_total minus new_total, must be above zero).
- `status` (`active` or `void`), `void_reason`, `voided_at`, `voided_by_name`, `created_by`, `created_by_name`, `created_at`.

### credit_note_lines
- `id`, `credit_note_id`, `category` (`transport`, `packing`, `labour`, `other`), `amount` (above zero), `note`.
- A correction such as a wrong amount is one `other` line holding the correct total.

### refunds
- `id`, `number` (unique, from the series), `booking_id`, `credit_note_id` (optional; a refund of a plain overpayment has none), `amount` (above zero), `method` (`cash` or `bank_transfer`), `refund_date`, `note`.
- `handed_by` and `handed_by_name` (the signed-in person), `status` (`active` or `void`), the same void fields, `created_at`.

### Number series
Two new series registered with `register_number_series`: credit notes (`CR-`, from 1001) and refunds (`RF-`, from 1001). Prefix and next number are changed in Settings, Numbering, like the others. (They appear there automatically.)

### Permissions
- `refunds.issue`, "Issue refunds and credit notes", group Accounts. Granted to Manager and Super admin.
- `refunds.void`, "Void refunds and credit notes", group Accounts. Granted to Super admin.
- Reading credit notes and refunds follows the same visibility as payments today. The plan must copy the existing payments read rule exactly.

## 5. Rules enforced in the database

The only way to create or void these records is through protected database functions (security definer) that check the permission first: `issue_credit_note`, `record_refund`, `void_credit_note`, `void_refund`.

`issue_credit_note(booking, reason, lines, date, return_id)`:
- The booking must be collected or at warehouse, have an invoice amount, and not be cancelled.
- `reason` is required. At least zero lines; every line amount above zero and category allowed.
- `new_total` is computed as the sum of the lines (never typed). It must be 0 or more and **below** `old_total`.
- `return_id`, when given, must belong to the same booking.
- Date: not in the future, and not before the booking's collection day.
- The booking row is locked (`for update`) while saving.

`record_refund(booking, credit_note_id, amount, method, date, note)`:
- Amount above zero and **not above refund due** at that moment (computed under the booking lock).
- Method `cash` or `bank_transfer`. Date: not in the future, not before the collection day.
- `credit_note_id`, when given, must be an active credit note of the same booking.

`void_credit_note(id, reason)` and `void_refund(id, reason)`:
- Only active records. A reason is required.
- A credit note cannot be voided while an active refund points to it (void the refund first).
- Voiding restores the numbers (a voided credit raises invoice total now, a voided refund raises paid).

`cancel_booking` gains one rule: if the booking has any payment, it raises "Payments exist. Use a credit note and refund instead."

## 6. The money maths (one place)

A single database function computes, for a booking: invoice total now, paid, balance due, refund due and the payment state. Accounts totals, the Accounts invoice list, search results and the booking page all use it, so they cannot disagree (the same approach as the booking stage).

Payment states, in this order:
1. `not_invoiced`: no invoice amount yet.
2. `refund_due`: paid is above invoice total now.
3. `credited`: invoice total now is 0 and paid is 0.
4. `paid`: balance due is 0.
5. `partial`: some paid, balance due above 0.
6. `unpaid`: nothing paid.

## 7. Accounts and booking screens

- Accounts cards: **Invoiced** = invoice totals now (cancelled bookings excluded, as today). **Collected** = payments minus refunds, with a note "Refunded: X". **Outstanding** = balances due.
- A new filter chip **Refund due**. The invoice list columns show current values (Amount = invoice total now, Paid = net paid, Balance = balance due) and a small "credited X" note under the amount when credits exist.
- The "Collected, by who and how" table keeps its payment rows and adds **Refunded** rows for cash and bank; the "All" row shows the net.
- Booking page payments card: original invoice, credits, invoice total now, paid, refunded, balance due or refund due. Credit notes and refunds appear in the history list beside payments, marked as money going out, each with Print and Share as PDF.
- The customer's history timeline lists credit notes and refunds.

## 8. Screens and flow

- A **"Credit note / refund"** button in the payments card, shown only with `refunds.issue`, and only for a collected booking with an invoice amount that is not cancelled.
- **Step 1, credit note screen:** reason, date, kept-service lines (category, amount, note), optional link to one of the booking's returns, and a live summary (invoice total now, new total, credit). A confirmation warns "This cannot be edited or deleted."
- **Step 2, refund:** shown right after saving when refund due is above zero. The amount is pre-filled with the most allowed; choose method, date, note. "Later" is allowed. A **Refund** button stays in the payments card while refund due is above zero.
- A refund also works without a credit note (a plain overpayment).
- The return page gets a shortcut button to this flow.
- Phones: large buttons, one step per screen.

## 9. Documents

- Credit note page and refund receipt page, laid out like the pickup receipt: company, number, date, invoice, customer, reason, kept lines, totals. The refund receipt adds a signature box.
- Print and Share as PDF, for people with the existing print permission. A voided record prints with VOID clearly shown.

## 10. Build stages (each shipped and checked on its own)

1. **Database foundation:** tables, number series, permissions, the four protected functions, change-log triggers, the money-maths function. Additive only. Backup first. Real-database tests in rolled-back transactions.
2. **Money maths in Accounts:** update `accounts_summary`, `accounts_invoices` and the search payment state to use the one function; the new states and filter; the cancel rule; the Accounts screen changes; the payments card summary. Mirror the rules in the sample-data layer.
3. **Screens:** the credit note and refund flow, return shortcut, history lines, customer timeline.
4. **Documents and voiding:** the credit note page, refund receipt, print and share, the void screens.

After each stage: all tests, a look in dev, then the owner's "push to preview" and "merge". The database change always goes live before the screens that need it.

## 11. Testing

- Real-database tests for every rule in section 5 and the maths in section 6, including: refunds can never exceed what was paid, two refunds cannot together exceed refund due, a voided record restores the numbers, a credit note with an active refund cannot be voided, permission checks, and the cancel rule.
- Sample-data tests mirroring the same behavior.
- A check in the browser of the Accounts totals and the booking page after each stage.

## 12. Not included, on purpose

- No customer credit balance for future bookings.
- No breakdown of an invoice by service.
- No approval step by a second person.
- No change to the statement of account.
- **No VAT split.** The app has no VAT fields. A credit note follows the invoice amount exactly. If the business is VAT-registered, the owner should ask their accountant how credit notes must show VAT; a split would be a separate piece of work.

## 13. Risks and follow-ups

- Money logic: correctness matters more than speed. Rules sit in the database and are tested before any screen exists.
- Existing data: three live bookings had all parcels returned with no money recorded, and some cancelled bookings may still hold payments. Nothing is changed automatically. Before stage 2, check live data and report what is found; the owner decides.
- The booking-stage function and the new money function are separate on purpose (stage is about parcels, money is about invoice and payments).
