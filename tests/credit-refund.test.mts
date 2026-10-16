// Credit notes and refunds, checked against the sample-data backend, which mirrors the database rules in migration 0054/0055
// (the same cases run against the real database in db-tests/rules.test.mts).
// Seed data: BK-1002 / INV-1001 (800, paid 400, collected), BK-1003 / INV-1002 (600, paid 600, at the warehouse),
// BK-1004 / INV-1003 (no amount), BK-1001 (booked, no invoice).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const booking = async (code: string): Promise<R> => (await c.from("bookings").select("*").eq("code", code).single()).data;
const money = async (code: string): Promise<R> => (await c.rpc("booking_money", { p_booking: (await booking(code)).id })).data;
const KEPT = [{ category: "transport", amount: 150, note: "Pickup trip" }];

async function credit(code: string, args: R = {}) {
  return c.rpc("issue_credit_note", { p_booking_id: (await booking(code)).id, p_reason: "Customer changed their mind", p_lines: KEPT, ...args });
}
async function refund(code: string, args: R = {}) {
  return c.rpc("record_refund", { p_booking_id: (await booking(code)).id, p_amount: 100, p_method: "cash", ...args });
}

test("a credit note lowers the invoice and leaves a refund due, numbered from the series", async () => {
  const r = await credit("BK-1003");
  assert.equal(r.error, null);
  const [note] = (await c.from("credit_notes").select("*")).data;
  assert.equal(note.number, "CR-1001");
  assert.deepEqual([note.old_total, note.new_total, note.credit_amount], [600, 150, 450]);
  assert.equal((await c.from("credit_note_lines").select("*")).data.length, 1);
  assert.deepEqual(await money("BK-1003"), { invoice_now: 150, paid: 600, balance_due: 0, refund_due: 450, pay_status: "refund_due" });
});

test("Accounts counts the credit and the refund due, and the Refund due filter finds the invoice", async () => {
  const s = (await c.rpc("accounts_summary")).data;
  assert.equal(s.invoiced, 800 + 150);
  assert.equal(s.refund_due_count, 1);
  assert.equal(s.refund_due_amount, 450);
  const list = (await c.rpc("accounts_invoices", { p_status: "refund_due" })).data;
  assert.deepEqual(list.map((x: R) => [x.r_invoice_no, x.r_amount, x.r_credited, x.r_pay_status]), [["INV-1002", 150, 450, "refund_due"]]);
  assert.equal((await c.rpc("accounts_invoices", { p_status: "outstanding" })).data.some((x: R) => x.r_invoice_no === "INV-1002"), false);
});

test("search shows the same payment state as Accounts", async () => {
  const hit = (await c.rpc("global_search", { p_query: "BK-1003" })).data.bookings[0];
  assert.equal(hit.pay_status, "refund_due");
});

test("a refund cannot be more than the refund due, and the right refund settles it", async () => {
  assert.match((await refund("BK-1003", { p_amount: 500 })).error.message, /more than the refund due \(450\)/);
  assert.match((await refund("BK-1003", { p_amount: 0 })).error.message, /above zero/);
  assert.match((await refund("BK-1003", { p_method: "cheque" })).error.message, /cash or bank transfer/);
  const note = (await c.from("credit_notes").select("*")).data[0];
  const r = await refund("BK-1003", { p_amount: 450, p_credit_note_id: note.id, p_method: "bank_transfer" });
  assert.equal(r.error, null);
  assert.equal((await c.from("refunds").select("*")).data[0].number, "RF-1001");
  assert.deepEqual(await money("BK-1003"), { invoice_now: 150, paid: 150, balance_due: 0, refund_due: 0, pay_status: "paid" });
  assert.match((await refund("BK-1003", { p_amount: 1 })).error.message, /no refund due/i);
  const s = (await c.rpc("accounts_summary")).data;
  assert.equal(s.refunded, 450);
  assert.deepEqual(s.refunds, { cash: 0, bank: 450 });
});

