// Moving items up and down in a packing list writes "position" changes to the change log. They are bookkeeping, not news,
// so the Activity screens leave them out (they stay in the database).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPositionMove, withoutNoise } from "../src/lib/audit-noise.ts";

const entry = (over: Record<string, unknown>) => ({ id: 1, table_name: "booking_items", row_id: "r", booking_id: "b", action: "update", actor_name: "x", changed_at: "2026-10-18T10:00:00Z", changes: { position: { old: 2, new: 1 } }, ...over }) as never;

test("a change that only moves an item is noise", () => {
  assert.equal(isPositionMove(entry({})), true);
  assert.equal(isPositionMove(entry({ changes: { position: { old: 2, new: 1 }, updated_at: { old: "a", new: "b" } } })), true);
});

test("everything else is kept", () => {
  assert.equal(isPositionMove(entry({ changes: { position: { old: 2, new: 1 }, weight_kg: { old: 5, new: 6 } } })), false, "a move together with a real change");
  assert.equal(isPositionMove(entry({ changes: { weight_kg: { old: 5, new: 6 } } })), false);
  assert.equal(isPositionMove(entry({ action: "insert", changes: { position: 3, description: "Box" } })), false, "adding an item");
  assert.equal(isPositionMove(entry({ action: "delete" })), false);
  assert.equal(isPositionMove(entry({ table_name: "parcels" })), false, "only items");
});

test("withoutNoise drops the moves and keeps the order of the rest", () => {
  const a = entry({ id: 1, changes: { description: { old: "a", new: "b" } } });
  const move = entry({ id: 2 });
  const b = entry({ id: 3, table_name: "payments", changes: { amount: { old: 1, new: 2 } } });
  assert.deepEqual(withoutNoise([a, move, b]).map((e) => e.id), [1, 3]);
});

test("both Activity screens use it", () => {
  assert.ok(readFileSync("src/app/activity/page.tsx", "utf8").includes("withoutNoise("));
  const page = readFileSync("src/app/bookings/[id]/page.tsx", "utf8");
  assert.ok(page.includes("withoutNoise(") && page.includes("historyShown"));
});
