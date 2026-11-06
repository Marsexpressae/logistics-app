# Return requests: telling the warehouse what to prepare

Date: 2026-11-06. Status: design for review.

## What the owner asked for

A customer asks for parcels back. Today nothing in the app tells the warehouse which parcels to prepare: someone has to phone or message. The warehouse is full of packages, so staff need a clear list of what to pick, where it is, and who asked. (Owner's question: "How will the warehouse staff know which item needs to prepare to return as the warehouse is full of packages?" Answer chosen: option 1, full return requests.)

Success looks like this:
- Sales or accounts can raise a return request on a booking in a few taps.
- Warehouse staff see a "To prepare" list with a pick list (barcode, description, weight, **position**) and get a notification when one arrives.
- One press creates the return form for exactly those parcels, and the requester is told it is ready.
- Nothing about the existing return flow (prepare, hand over, cancel, edit, delete) breaks. A person can still prepare a return without any request.

## Not in scope

Quantities inside a parcel, time slots or scheduling beyond an optional "needed by" date, a customer-facing screen, editing a request (cancel and raise a new one), a history page of requests, reminders or escalation.

## Design

### Data (migration 0067)

New table `return_requests`:

| column | meaning |
|---|---|
| `id` uuid | primary key |
| `booking_id` uuid | `references bookings on delete cascade` |
| `status` text | `open`, `prepared`, `cancelled` (default `open`) |
| `note` text | what the requester wrote, optional |
| `needed_by` date | optional: the day the customer comes |
| `parcel_ids` uuid[] | the parcels asked for; `null` means every parcel of the booking that is in the warehouse |
| `requested_by`, `requested_by_name`, `requested_at` | who asked, and when |
| `return_id` uuid | `references returns on delete set null`, set when prepared |
| `closed_at`, `closed_by_name` | when and by whom it was prepared or cancelled |

Only one open request per booking (a partial unique index on `booking_id where status = 'open'`). A person who wants to change a request cancels it and raises a new one. `parcel_ids` is a plain array on purpose (shortcut: no foreign key per parcel; the pick list always re-checks each parcel's current status).

Row security: `select` for people who hold `returns.request`, `returns.prepare` or `warehouse.view`; no insert, update or delete for browser roles (all writes go through the functions below). An `audit_row` trigger like the other tables. The table is added to the realtime publication so an open warehouse screen updates by itself.

### Permission

New `returns.request` ("Request returns", Warehouse group): raise or cancel a request. The migration grants it to every role that holds `bookings.edit` or `returns.prepare`, and to `super_admin`. Nothing is removed from anyone.

### Functions (all `security definer`, `set search_path = public`)

- **`request_return(p_booking_id uuid, p_note text, p_needed_by date, p_parcel_ids uuid[]) returns uuid`**: needs `returns.request`. The booking must exist and not be cancelled. If `p_parcel_ids` is given, every id must be a parcel of this booking that is `in_warehouse`; if it is null, the booking must have at least one `in_warehouse` parcel. Refuses a second open request ("This booking already has an open return request"). `p_needed_by` cannot be in the past (Dubai date). Inserts the request, writes a booking event `return_requested` (so it shows in the booking history), and notifies every active person with `returns.prepare` except the requester: kind `return_requested`, title "Return requested: INV-… (customer)", body = the note and the needed-by date.
- **`cancel_return_request(p_request_id uuid) returns void`**: the requester, or anyone with `returns.prepare`, may cancel an `open` request. Writes a booking event `return_request_cancelled` and notifies the warehouse people (kind `return_request_cancelled`) unless they cancelled it themselves.
- **`prepare_return(p_booking_id, p_parcel_ids, p_note)`** (existing, from migration 0019, now needing `returns.prepare` since 0065): after it creates the return form, it closes the booking's open request, if there is one: `status = 'prepared'`, `return_id`, `closed_at`, `closed_by_name`, and notifies the requester (kind `return_prepared`, "Return RT-… is ready"). This holds whether the staff member started from the request or from the stock list, so a request never stays open for a return that was already made. The rest of the function is unchanged.

All three new notification kinds use the existing `notifications` table, so the in-app toast, the Notifications page and the phone push work with no new plumbing.

### Screens

1. **Booking page**: a "Return" card (only when the person has `returns.request`):
   - No open request and the booking has parcels in the warehouse: a **Request return** button. It opens a small panel: a tick list of the parcels in the warehouse (all ticked), an optional "Needed by" date (the shared `DateField`), an optional note, and a **Send request** button.
   - An open request: who asked, when, the note, the needed-by date, and a **Cancel request** button.
   - A prepared request: "Prepared as RT-1001" linking to the return form.
2. **Warehouse, Returns tab**: a **To prepare** section above the return forms (visible with `warehouse.view`; the buttons need `returns.prepare`). One row card per open request: invoice and customer, needed-by date, note, requested by and when. Opening a row shows the **pick list**: only parcels that are still `in_warehouse`, each with barcode, description, weight and **position**. A **Prepare return** button creates the return form for those parcels (`prepare_return`) and opens it. A **Cancel request** button is also there. If no requested parcel is still in the warehouse, the row says "Nothing left to return" and offers only Cancel.
3. **Counts**: the Returns tab count and the Warehouse menu badge include open requests, so a waiting request is visible from any screen.
4. **Notifications page**: icons for the three new kinds.

Per project rules: 44 px touch targets, hint text at least 14 px, no browser pop-ups (the cancel confirmation uses the shared ask dialog), named z-layers, and the page access rules stay as they are.

### Edge cases and rulings

- A requested parcel was moved, loaded or already returned: the pick list shows only parcels still in the warehouse. Preparing uses only those.
- Booking cancelled or deleted: requests cascade with the booking. A cancelled booking cannot get a new request.
- Two people prepare at once: `prepare_return` already refuses parcels that are no longer `in_warehouse`; closing the request is idempotent.
- The requester has no `bookings.view`: they cannot see the card, which only appears on the booking page they can already open.
- A person with `returns.prepare` but no `returns.request` still sees and prepares requests; a person with `returns.request` only (office) sees and cancels their own.
- A return deleted later (`delete_return`) leaves the request as `prepared` with `return_id` set to null. History stays truthful; no reopening.

### Testing

- Sample-data backend (`mock-supabase.ts`) mirrors the table, the three functions and the notification rows, with its own tests: raise, duplicate refusal, bad parcels, past date, cancel by requester and by warehouse, prepare closes the request, notifications reach the right people.
- Real-database tests in `db-tests/rules.test.mts` (rolled back): permissions for each function, row security on the table, the one-open-request index, `prepare_return` closing the request, notifications created, cascade on booking delete. Temporarily apply the migration inside each test until "apply".
- Screen tests (source checks like the other `*-screens` tests): the Return card and the To prepare list gate on the right permissions, and the pick list shows `position`.
- A browser check on the sample-data server before preview.

## Rollout

Migration 0067 adds a table, a permission and two functions, and replaces `prepare_return` with the same body plus the request closing. The running app keeps working while the migration is live. Backup and `npm run test:db` as usual. Pushed to a preview branch first.
