// The shared date helpers, and a guard so every real-day box keeps using the one DateField.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dateArg, dateStamp, todayISO } from "../src/lib/format.ts";

test("today means 'now' to the database, any other day is sent as that day", () => {
  assert.equal(dateArg(todayISO()), null);
  assert.equal(dateArg(""), null);
  assert.equal(dateArg("2025-12-27"), "2025-12-27");
});

test("a picked day is saved as noon on that day, and today as the current moment", () => {
  const old = new Date(dateStamp("2025-12-27"));
  assert.equal(old.getHours(), 12);
  assert.equal(old.getDate(), 27);
  assert.ok(Math.abs(new Date(dateStamp(todayISO())).getTime() - Date.now()) < 5000);
});

// A real-day box (collected, paid, received, loaded ...) must be the shared DateField. Only these files may use a raw date input:
// DateField itself, the pickup date on the booking form (PickupSection), the reschedule panel, the return form and the delivery date row.
const ALLOWED = ["DateField.tsx", "PickupSection.tsx", "BookingChangePanel.tsx", join("returns", "[id]", "page.tsx"), join("containers", "[id]", "page.tsx")];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}
test("raw date inputs only appear where they are meant to", () => {
  const offenders = files("src").filter((f) => readFileSync(f, "utf8").includes('type="date"') && !ALLOWED.some((a) => f.endsWith(a)));
  assert.deepEqual(offenders, []);
});

// The menu switches are loaded once by AppShell. The two navs only read them, so the menu never costs extra requests.
test("the Sidebar and the BottomNav do not fetch the menu switches themselves", () => {
  for (const f of ["src/components/layout/Sidebar.tsx", "src/components/layout/BottomNav.tsx"]) {
    assert.equal(readFileSync(f, "utf8").includes("app_settings"), false, f);
  }
});
