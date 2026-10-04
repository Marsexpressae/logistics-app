// Accounts rules, checked against the sample-data backend, which mirrors accounts_summary() and accounts_invoices().
// Seed data: INV-1001 (800, paid 400), INV-1002 (600, paid 600), INV-1003 (no amount, paid 0), BK-1001 has no invoice.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const summary = async (): Promise<R> => (await c.rpc("accounts_summary")).data;
const invoices = async (args: object = {}): Promise<R[]> => (await c.rpc("accounts_invoices", args)).data;

test("summary: invoiced, collected, outstanding and amounts not set", async () => {
  const s = await summary();
  assert.equal(s.invoiced, 1400);
  assert.equal(s.collected, 1000);
  assert.equal(s.outstanding, 400);
  assert.equal(s.no_amount_count, 1);
  assert.equal(s.estimated_pending, 300);
});

test("collections by driver and method add up to Collected", async () => {
  const s = await summary();
  const total = s.collections.reduce((t: number, x: R) => t + x.cash + x.bank, 0);
  assert.equal(total, s.collected);
  assert.equal(s.collections.find((x: R) => x.name === "Ahmed Khan").cash, 600);
  assert.equal(s.collections.find((x: R) => x.name === "Bilal Hussain").bank, 400);
});

test("invoice list: newest first, status per invoice, filters and search", async () => {
  const all = await invoices();
  assert.deepEqual(all.map((r) => r.r_invoice_no), ["INV-1003", "INV-1002", "INV-1001"]);
  assert.deepEqual(all.map((r) => r.r_pay_status), ["not_invoiced", "paid", "partial"]);
  assert.equal(all[0].r_total, 3);
  assert.equal(all[2].r_balance, 400);
  assert.deepEqual((await invoices({ p_status: "partial" })).map((r) => r.r_invoice_no), ["INV-1001"]);
  assert.deepEqual((await invoices({ p_search: "fatima" })).map((r) => r.r_invoice_no), ["INV-1002"]);
  assert.deepEqual((await invoices({ p_search: "bk-1004" })).map((r) => r.r_invoice_no), ["INV-1003"]);
});

test("paging: total stays the same across pages", async () => {
  const first = await invoices({ p_limit: 2, p_offset: 0 });
  const second = await invoices({ p_limit: 2, p_offset: 2 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.equal(first[0].r_total, 3);
  assert.equal(second[0].r_total, 3);
});

test("a payment moves the totals; money on a cancelled booking still counts as collected", async () => {
  const b = (await rows("bookings")).find((x) => x.code === "BK-1002")!;
  await c.from("payments").insert({ booking_id: b.id, amount: 400, method: "cash" });
  let s = await summary();
  assert.equal(s.collected, 1400);
  assert.equal(s.outstanding, 0);
  assert.equal((await invoices({ p_status: "paid" })).length, 2);

  await c.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
  s = await summary();
  assert.equal(s.collected, 1400); // the money was received
  assert.equal(s.invoiced, 600); // a cancelled booking is no longer invoiced
});

test("no phantom balance from decimals", async () => {
  const b = (await rows("bookings")).find((x) => x.code === "BK-1004")!;
  await c.from("bookings").update({ invoice_amount: 0.3 }).eq("id", b.id);
  await c.from("payments").insert({ booking_id: b.id, amount: 0.1, method: "cash" });
  await c.from("payments").insert({ booking_id: b.id, amount: 0.2, method: "cash" });
  const row = (await invoices({ p_search: "INV-1003" }))[0];
  assert.equal(row.r_paid, 0.3);
  assert.equal(row.r_balance, 0);
  assert.equal(row.r_pay_status, "paid");
});
