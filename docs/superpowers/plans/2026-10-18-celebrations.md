# Celebrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a short firework or confetti celebration, with a friendly message, when a booking is created, a pickup is collected, an intake is received, or an invoice is raised; managers choose on/off and the style, and anyone can turn it off on their device.

**Architecture:** One data row in `app_settings` (key `celebrations`) written only through a checked function; pure helpers in `src/lib/celebrations.ts` (settings, style choice, particle spawning, messages); a tiny event bus `celebrate()`; one `CelebrationHost` in the app shell that draws a single canvas and a message banner; four call sites that call `celebrate()` after a successful save.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase (Postgres, RLS, SECURITY DEFINER functions), node:test, plain canvas (no libraries).

**Spec:** `docs/superpowers/specs/2026-10-18-celebrations-design.md`. The five sample styles are in `docs/design/firework-styles.html` (the canvas code to port).

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md).
- Migration is `0064_celebrations.sql`; functions are `security definer set search_path = public`, `execute` granted to `authenticated` and revoked from `public, anon`.
- Settings key `celebrations`, value `{ "enabled": bool, "style": "salvo"|"confetti"|"classic"|"rings"|"willow", "events": { "booking_created": bool, "pickup_collected": bool, "intake_received": bool, "invoice_raised": bool } }`; default enabled, style `salvo`, all four events on.
- Mock storage key bumps from `logistics-mock-db-v40` to `logistics-mock-db-v41`.
- Celebration code may never throw into the caller: every call site and every browser API (canvas, `localStorage`, `navigator`) is wrapped so a failure is ignored.
- Canvas: `pointer-events-none`, `aria-hidden`, named layer `z-(--z-toast)` (no raw z-index numbers), device pixel ratio capped at 2, loop stops when no dots remain, no loop while the tab is hidden, reduced motion means no animation (message banner only).
- Every list heading is sortable; touch targets 44px; hint paragraphs 14px (`text-sm`).
- The DB tests apply the migration inside each rolled-back transaction until it is live (pattern from 0062/0063: `const withCelebrations = (db) => db.owner(readFileSync(MIGRATION, "utf8"))`, removed after the owner applies the migration).
- Commit as `ibnhabib <shoaib.amir@hotmail.com>`; no Claude co-author trailer; never push, deploy or apply the migration without the owner's explicit word. Work on branch `celebrations`.
- Copy: sentence case, no "successfully", no "please".

## Review Focus

1. A failed save must never celebrate (no celebration on an error path or a conflict).
2. The invoice event fires only the first time an amount is saved (empty or zero before, above zero after), not on every edit and not when the amount is cleared or lowered.
3. Reduced motion and the device opt-out show no animation and leave no canvas behind.
4. The animation loop really stops: no canvas remains after it ends, after the tab is hidden, or after the component unmounts.
5. A missing or damaged setting falls back to the defaults and never throws; a celebration problem never stops a save.

---

### Task 1: Setting row and checked save function

**Files:**
- Create: `supabase/migrations/0064_celebrations.sql`
- Test: `db-tests/rules.test.mts` (append)

**Interfaces:**
- Produces the default `app_settings` row `('celebrations', '{"enabled": true, "style": "salvo", "events": {"booking_created": true, "pickup_collected": true, "intake_received": true, "invoice_raised": true}}'::jsonb, 'Celebrations', 'Fireworks when good work is done. Change them on the Celebrations card.')` (`on conflict (key) do nothing`).
- Produces `save_celebrations(p_enabled boolean, p_style text, p_events jsonb) returns void`: needs `settings.manage`; style must be one of `salvo, confetti, classic, rings, willow` else "Choose a style from the list"; `p_events` must be a JSON object with exactly the four keys `booking_created, pickup_collected, intake_received, invoice_raised`, each a boolean, else "Each celebration needs an on or off choice"; `p_enabled` null is refused ("Choose on or off"); writes the value and `updated_at = now()`.
- Consumes: the existing `app_settings` table and `require_perm`.

