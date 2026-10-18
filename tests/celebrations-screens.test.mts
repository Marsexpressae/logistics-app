// The celebration screens follow the project rules and the safety rules of the spec (read from the source, like rewards-screens.test.mts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const host = () => readFileSync("src/components/celebrations/CelebrationHost.tsx", "utf8");

test("the celebration host is mounted once in the app shell", () => {
  assert.ok(readFileSync("src/components/layout/AppShell.tsx", "utf8").includes("CelebrationHost"));
});

test("the host draws one canvas that never takes a tap, stops its loop, respects the device, and never throws into the caller", () => {
  const code = host();
  for (const needle of ["pointer-events-none", "aria-hidden", "z-(--z-toast)", "cancelAnimationFrame", "visibilitychange", "prefers-reduced-motion", "COOLDOWN_MS", "DURATION_MS", "isLightDevice", "chooseStyle", "shouldCelebrate", "onCelebrate", "onPreview", "Math.min(window.devicePixelRatio"]) {
    assert.ok(code.includes(needle), `the host should use ${needle}`);
  }
  assert.equal(/\bz-\d/.test(code), false, "no raw z-index number");
  assert.equal(/gradient/.test(code), false);
  assert.match(code, /try \{/);
  assert.match(code, /role="status"/);
  assert.match(code, /aria-live="polite"/);
  assert.match(code, /min-h-11/, "the Close button is 44px");
});

test("the device switch is on My profile and keeps its choice in browser storage safely", () => {
  assert.ok(readFileSync("src/app/account/page.tsx", "utf8").includes("DeviceToggle"));
  const toggle = readFileSync("src/components/celebrations/DeviceToggle.tsx", "utf8");
  assert.match(toggle, /try \{/);
  assert.ok(toggle.includes("localStorage") && toggle.includes("celebrations-off"));
  assert.ok(host().includes("celebrations-off"), "the host reads the same key");
  assert.match(toggle, /Celebrations on this device/);
});

// ---- the manager settings card ----
test("managers choose on/off, the style (with a preview of each) and the events on the Celebrations card, and the host picks up a saved change", () => {
  const card = readFileSync("src/components/settings/CelebrationsCard.tsx", "utf8");
  for (const needle of ["save_celebrations", "STYLES", "previewCelebration", "EVENT_KEYS", "CELEBRATIONS_CHANGED", "normalizeCelebrations"]) assert.ok(card.includes(needle), `the card should use ${needle}`);
  assert.match(card, /Preview/);
  assert.match(card, /Saved/);
  assert.equal(/\bz-\d/.test(card), false);
  for (const m of card.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /min-h-11/, "raw buttons need 44px");
  const page = readFileSync("src/app/settings/page.tsx", "utf8");
  assert.ok(page.includes("CelebrationsCard"));
  assert.match(page, /can\("settings\.manage"\)/);
  assert.ok(host().includes("CELEBRATIONS_CHANGED"), "the host reloads the setting after a save");
});

// ---- the four call sites ----
test("each job celebrates only after it saved: booking created and invoice raised, pickup collected, intake received", () => {
  const form = readFileSync("src/components/bookings/BookingForm.tsx", "utf8");
  assert.ok(form.includes('celebrate("booking_created"') && form.includes("invoiceJustRaised("));
  const errorAt = form.indexOf("return setError(error.message);");
  const celebrateAt = form.indexOf('celebrate("booking_created"');
  const savedAt = form.indexOf("onSaved(data.code)");
  assert.ok(errorAt > 0 && errorAt < celebrateAt && celebrateAt < savedAt, "the celebration comes after the error returns and before the form closes");
  assert.match(form, /celebrate\("invoice_raised"\)/);

  const pickup = readFileSync("src/app/pickups/[id]/page.tsx", "utf8");
  assert.match(pickup, /return !error;/, "run reports whether the write worked");
  assert.match(pickup, /if \(await run\([^]*?\)\) celebrate\("pickup_collected"\)/);

  const split = readFileSync("src/app/warehouse-inventory/split/[bookingId]/page.tsx", "utf8");
  const splitError = split.indexOf("if (error) return setError(error.message);");
  const splitCelebrate = split.indexOf('celebrate("intake_received")');
  assert.ok(splitError > 0 && splitError < splitCelebrate, "intake celebrates after the save worked");
  assert.match(split, /if \(!received\) celebrate\("intake_received"\)/, "replacing parcels already received is not a new intake");
  for (const f of [form, pickup, split]) assert.ok(f.includes('from "@/lib/celebrate"'));
});
