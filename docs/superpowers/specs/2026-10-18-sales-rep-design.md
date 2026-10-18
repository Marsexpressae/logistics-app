# Sales rep (customer owner): design

Date: 2026-10-18
Status: written, waiting for the owner's review. Nothing is built yet.

## 1. Purpose

The office staff who bring in business generate the revenue, but the app does not record who they are. The Bookings list shows the assigned **driver** instead, which is a pickup detail. The owner wants every screen to show who owns a customer, so anyone can see who to ask about an account.

## 2. Decisions already made with the owner

1. The name is **Sales rep**. A customer's **owner** and the **sales rep** are the same person.
2. Anyone who is active staff of the app can be a sales rep (all roles).
3. The owner is kept on the **customer**. Every **booking** also carries the rep who made that sale.
4. A new booking preselects the picked customer's owner; for a new customer the person creating the booking is preselected and becomes the customer's owner. It can be changed on the form.
5. Existing customers and bookings are left blank (shown as "—"). Nothing is guessed.
6. A new permission, **"Change the sales rep (owner)"**, goes to Manager and Super admin. It covers both the customer and a booking. The owner can give it to other roles on the Roles page. The database enforces it.
7. Changing a customer's owner does **not** rewrite that customer's old bookings: each booking keeps the rep who made that sale. New bookings take the new owner.
8. The sales rep is shown "all over" (section 6), but not on printed receipts or other customer-facing pages.
9. The assigned driver stays on the booking, on the pickup pages and on the booking form. Only the Bookings list column changes.
10. Not included: sales reports, commission totals, filtering lists by rep.

## 3. Words used here

- **Sales rep**: the staff member who owns a customer or made a booking.
- **Owner**: the sales rep of a customer.

## 4. Data

- `customers.sales_rep_id uuid references profiles(id) on delete set null` and `customers.sales_rep_name text`.
- `bookings.sales_rep_id uuid references profiles(id) on delete set null` and `bookings.sales_rep_name text`.
- Indexes on both `sales_rep_id` columns.
- The name is copied from `profiles.full_name` by a `before insert or update of sales_rep_id` trigger (security definer, `search_path = public`), so an old record keeps the right name if the person is renamed or removed. Setting the id to null clears the name.
- The id must belong to an **active** profile, otherwise the change is refused with "That person is not active staff".
- Existing rows stay null. The existing change-log triggers (`audit_row`) record every change.

## 5. Rules in the database

- **Who may set it:**
  - On **insert** (a booking created, a customer created) anyone who may create the row may set the rep. No extra permission.
  - On **update** of `sales_rep_id` (on `customers` or `bookings`) the caller needs the new permission `sales_rep.change`, otherwise the change is refused with "Only managers can change the sales rep". A `before update of sales_rep_id` trigger checks it (`has_perm('sales_rep.change')`, skipped when the id does not change).
- **Permission:** `sales_rep.change`, label "Change the sales rep (owner)", group Customers, granted to `manager` and `super_admin`.
- **Choices:** `sales_rep_choices() returns jsonb` (security definer, `search_path = public`): `[{id, name}]` of active profiles ordered by name. Allowed for people with any of `bookings.create`, `customers.edit`, `sales_rep.change`; others get the standard permission error. `execute` revoked from `public, anon`, granted to `authenticated`.
- **New customers get an owner:**
  - The trigger that creates a customer from a new booking (`booking_ensure_customer`, migration 0044) and `create_customer_from_booking` copy the booking's `sales_rep_id` into the new customer's owner.
  - `create_customer` (a customer added by hand) sets the owner to the signed-in person.
  - A customer found by phone that already exists is not changed.
- **Lists that come from database functions** gain the new field:
  - `accounts_invoices` gains `r_sales_rep text` (the booking's rep).
  - `global_search` returns `sales_rep` on each booking hit and on each customer hit (the owner).
  - `search_customers` (the customers list and picker) returns the owner's name on each customer, and the customer page reads the owner from the customer row.
  - Each is replaced with the live definition changed only by the new field; signatures and grants are kept.

## 6. Screens

- **Bookings list:** the **Driver** column becomes **Sales rep** (sort key `salesrep`, sorts by name; the search also matches it; the phone card shows the rep in place of the driver).
- **New booking form:** a **Sales rep** dropdown (from `sales_rep_choices()`), with the picked customer's owner preselected, or the signed-in person for a new customer. An empty choice is allowed.
- **Booking page:** shows **Sales rep**. Without the permission it is plain text; with `sales_rep.change` it is a dropdown that saves straight away with a "Saved" note.
- **Customer page:** **Owner** line, plain text, or a dropdown for people with `sales_rep.change`.
- **Customers list and picker:** the owner's name on each row.
- **Pickups list and pickup page:** a "Sales rep" line next to the existing driver line.
- **Accounts invoice list:** a **Sales rep** column (hidden on phone cards, which show it as a small line).
- **Search results:** the rep on booking hits, the owner on customer hits.
- Not shown: printed receipts, credit notes, refund receipts, the return form, statements, and the public tracking page.
- Phones: the dropdowns are full width with the standard 44px touch size.

## 7. Sample-data layer

`src/lib/mock-supabase.ts` mirrors the columns, the name copy, the permission rule (the sample user can change it), `sales_rep_choices`, owner-on-new-customer, and the new fields in `accounts_invoices`, `global_search` and `search_customers`. Storage key bumped.

## 8. Testing

- Real-database tests (always rolled back): the name is copied and cleared; an inactive or unknown person is refused; insert needs no permission; a change on update is refused without `sales_rep.change` and works with it, for both customers and bookings; the choices list returns active staff only and is refused for people without the three permissions and for a signed-out visitor; a booking for a new customer gives the customer the same owner; a booking for an existing customer leaves the owner unchanged; a customer added by hand gets the creator as owner; changing a customer's owner leaves old bookings alone; `accounts_invoices`, `global_search` and `search_customers` carry the new fields; the permission is granted to manager and super admin only.
- Sample-data tests mirroring the same behaviour.
- Source checks for the screens, and a browser check of each place in section 6 on sample data, at desktop and phone width.

## 9. Build stages

1. Database: columns, name trigger, permission, rule, choices function, owner on new customers, the three replaced functions. Applied live only after the owner says "apply" and after a backup (additive).
2. Sample-data mirror.
3. Screens: booking form, booking page, Bookings list; then the customer pages; then pickups, Accounts, and search.

The database change goes live before the screens that need it.

## 10. Risks and notes

- The three replaced database functions are large and used everywhere. They are copied from the live definitions and changed only by the new field, and the existing tests for them must still pass.
- Because the owner is stored on both the customer and the booking, a booking can show a different rep than its customer's owner. This is on purpose (decision 7).
- A new permission means a manager does not need anything else; other roles gain nothing until the owner gives them the permission.
