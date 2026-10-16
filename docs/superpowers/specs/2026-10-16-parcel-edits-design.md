# Add, merge and split parcels: design

Date: 2026-10-16
Status: written, waiting for the owner's review. Nothing is built yet.

## 1. Purpose

Today the warehouse can only redo all of a booking's parcels at once (a repack: every parcel still in the warehouse is retired and a full new set is created, with new labels). It cannot add one missing parcel, merge two parcels, or split one, without relabelling everything.

The goal: warehouse staff can fix a booking's parcel list in small steps from the Warehouse page. Untouched parcels keep their label and sticker. Every change is recorded in the history.

## 2. Decisions already made with the owner

1. The three tools live in the **Warehouse module** (Warehouse page). The booking page only shows the result.
2. **Only the changed parcels get new labels.** Untouched parcels keep their label and barcode, so no sticker needs reprinting.
3. The history line is plain: "Merged parcels P1 and P2 into new parcel R2-P1".
4. Permission: the existing "Receive and split parcels" (`warehouse.manage`). No new permission.
5. Not included: undo (a mistake is fixed with another edit), editing a weight or description alone without a new label.

## 3. Words used here

- **Round**: how many times a booking's parcels were packed. Round 1 is as first received (labels such as `BK-1003-P1`). Each edit creates the next round for its new parcels (labels such as `BK-1003-R2-P1`).
- **Retire**: mark a parcel `repacked`. It stays in the history and is hidden from stock, exactly as in a normal repack today.

## 4. The database function

One protected function, `edit_parcels(p_booking_id uuid, p_retire_ids uuid[], p_new jsonb, p_warehouse_id uuid default null, p_date date default null) returns int` (security definer, `search_path = public`, `require_perm('warehouse.manage')`, execute for `authenticated` only). `p_new` is `[{"description","weight_kg"}]`. It returns the number of new parcels.

The three buttons are three uses of it:
- **Add**: no retired parcels, one new parcel, `p_warehouse_id` required.
- **Merge**: two or more retired parcels, exactly one new parcel.
- **Split**: exactly one retired parcel, two or more new parcels.

Rules, all enforced in the database, with the booking locked `for update` while saving:
- The booking exists and is `collected` or `at_warehouse`.
- Every retired parcel belongs to this booking and has status `in_warehouse` (never loaded, in transit, delivered, or on a return form). No duplicates in the list.
- The shape matches one of the three uses above; otherwise a plain message.
- Every weight is zero or more; the description is trimmed and may be empty.
- New parcels go to the warehouse of the first retired parcel, or `p_warehouse_id` for Add. The warehouse must be active.
- The date, when given, follows the same rule as `split_booking` (not in the future, not before the collection day).
- New parcels take the next round number of the booking and the next sequence numbers. Barcode `CODE-R<round>-P<n>` with `n` counting from 1 within this edit (the same scheme as a repack). Retired parcels get status `repacked`.
- The booking row is updated to `at_warehouse` only if it was `collected` (Add on a collected booking with no parcels is the same as the first receive).
- One `booking_events` row records the change in plain words (see section 5). The parcel history entries (`in_warehouse` for new parcels, `repacked` for retired ones) come from the existing parcel triggers.

## 5. History and labels

- New `booking_events.kind` value `parcels_edited`. The existing check constraint is extended in the migration.
- The reason text is the plain line, for example `Merged parcels P1 and P2 into new parcel R2-P1`, `Split parcel P2 into new parcels R2-P1 and R2-P2`, `Added parcel R2-P1`. Short labels (the part after the booking code) are used in the text.
- `customer_timeline` currently shows any unknown event kind as "Cancelled". The migration replaces that function with a version that labels `parcels_edited` as "Parcels changed", keeping every other branch and the signature, and also keeps the credit-note and refund entries added in migration 0056.
- The existing Unpacked and Packed tabs keep their rule (round 1 is Unpacked, later rounds are Packed), so new parcels appear under Packed and untouched ones stay under Unpacked.

## 6. Screens

On the Warehouse page, for people with `warehouse.manage`:
- The selection bar gains **Merge** (2 or more parcels of one booking ticked) and **Split** (exactly 1 ticked). Both are hidden if the ticked parcels are not all `in_warehouse` or belong to different bookings.
- Each booking's row gains **Add parcel**.
- Each action opens a small form on the same page.
  - Merge: one description box, weight pre-filled with the sum of the ticked parcels.
  - Split: two or more rows of description and weight, a running total, and a note such as "Original 20 kg, new total 21 kg". A weight change is allowed.
  - Add: description, weight, and warehouse.
  - A confirm step names what will be retired and created.
- After saving, the new labels are shown with a **Print labels** button that uses the existing label printing.
- Errors from the database are shown with the standard error message.
- Phones: large buttons, one form at a time.

## 7. Where it lives in the code

- New migration `0058_edit_parcels.sql`: the function, the new event kind, the updated `customer_timeline`. Additive; applied live only after the owner says "apply", after a backup.
- The Warehouse page (`src/app/warehouse-inventory/page.tsx`, 637 lines) is split into smaller files as part of this work, with no visible change first. The three forms are separate components in `src/components/warehouse/`.
- The sample-data layer (`src/lib/mock-supabase.ts`) mirrors the function, rules and messages. Its storage key is bumped.

## 8. Build stages (each shown to the owner before the next)

1. Database function, event kind, timeline label, with real-database tests.
2. Sample-data mirror, and the split of the Warehouse page with no visible change.
3. The three forms and the history lines.
4. Label printing after saving, and a final browser check.

The database change goes live before the screens that need it.

## 9. Testing

- Real-database tests (always rolled back): each of the three uses and its result (labels, rounds, retired statuses, history line); every refusal (wrong booking, loaded or returned parcel, duplicate ids, wrong counts, negative weight, inactive warehouse, future date, no permission, signed-out visitor); untouched parcels keep their label and status; two edits in a row give rounds 2 and 3 with unique barcodes; the customer timeline shows "Parcels changed" and never "Cancelled".
- Sample-data tests mirroring the same behavior.
- A browser check of the Warehouse page and the three forms on sample data.

## 10. Risks and notes

- Parcels are the physical truth, so rules sit in the database and are tested before any screen exists.
- A merge or split that changes the total weight is allowed on purpose (scales differ); the screen shows the difference.
- Existing repack (`split_booking`) is not changed.

## 11. Amendment (2026-10-16, owner's decision after the preview)

**Adding a parcel is removed.** Extra cargo from a customer is a new booking with its own invoice, so a parcel must never appear with no parcel retired. `edit_parcels` is merge and split only (migration `0059_edit_parcels_no_add.sql` replaces the function with `edit_parcels(p_booking_id, p_retire_ids, p_new, p_date)`; an empty retire list is refused with "Choose the parcels to change"; the `p_warehouse_id` parameter is gone because new parcels go to the place of the retired ones). The Add parcel buttons and the "Added parcel" history line are gone. A box forgotten at intake is fixed with the existing repack (Labels).
