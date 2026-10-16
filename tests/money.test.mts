// The money rule for the sample-data layer. It must give exactly what the database function money_of() gives:
// the same cases are in db-tests/rules.test.mts ("money_of works out invoice total now ...").
import test from "node:test";
import assert from "node:assert/strict";
import { moneyOf } from "../src/lib/money.ts";
import { STATUS } from "../src/lib/status.ts";

const m = (invoiceAmount: number | null, payments: number[] = [], credits: number[] = [], refunds: number[] = []) => moneyOf({ invoiceAmount, payments, credits, refunds });

test("unpaid, partly paid and paid", () => {
  assert.deepEqual(m(1000), { invoice_now: 1000, paid: 0, balance_due: 1000, refund_due: 0, pay_status: "unpaid" });
  assert.deepEqual(m(1000, [400]), { invoice_now: 1000, paid: 400, balance_due: 600, refund_due: 0, pay_status: "partial" });
  assert.deepEqual(m(1000, [400, 600]), { invoice_now: 1000, paid: 1000, balance_due: 0, refund_due: 0, pay_status: "paid" });
});

test("a credit after paying leaves money owed back, and the refund settles it", () => {
  assert.deepEqual(m(1000, [1000], [350]), { invoice_now: 650, paid: 1000, balance_due: 0, refund_due: 350, pay_status: "refund_due" });
  assert.deepEqual(m(1000, [1000], [350], [350]), { invoice_now: 650, paid: 650, balance_due: 0, refund_due: 0, pay_status: "paid" });
});

test("a credit above what was paid leaves a balance, and a full credit with nothing paid is credited", () => {
  assert.deepEqual(m(1000, [100], [350]), { invoice_now: 650, paid: 100, balance_due: 550, refund_due: 0, pay_status: "partial" });
  assert.deepEqual(m(1000, [], [1000]), { invoice_now: 0, paid: 0, balance_due: 0, refund_due: 0, pay_status: "credited" });
});

test("an overpayment is owed back, and no invoice amount means not invoiced", () => {
  assert.deepEqual(m(1000, [1100]), { invoice_now: 1000, paid: 1100, balance_due: 0, refund_due: 100, pay_status: "refund_due" });
  assert.deepEqual(m(null), { invoice_now: null, paid: 0, balance_due: null, refund_due: 0, pay_status: "not_invoiced" });
});

test("amounts are worked out to two decimals", () => {
  assert.deepEqual(m(100.1, [0.1, 0.2]), { invoice_now: 100.1, paid: 0.3, balance_due: 99.8, refund_due: 0, pay_status: "partial" });
});

test("the two new payment states have plain labels", () => {
  assert.equal(STATUS.refund_due.label, "Refund due");
  assert.equal(STATUS.credited.label, "Fully credited");
});