- [ ] **Step 1: Write failing db tests** (names start `celebrations:`): (a) the default row exists with style `salvo` and all four events true; (b) a staff person cannot call `save_celebrations`, a person with `settings.manage` can and the row changes; (c) refused with the exact messages for an unknown style, a missing event key, an extra key, a non-boolean event, a null `p_enabled`; (d) the generic Settings switch list is not polluted: the row's value is an object (assert `jsonb_typeof(value) = 'object'`).
- [ ] **Step 2: Run** `node --no-warnings --experimental-transform-types --test --test-name-pattern="celebrations" db-tests/rules.test.mts`. Expected: FAIL (migration file missing).
- [ ] **Step 3: Write the migration** (header comment in the style of 0063; idempotent).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add supabase/migrations/0064_celebrations.sql db-tests/rules.test.mts && git commit -m "Celebrations: setting row and checked save function"`.

### Task 2: Pure helpers, mock backend and event bus

**Files:**
- Create: `src/lib/celebrations.ts`, `src/lib/celebrate.ts`
- Modify: `src/lib/mock-supabase.ts` (seed row, `save_celebrations` RPC, key `v41`)
- Test: `tests/celebrations.test.mts`

**Interfaces:**
- Produces in `src/lib/celebrations.ts` (relative imports only, no `@/` alias): `type CelebrationEvent = "booking_created" | "pickup_collected" | "intake_received" | "invoice_raised"`; `type StyleKey = "salvo" | "confetti" | "classic" | "rings" | "willow"`; `type Celebrations = { enabled: boolean; style: StyleKey; events: Record<CelebrationEvent, boolean> }`; `DEFAULT_CELEBRATIONS`; `normalizeCelebrations(raw: unknown): Celebrations` (any missing or wrong part falls back to the default for that part, never throws); `STYLES: { key: StyleKey; label: string; description: string; cost: number }[]` (labels "Triple salvo" 210, "Confetti pop" 70, "Classic burst" 110, "Double ring" 96, "Golden willow" 90, descriptions copied from the sample page); `shouldCelebrate(s: Celebrations, event: CelebrationEvent, deviceOff: boolean): boolean`; `chooseStyle(style: StyleKey, light: boolean): StyleKey` (a light device gets `confetti` for any style with cost above 100); `isLightDevice(n: { hardwareConcurrency?: number; deviceMemory?: number; connection?: { saveData?: boolean } }): boolean` (4 or fewer cores, 2 GB or less, or data saver); `type Dot = { x: number; y: number; vx: number; vy: number; drag: number; g: number; life: number; fade: number; r: number; c: string; rect?: boolean; rot?: number; vr?: number; delay: number }`; `spawn(style: StyleKey, width: number, height: number, random: () => number): Dot[]` (returns exactly the style's `cost` dots; port the five generators from `docs/design/firework-styles.html`, salvo dots carry delays 0, 450 and 900 ms for the three rockets); `COOLDOWN_MS = 4000`, `DURATION_MS = 2500`; `messageFor(event: CelebrationEvent, detail?: string): string` ("Booking BK-1234 created. Nice work!" with a detail code, "Booking created. Nice work!" without; "Pickup collected. Great job!"; "Intake received. Well done!"; "Invoice raised. Nice one!").
- Produces in `src/lib/celebrate.ts`: `celebrate(event: CelebrationEvent, detail?: string): void` (never throws) and `onCelebrate(handler: (event: CelebrationEvent, detail?: string) => void): () => void` (returns an unsubscribe function).
- Produces in the mock: the seeded `celebrations` row and `save_celebrations` with the same rules and messages as Task 1.

- [ ] **Step 1: Write failing tests** in `tests/celebrations.test.mts`: `normalizeCelebrations` (null, a string, a wrong style, a non-boolean event, a partial object, a good object, extra keys ignored); `shouldCelebrate` (disabled master, disabled event, device off, all on); `chooseStyle` (salvo on a light device becomes confetti, confetti stays, classic at 110 becomes confetti on a light device, willow at 90 stays); `isLightDevice` (each rule and a strong device); `spawn` returns exactly `cost` dots for each style, all numbers finite, salvo delays are exactly 0/450/900 in groups of 70, same seed gives the same dots; `messageFor` for all four events and the detail variant; `celebrate`/`onCelebrate` (handler receives the event, unsubscribe stops it, a handler that throws does not stop another handler or the caller); mock tests mirroring Task 1 (default row, a staff-role person refused, valid save, each refusal message).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the two library files and the mock changes.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`. Expected: all pass and clean.
- [ ] **Step 5: Commit** `git commit -am "Celebrations: helpers, event bus and mock backend"`.

