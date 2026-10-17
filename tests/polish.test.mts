// A batch of small polish changes, checked as source (the screens cannot run in node):
// saved message on the collected date, rename prefill, past-reschedule hint, Problems badge, named layers, readable hints.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(f, "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });

test("changing the collected date shows a saved message", () => {
  const code = read("src/components/bookings/CollectedDate.tsx");
  assert.ok(code.includes('role="status"') && code.includes("Collected date changed to"));
});

test("the container Rename box starts with the current number", () => {
  assert.match(read("src/lib/ask.ts"), /defaultValue\?: string/);
  assert.ok(read("src/components/ui/AskHost.tsx").includes("defaultValue"));
  assert.match(read("src/app/containers/[id]/page.tsx"), /defaultValue: c!\.code/);
});

test("picking a past day in Reschedule shows a hint", () => {
  const code = read("src/components/bookings/BookingChangePanel.tsx");
  assert.ok(code.includes("That day has already passed") && code.includes("todayISO()"));
});

test("the Settings menu item shows the number of reported problems, for people who can change settings", () => {
  const code = read("src/lib/badges.tsx");
  assert.ok(code.includes('"client_errors"') && code.includes('"/settings"') && code.includes('"settings.manage"'));
});

test("layer order lives in one place: named values, no raw z-index numbers", () => {
  const css = read("src/app/globals.css");
  for (const name of ["--z-raised", "--z-menu", "--z-overlay", "--z-toast"]) assert.ok(css.includes(name), `${name} is defined`);
  const raw = walk("src").filter((f) => /\.tsx$/.test(f) && /\bz-(10|40|50)\b|\bz-\[60\]/.test(read(f)));
  assert.deepEqual(raw, [], "raw z-index numbers left");
});

test("hint lines on screens are 14px, while printed documents keep their small print", () => {
  const documents = ["pickups/[id]/receipt", "credit-notes", "refunds", "customers/[id]/statement", "warehouse-inventory/returns/[id]"];
  const offenders = walk("src").filter((f) => {
    const p = f.replaceAll("\\", "/");
    if (documents.some((d) => p.includes(d))) return false;
    return /<p\s[^>]*\btext-xs\b[^>]*text-slate-[56]00/.test(read(f)) || /<p\s[^>]*text-slate-[56]00[^>]*\btext-xs\b/.test(read(f));
  });
  assert.deepEqual(offenders, [], "12px hint paragraphs left");
});

test("the Bookings list opens on Booked only", () => {
  const code = read("src/app/bookings/page.tsx");
  assert.ok(code.includes('params.get("status") ?? "booked"'));
  assert.ok(code.includes('{ value: "booked"'));
  assert.ok(!/useState\(STATUS_FILTERS\.some\(\(f\) => f\.value === initial\) \? initial : "all"\)/.test(code), "an unknown status in the address no longer falls back to all");
});

test("the Bookings list is ordered by booking number, highest first, until a column is chosen", () => {
  const code = read("src/app/bookings/page.tsx");
  assert.match(code, /code: \{ key: "code", label: "Code", kind: "number"/);
  assert.ok(code.includes('sortRows(filtered, COLUMNS.code, "desc")'));
});