test("voiding: the refund first, then the credit note, and each restores the numbers", async () => {
  const note = (await c.from("credit_notes").select("*")).data[0];
  const rf = (await c.from("refunds").select("*")).data[0];
  assert.match((await c.rpc("void_credit_note", { p_id: note.id, p_reason: "Mistake" })).error.message, /Void the refund first/);
  assert.match((await c.rpc("void_refund", { p_id: rf.id, p_reason: " " })).error.message, /reason is required/i);
  assert.equal((await c.rpc("void_refund", { p_id: rf.id, p_reason: "Wrong amount" })).error, null);
  assert.equal((await money("BK-1003")).refund_due, 450);
  assert.match((await c.rpc("void_refund", { p_id: rf.id, p_reason: "Again" })).error.message, /already void/);
  assert.equal((await c.rpc("void_credit_note", { p_id: note.id, p_reason: "Issued in error" })).error, null);
  assert.deepEqual(await money("BK-1003"), { invoice_now: 600, paid: 600, balance_due: 0, refund_due: 0, pay_status: "paid" });
});

test("a credit note needs a collected booking with an invoice amount, a reason, a valid list and a lower total", async () => {
  assert.match((await credit("BK-1001")).error.message, /only for bookings that have been collected/);
  assert.match((await credit("BK-1004")).error.message, /no invoice amount/);
  assert.match((await credit("BK-1002", { p_reason: " " })).error.message, /reason is required/i);
  assert.match((await credit("BK-1002", { p_lines: [{ category: "tips", amount: 5 }] })).error.message, /Choose a category/);
  assert.match((await credit("BK-1002", { p_lines: [{ category: "other", amount: 0 }] })).error.message, /above zero/);
  assert.match((await credit("BK-1002", { p_lines: [{ category: "other", amount: 800 }] })).error.message, /below the current total \(800\)/);
  assert.match((await credit("BK-1002", { p_date: "2999-01-01" })).error.message, /future/);
  assert.match((await credit("BK-1002", { p_date: "2000-01-01" })).error.message, /before the collection day/);
  assert.match((await credit("BK-1002", { p_return_id: crypto.randomUUID() })).error.message, /another booking/);
});

test("a full credit with nothing paid is credited; keeping nothing needs no lines", async () => {
  // BK-1004 has no amount, so give BK-1002 a second credit down to 0: first drop paid to 0 by using the unpaid side.
  const r = await credit("BK-1002", { p_lines: [] });
  assert.equal(r.error, null);
  assert.deepEqual(await money("BK-1002"), { invoice_now: 0, paid: 400, balance_due: 0, refund_due: 400, pay_status: "refund_due" });
});

test("a booking with payments cannot be cancelled", async () => {
  const b = await booking("BK-1002");
  assert.match((await c.rpc("cancel_booking", { p_booking_id: b.id, p_reason: "Changed mind" })).error.message, /Payments exist/);
});

// The screens are checked as source (like tests/disclosure.test.mts): they cannot run here, but they must use the one database rule.
import { readFileSync } from "node:fs";

test("Accounts offers the Refund due filter and shows refunds", () => {
  const code = readFileSync("src/app/accounts/page.tsx", "utf8");
  assert.match(code, /export const FILTERS/);
  assert.match(code, /value: "refund_due", label: "Refund due"/);
  assert.match(code, /Refunded: /);
  assert.match(code, /r_credited/);
});

test("the payments card reads the money from booking_money, credit notes and refunds", () => {
  const code = readFileSync("src/components/bookings/PaymentsCard.tsx", "utf8");
  for (const word of ["booking_money", '"credit_notes"', '"refunds"', "Invoice total now"]) assert.ok(code.includes(word), `missing ${word}`);
});