### Task 3: The host, the canvas and the device switch

**Files:**
- Create: `src/components/celebrations/CelebrationHost.tsx`, `src/components/celebrations/DeviceToggle.tsx`
- Modify: `src/components/layout/AppShell.tsx` (mount the host), `src/app/account/page.tsx` (show the toggle)
- Test: `tests/celebrations-screens.test.mts`

**Interfaces:**
- Consumes: Task 2's helpers and bus.
- Produces `CelebrationHost()`: loads `app_settings` row `celebrations` once (`supabase.from("app_settings").select("value").eq("key", "celebrations").maybeSingle()`, normalised, defaults on any problem); subscribes with `onCelebrate`; for each event: ignore unless `shouldCelebrate`; show the message banner (`role="status"`, `aria-live="polite"`, on `z-(--z-toast)`, bottom of the screen above the phone menu, 3 seconds, a 44px Close button); play the animation only if reduced motion is off, the tab is visible, and the last animation ended more than `COOLDOWN_MS` ago; the animation uses one full-screen canvas (`pointer-events-none`, `aria-hidden`, pixel ratio capped at 2), the style from `chooseStyle(settings.style, isLightDevice(navigator))`, dots from `spawn`, a `requestAnimationFrame` loop that fades with the same drawing rules as the sample page (translucent fill for trails, round dots, rotated rectangles for paper), cancels on `visibilitychange` hidden and on unmount, and removes the canvas after `DURATION_MS` or when no dots remain. Every browser call is inside try/catch.
- Produces `DeviceToggle()`: a labelled tick box "Celebrations on this device" stored in `localStorage` under `celebrations-off` (inverted: unticked writes `1`), read and written inside try/catch; the host reads the same key before each celebration.

- [ ] **Step 1: Write failing screen tests:** `CelebrationHost` exists and is mounted in `AppShell`; the host source has `pointer-events-none`, `aria-hidden`, `z-(--z-toast)`, `cancelAnimationFrame`, `visibilitychange`, `prefers-reduced-motion`, `COOLDOWN_MS`, `isLightDevice`, `chooseStyle` and no raw `z-` number; the account page renders `DeviceToggle`; `DeviceToggle` wraps `localStorage` in `try {`; the Close button carries `min-h-11`; hints are 14px.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build** the host and the toggle (port the drawing from `docs/design/firework-styles.html`).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; on the sample-data dev server (`NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3001`) call `celebrate` from the browser console through a temporary global in the dev page only if needed, and look at the animation. Expected: clean, the animation plays and ends, no canvas remains.
- [ ] **Step 5: Commit** `git commit -am "Celebrations: host, canvas and the device switch"`.

### Task 4: The manager settings card

**Files:**
- Create: `src/components/settings/CelebrationsCard.tsx`
- Modify: `src/app/settings/page.tsx`
- Test: `tests/celebrations-screens.test.mts` (append)

