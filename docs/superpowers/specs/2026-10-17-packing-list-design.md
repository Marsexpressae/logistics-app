# Packing list: order, serial numbers, move up and down

Date: 2026-10-17
Status: written, waiting for the owner's review. Nothing is built yet.

## 1. Purpose

The "Package items" card on a booking lists the items the driver recorded at pickup. It has no order of its own: the screens sort by the item's random internal id, so the order a person sees is accidental and cannot be controlled. The owner wants it to behave like a real packing list: a clear name, serial numbers, a stable order, and the ability to rearrange the items.

## 2. Decisions already made with the owner

1. The card is renamed **Packing list**.
2. Each row shows a **serial number** (1, 2, 3 ...) and the items appear in that order.
3. Each row has **move up** and **move down** buttons.
4. The printed pickup receipt follows the same order and gets a first column **#** (the latest rearranged order).
5. Nothing else changes: no new fields, no drag and drop, no other lists.

## 3. Words used here

- **Position**: the stored order number of an item inside its booking. Lower comes first.
- **Serial number**: the row's place in the list (position order), counted from 1. It is worked out when the list is shown, never stored, so it renumbers by itself when an item is moved or removed.

## 4. Data

- New column `booking_items.position int not null`.
- Migration backfills existing rows: per booking, numbered 1, 2, 3 ... in the order the screens show today (by `id`), so nothing visibly jumps.
- A `before insert` trigger gives a new item the next position at the end of its booking (highest position plus one) when none is given.
- Gaps in positions are harmless (a removed item leaves a gap); the serial number is the row's place, not the stored value.
- An index on `(booking_id, position)`.
- The existing change-log trigger (`audit_row`) and the existing row-level policy `items_write` are unchanged.

## 5. The move function

`move_booking_item(p_item_id uuid, p_direction text) returns void`
- `p_direction` is `'up'` or `'down'`; anything else is refused.
- Security **invoker** (runs with the caller's own rights), so the existing `items_write` policy decides who may move items: `items.edit` while the booking is `booked`, `items.edit_after` after collection. No new permission. A person who may not edit items changes nothing (the update affects no row) and gets the plain message "You cannot change this packing list".
- Finds the item's neighbour in position order (previous for up, next for down) inside the same booking and swaps the two positions in one statement. The item's booking is locked `for update` while swapping, so two people moving at once cannot leave two items with the same position.
- First item moved up: refused with "It is already first". Last item moved down: "It is already last".
- `execute` revoked from `public, anon`, granted to `authenticated`.

## 6. Screens

- `ItemsCard` (shared by the booking page and the pickup page): title **Packing list**; rows show the serial number before the description; **up** and **down** icon buttons beside the existing edit and delete buttons, each with an accessible label (for example "Move Fridge up"), at least 44px on touch; the first row has no up button and the last row no down button. Shown only to people who may change items (the existing `canChange`).
- All four places that read the items order them by `position` (then `id` as a tie-break): the booking page, the pickup page, the receipt page, and the warehouse split page.
- Pickup receipt (`/pickups/[id]/receipt`): a first column **#** with the serial number, rows in position order.
- Warehouse split page: same order, no number column.
- After a move the list reloads and shows the new order; errors are shown with the standard error message.

## 7. Sample-data layer

`src/lib/mock-supabase.ts` mirrors the column (seed items get positions, new items go to the end), the function with the same messages, and the same ordering. Its storage key is bumped.

## 8. Testing

- Real-database tests (always rolled back): backfill order for existing items; a new item goes to the end; move up and move down swap with the neighbour; the first cannot go up and the last cannot go down (exact messages); a bad direction is refused; a person without the items permissions is refused, and a person with `items.edit` can move items on a booked booking but not on a collected one, while `items.edit_after` can; other items of the booking and of other bookings are untouched; two moves in a row give the expected order.
- Sample-data tests mirroring the same behavior.
- Source checks: the card title, the number, the buttons, the ordering in the four places, and the receipt's # column.
- A browser check of the Packing list on the booking page, the pickup page and the printed receipt.

## 9. Build stages

1. Database: column, backfill, insert trigger, `move_booking_item`, real-database tests. Applied live only after the owner says "apply" and after a backup (the change is additive).
2. Sample-data mirror and tests.
3. Screens: Packing list card, ordering in the four places, receipt # column.

The database change goes live before the screens that need it.

## 10. Not included, on purpose

- Drag and drop, moving to a chosen position, sorting by weight or name.
- A number column on the warehouse split page.
- Any change to parcels (the warehouse parcels are a separate list).

## 11. Risks and notes

- Reordering is written to the Activity log like any item change (it is an update of the item). A move changes two items, so it adds two entries; this is accepted rather than hiding it.
- Existing bookings keep today's visible order; the order was accidental, but it is what people have seen.
