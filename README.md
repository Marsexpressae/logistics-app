# Mars Express

Cargo logistics app for Mars Express, handling personal cargo: bookings, pickups by area, warehouse parcel splitting, container manifests, accounts, and public tracking.

**Stack:** Next.js (App Router) · Tailwind CSS · Supabase (Postgres, Auth, RLS) · Lucide icons

## Features

- **Bookings:** sender/receiver, pickup area (Dubai, Abu Dhabi, Sharjah, Ajman), assigned driver, estimated bill, auto codes like `BK-1001`
- **Pickups:** mobile-friendly, by area; drivers record items/weights and payments, then print a receipt
- **Warehouse:** receive at Warehouse A/B, split one package into parcels with barcodes (`BK-1001-P1`, `-P2`), print labels
- **Containers:** load by scanning/typing a barcode or picking from the warehouse list; depart, arrive, deliver
- **Public tracking:** `/track/BK-1001`, no login, no personal data exposed
- **Users & roles:** admin, office staff, driver, warehouse worker, enforced by database row-level security

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase values
npm run db:migrate           # apply supabase/migrations (needs SUPABASE_DB_URL)
npm run dev                  # http://localhost:3000
```

With no Supabase keys set, the app runs against an in-browser mock with sample data.

## Environment variables

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public (publishable/anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Lets admins add users from the Users page |
| `SUPABASE_DB_URL` | Only for `npm run db:migrate` |

Never commit `.env.local`. The service-role key bypasses all security and must stay server-side.

## Database

Schema changes are versioned SQL files in `supabase/migrations/`, applied in order by `npm run db:migrate`.

## Roles

| Role | Access |
|---|---|
| Admin | Everything, plus user management |
| Office staff | Bookings, pickups, accounts. View-only warehouse and containers |
| Driver | Own pickups only |
| Warehouse worker | Parcels and containers. No payments |

After creating the first Supabase Auth user, make it an admin by inserting a row in `profiles` (`role = 'admin'`). Further users are added from the app.