**Interfaces:**
- Consumes: `STYLES`, `normalizeCelebrations`, `spawn`, `chooseStyle` from Task 2, `save_celebrations`.
- Produces `CelebrationsCard()`: shown to people with `settings.manage`; a master switch, a radio list of the five styles (label, description, cost note, a Preview button per style that plays the celebration through the host by calling `celebrate`-style preview: use a second bus function `previewCelebration(style: StyleKey)` exported from `src/lib/celebrate.ts` and handled by the host, ignoring the cooldown and the enabled switches), a switch for each of the four events, a Save button calling `save_celebrations`, "Saved" confirmation, and the database's plain error text. Hint text is 14px. It reads the current value with the same query as the host.

- [ ] **Step 1: Write failing tests:** the card exists, calls `save_celebrations`, lists all five style keys from `STYLES`, has a Preview button per style with `min-h-11`; the Settings page includes `CelebrationsCard` behind `can("settings.manage")`; `previewCelebration` exists and the host handles it.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Build** the card, the preview function and the host handler.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; on the dev server change the style, preview each, save, reload and see the saved choice. Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Celebrations: manager settings card with previews"`.

### Task 5: The four call sites

**Files:**
- Modify: `src/components/bookings/BookingForm.tsx`, `src/app/pickups/[id]/page.tsx`, `src/app/warehouse-inventory/split/[bookingId]/page.tsx`
- Test: `tests/celebrations-screens.test.mts` (append)

**Interfaces:**
- Consumes: `celebrate(event, detail)` from `src/lib/celebrate.ts`.
- Produces: `BookingForm`: after a new booking saves and the customer links are made, `celebrate("booking_created", data.code)` before `onSaved(data.code)`; after an edit saves, `celebrate("invoice_raised")` only when the booking's previous `invoice_amount` was empty or 0 and the saved `fields.invoice_amount` is above 0. Pickup page: `run` returns `true` when the write succeeded; `markCollected` calls `celebrate("pickup_collected")` only when it returned `true`. Split page: after a successful `split_booking` call, `celebrate("intake_received")` only when the booking had no received parcels before the save (the `received` flag was false), so replacing already received parcels does not celebrate.

- [ ] **Step 1: Write failing tests** (source checks, in the style of the existing screen tests): each of the three files imports `celebrate`; BookingForm calls `celebrate("booking_created"` after the error return and before `onSaved`, and `celebrate("invoice_raised")` behind a condition that mentions `invoice_amount` and `> 0`; the pickup page's `run` returns a boolean and `celebrate("pickup_collected")` is behind it; the split page calls `celebrate("intake_received")` after the error check and behind `!received`. Add one pure helper `invoiceJustRaised(previous: number | null | undefined, next: number | null | undefined): boolean` to `src/lib/celebrations.ts` with unit tests (null to 100 true, 0 to 100 true, 100 to 200 false, 100 to null false, null to null false, null to 0 false, undefined to 50 true) and have BookingForm use it.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper and the three call sites.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npx eslint src tests`; on the dev server create a booking, collect a pickup, receive an intake, and add an invoice amount, and watch each celebrate once (and a plain edit not celebrate). Expected: clean.
- [ ] **Step 5: Commit** `git commit -am "Celebrations: celebrate booking, pickup, intake and invoice"`.

### Task 6: Go-live checks (stops for the owner)

**Files:** none new.

- [ ] **Step 1:** Run `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx eslint src tests`, and `npm run build` (with the three Supabase variables empty). Expected: all clean.
- [ ] **Step 2:** Final whole-branch review by a fresh most-capable reviewer; one fix pass with a failing test first for each finding; delete the plan workspace.
- [ ] **Step 3:** Stop and tell the owner: committed on `celebrations`, not live; migration 0064 changes the live database immediately and only adds one setting row and one function, so the running app keeps working. Wait for "apply", then `npm run db:backup`, `npm run db:migrate`, remove the temporary migration-reading lines from the db tests, `npm run test:db`; only after "push to preview" push the branch, and "merge" to put it on `main`.
