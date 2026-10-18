# Celebrations: fireworks for good work

Status: design agreed in chat on 2026-10-18, waiting for written-spec review.

## Goal

Make the team feel good about the work they do. When someone finishes one of four key jobs, the screen plays a short firework (or confetti) celebration with a friendly message. Managers can turn it on or off and choose the style. Anyone can turn it off for themselves.

## Decisions from the owner

- Style: Triple salvo is the choice, as long as it is not heavy. If it is heavy, use Confetti pop. The five styles were shown and are saved in `docs/design/firework-styles.html`.
- Events that celebrate: a booking is created, a pickup is collected, an intake is received in the warehouse, an invoice is raised.
- "Invoice raised" means the invoice amount is saved on a booking that had none before (first time only). It does not fire when the invoice number is issued automatically at pickup (that already celebrates as "pickup collected").
- A setting enables or disables celebrations and lets a manager choose the style.
- Best practice for weight, accessibility and respect for people's screens applies (see "How it behaves").

## Is Triple salvo heavy?

No. It draws about 210 small dots for roughly 2.5 seconds on one canvas, then stops completely. Confetti pop draws about 70. On slow phones the app uses the lighter Confetti pop automatically, so the choice never makes the app feel slow.

## The four events

Each is a single call `celebrate(event, message)` made after the work is saved successfully (never before, never on an error):

| Event key | When | Message |
|---|---|---|
| `booking_created` | a new booking is saved from the new-booking form | "Booking BK-1234 created. Nice work!" |
| `pickup_collected` | a pickup is marked collected on the pickup page | "Pickup collected. Great job!" |
| `intake_received` | a collected booking is received into the warehouse (the split into parcels succeeds) | "Intake received. Well done!" |
| `invoice_raised` | the invoice amount is saved on a booking whose invoice amount was empty or zero, and the new amount is above zero | "Invoice raised. Nice one!" |

Not celebrated: editing a booking, opening a page, loading data, bulk changes, anything that fails.

## How it behaves

- **One shared overlay.** A single full-screen canvas created when needed. It never takes a tap or focus (`pointer-events: none`) and is hidden from screen readers (`aria-hidden`).
- **Short and then silent.** The animation plays about 2.5 seconds, then the animation loop stops and the canvas is removed, so nothing runs in the background.
- **No pile-ups.** Only one celebration plays at a time, with a cooldown of 4 seconds. A second event during the cooldown plays only the message, not the animation.
- **Light on devices.** The canvas resolution is capped at 2x. The loop does not start when the tab is hidden and is cancelled if the tab becomes hidden. On slow devices (4 or fewer processor cores, or 2 GB of memory or less, or the browser's data-saver on) any style that draws more than 100 dots is replaced by Confetti pop.
- **Reduced motion.** When the device asks for reduced motion there is no animation at all. The message still shows as a small calm banner.
- **Message.** A short banner (bottom of the screen above the phone menu, on the named toast layer) shows the message for 3 seconds, `aria-live="polite"`, with a 44px Close button. It does not cover buttons for longer than that.
- **Never blocks work.** Any error inside the celebration code is caught and ignored. A celebration problem can never stop a booking, a collection, an intake or an invoice from saving.

## Settings

Managers (permission `settings.manage`) get a **Celebrations** card in Settings:

- A switch: "Celebrate good work" (on by default).
- A style choice (radio list with a Preview button for each): Triple salvo (default), Confetti pop, Classic burst, Double ring, Golden willow.
- A switch for each of the four events (all on by default).
- Saved with a "Saved" confirmation.

Everyone gets, on My profile, a tick box: "Celebrations on this device" (on by default). It is stored in the browser only (wrapped in try/catch) and switches the animation and the banner off for that person on that device.

### Data

One row in the existing `app_settings` table with key `celebrations` and a JSON value: `{ "enabled": true, "style": "salvo", "events": { "booking_created": true, "pickup_collected": true, "intake_received": true, "invoice_raised": true } }`. Style keys: `salvo`, `confetti`, `classic`, `rings`, `willow`.

Migration `0064_celebrations.sql` (adds data only):

- Inserts the default row (`on conflict do nothing`).
- Adds `save_celebrations(p_enabled boolean, p_style text, p_events jsonb) returns void`, which needs `settings.manage`, checks the style is one of the five, requires all four event keys to be booleans, and writes the row. The Settings card saves through this function so a bad value can never be stored.
- The generic on/off list on the Settings page already ignores non-boolean rows, so this row does not appear there.

The app reads the row once for the whole signed-in app (like the menu switches) and treats a missing or damaged value as the defaults.

## Code

- `src/lib/celebrations.ts`: pure helpers with no browser code, so node can test them: `normalizeCelebrations(raw)`, `shouldCelebrate(settings, event, deviceOff)`, `chooseStyle(style, light)`, `STYLES` (key, label, description, dot cost), `spawn(style, width, height, random)` returning the particles to draw, and the message table.
- `src/lib/celebrate.ts`: `celebrate(event, message)`, a tiny event bus any screen can call.
- `src/components/celebrations/CelebrationHost.tsx`: mounted once in AppShell. Reads the setting, listens for events, applies the rules above, draws the canvas and shows the banner.
- `src/components/settings/CelebrationsCard.tsx`: the manager settings card, with previews.
- `src/components/celebrations/DeviceToggle.tsx`: the tick box on My profile.
- Four call sites: the new-booking form, the pickup page, the split page, and the booking edit form.

## Safety and testing

- All new database functions are `security definer set search_path = public`, granted to `authenticated`, revoked from `public, anon`.
- Database tests (rolled back): staff cannot change the setting; a manager can; a bad style or a non-boolean event is refused; the default row exists.
- The sample-data backend mirrors the function and has a matching test.
- Unit tests for the pure helpers: settings normalising, event on/off, style fallback on light devices, particle counts for every style within their cost, message table.
- Screen tests: the host is mounted in AppShell; the four call sites call `celebrate` after success; the canvas is `pointer-events-none` and `aria-hidden`; no raw z-index numbers; 14px hints; 44px targets; the settings card uses the shared form pieces.

## Review focus

- A failed save must never celebrate (no celebration on an error).
- The invoice event fires only the first time an amount is saved, not on every edit and not when the amount is cleared.
- Reduced motion and the device opt-out show no animation and no leftover canvas.
- The animation loop really stops, and no canvas remains after it ends or after the tab is hidden.
- A damaged or missing setting falls back to defaults and never throws.

## Open items

- The message wording is a proposal; the owner can change it after seeing it.
- Sound is not included (staff may be in shared spaces).
