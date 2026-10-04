import test from "node:test";
import assert from "node:assert/strict";
import { invoiceStatus, kg, round2, totalPaid } from "../src/lib/format.ts";

test("round2 removes floating-point noise", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(40 * 3 * 0.1), 12);
});

test("kg shows clean weights", () => {
  assert.equal(kg(0.1 * 3), "0.3 kg");
  assert.equal(kg(80), "80 kg");
});

test("totalPaid adds payments exactly", () => {
  assert.equal(totalPaid([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.equal(totalPaid([]), 0);
  assert.equal(totalPaid(undefined), 0);
});

test("invoiceStatus: not set, unpaid, partial, paid, overpaid", () => {
  assert.equal(invoiceStatus(null, 100), "not_invoiced");
  assert.equal(invoiceStatus(500, 0), "unpaid");
  assert.equal(invoiceStatus(500, 200), "partial");
  assert.equal(invoiceStatus(500, 500), "paid");
  assert.equal(invoiceStatus(500, 650), "paid");
  assert.equal(invoiceStatus(0.3, 0.1 + 0.2), "paid"); // no phantom balance
});
