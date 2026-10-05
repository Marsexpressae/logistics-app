// Statement of account: what was invoiced, what was paid, what is still owed.
import test from "node:test";
import assert from "node:assert/strict";
import { buildStatement } from "../src/lib/statement.ts";

const inv = (code: string, date: string, amount: number | null, paid: number[], status = "collected") => ({
  id: code, code, invoice_no: `INV-${code}`, invoice_amount: amount, pickup_date: date, status, payments: paid.map((a) => ({ amount: a })),
});

test("totals add up, oldest invoice first", () => {
  const s = buildStatement([inv("2", "2026-02-01", 300, [100]), inv("1", "2026-01-01", 200, [200])]);
  assert.deepEqual(s.rows.map((r) => r.ref), ["INV-1", "INV-2"]);
  assert.deepEqual([s.invoiced, s.paid, s.outstanding], [500, 300, 200]);
  assert.deepEqual(s.rows.map((r) => r.state), ["paid", "partial"]);
});

test("cancelled bookings are left out; invoices without an amount are listed but not counted", () => {
  const s = buildStatement([inv("1", "2026-01-01", 100, [], "cancelled"), inv("2", "2026-01-02", null, [50]), inv("3", "2026-01-03", 80, [])]);
  assert.equal(s.rows.length, 2);
  assert.equal(s.withoutAmount, 1);
  assert.equal(s.rows[0].balance, null);
  assert.equal(s.invoiced, 80);
  assert.equal(s.paid, 50);
});

test("no rounding noise in the sums", () => {
  const s = buildStatement([inv("1", "2026-01-01", 0.3, [0.1, 0.2])]);
  assert.equal(s.paid, 0.3);
  assert.equal(s.outstanding, 0);
});
