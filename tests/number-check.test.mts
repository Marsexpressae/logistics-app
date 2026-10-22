// The live "already used" note under the booking and invoice number boxes: its wording and its states.
import test from "node:test";
import assert from "node:assert/strict";
import { checkState, takenMessage } from "../src/lib/number-check.ts";

const by = { id: "b1", code: "BK-748", status: "at_warehouse" };

test("takenMessage: says what the number belongs to and what to do", () => {
  assert.equal(takenMessage("booking", "BK-748", by), "BK-748 is already used by another booking (At warehouse). Choose another number.");
  assert.equal(takenMessage("invoice", "INV-3603", by), "Invoice INV-3603 is already used by booking BK-748 (At warehouse). Choose another number.");
  assert.match(takenMessage("booking", "BK-1", { ...by, status: "weird" }), /\(weird\)/); // an unknown status is shown as it is
});

test("checkState: nothing typed is idle, an answer for an older value is still checking, a failed check is unknown", () => {
  assert.deepEqual(checkState("", null), { state: "idle" });
  assert.deepEqual(checkState("BK-748", null), { state: "checking" });
  assert.deepEqual(checkState("BK-748", { value: "BK-74", by: null, failed: false }), { state: "checking" });
  assert.deepEqual(checkState("BK-748", { value: "BK-748", by: null, failed: false }), { state: "free" });
  assert.deepEqual(checkState("BK-748", { value: "BK-748", by, failed: false }), { state: "taken", by });
  assert.deepEqual(checkState("BK-748", { value: "BK-748", by: null, failed: true }), { state: "unknown" });
});