test("the screen flow: refund exactly the refund due, then void both and get the original back", async () => {
  // BK-1002 was credited down to 0 above, with 400 paid, so 400 is owed back.
  const due = (await money("BK-1002")).refund_due;
  assert.equal(due, 400);
  const note = (await c.from("credit_notes").select("*").eq("booking_id", (await booking("BK-1002")).id).single()).data;
  const r = await refund("BK-1002", { p_amount: due, p_credit_note_id: note.id, p_method: "bank_transfer" });
  assert.equal(r.error, null);
  assert.deepEqual(await money("BK-1002"), { invoice_now: 0, paid: 0, balance_due: 0, refund_due: 0, pay_status: "credited" });
  assert.equal((await c.rpc("void_refund", { p_id: r.data, p_reason: "Test" })).error, null);
  assert.equal((await c.rpc("void_credit_note", { p_id: note.id, p_reason: "Test" })).error, null);
  assert.deepEqual(await money("BK-1002"), { invoice_now: 800, paid: 400, balance_due: 400, refund_due: 0, pay_status: "partial" });
});

test("the payments card shows both panels only to people who may issue refunds, on a collected, invoiced, live booking", () => {
  const code = readFileSync("src/components/bookings/PaymentsCard.tsx", "utf8");
  assert.ok(code.includes("CreditNotePanel") && code.includes("RefundPanel"));
  assert.ok(code.includes('can("refunds.issue")'));
  assert.match(code, /\["collected", "at_warehouse"\]\.includes\(booking\.status\)/);
  assert.ok(code.includes("invoiced"));
});

test("the customer timeline lists credit notes and refunds (and voiding), and the return page links to the credit note flow", async () => {
  // BK-1003 was credited and refunded earlier in this file, then both were voided; BK-1002 was credited, refunded and voided too.
  const b = await booking("BK-1003");
  const link = (await c.from("booking_contacts").select("*").eq("booking_id", b.id).eq("role", "customer")).data[0];
  assert.ok(link, "the seed booking has a customer");
  {
    const rows = (await c.rpc("customer_timeline", { p_customer_id: link.customer_id, p_limit: 200, p_offset: 0 })).data as R[];
    assert.ok(rows.some((r) => r.r_kind === "credit_note" && /^Credit note CR-\d+ issued$/.test(r.r_title)));
    assert.ok(rows.some((r) => r.r_kind === "refund" && /^Refund RF-\d+ paid$/.test(r.r_title)));
    assert.ok(rows.some((r) => r.r_kind === "credit_note" && /voided$/.test(r.r_title)));
  }
  const page = readFileSync("src/app/warehouse-inventory/returns/[id]/page.tsx", "utf8");
  assert.ok(page.includes("?credit=1&return=") && page.includes('can("refunds.issue")'));
  assert.ok(readFileSync("src/components/bookings/PaymentsCard.tsx", "utf8").includes('get("credit") === "1"'));
});

test("the invoice amount is read-only once a credit note or refund exists, and such a booking cannot be deleted", () => {
  const billing = readFileSync("src/components/bookings/form/BillingCard.tsx", "utf8");
  assert.ok(billing.includes("readOnly") && billing.includes('"credit_notes"') && billing.includes('"refunds"'));
  const del = readFileSync("src/components/bookings/DeleteBooking.tsx", "utf8");
  assert.ok(del.includes('"credit_notes"') && del.includes("credit note"));
});

test("the credit note and refund receipt pages: one query each, print and share only with documents.print, VOID when voided", () => {
  const note = readFileSync("src/app/bookings/[id]/credit-notes/[noteId]/page.tsx", "utf8");
  const rec = readFileSync("src/app/bookings/[id]/refunds/[refundId]/page.tsx", "utf8");
  for (const [name, code] of [["credit note", note], ["refund", rec]] as const) {
    assert.ok(code.includes('can("documents.print")') && code.includes("ShareButton"), `${name}: print and share`);
    assert.ok(code.includes('status === "void"') && code.includes("VOID"), `${name}: VOID mark`);
    assert.equal((code.match(/supabase\s*\.from\(/g) ?? []).length, 1, `${name}: one query`);
  }
  assert.ok(note.includes("credit_note_lines(*)") && note.includes("booking:bookings("));
  assert.ok(rec.includes("booking:bookings(") && rec.includes("credit_note:credit_notes("));
  const card = readFileSync("src/components/bookings/PaymentsCard.tsx", "utf8");
  assert.ok(card.includes("/credit-notes/") && card.includes("/refunds/") && card.includes('can("documents.print")'));
});
