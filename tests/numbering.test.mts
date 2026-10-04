// Invoice and booking numbers: series (prefix + next number), typed numbers, uniqueness, and what follows a change.
// Checked against the sample-data backend, which mirrors the database rules.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const newBooking = (extra: R = {}) =>
  c.from("bookings").insert({ sender_name: "Test Sender", sender_phone: "+971501112233", pickup_area: "Dubai", pickup_address: "Somewhere", pickup_date: "2026-10-05", ...extra }).select("*").single();

test("the invoice series can continue an old numbering, e.g. INV-3835", async () => {
  assert.equal((await c.rpc("set_number_series", { p_kind: "invoice", p_prefix: "inv-", p_next: 3835 })).error, null);
  const b = (await newBooking()).data;
  await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  assert.equal((await rows("bookings")).find((x) => x.id === b.id)!.invoice_no, "INV-3835");
  const b2 = (await newBooking()).data;
  await c.from("payments").insert({ booking_id: b2.id, amount: 10, method: "cash" });
  assert.equal((await rows("bookings")).find((x) => x.id === b2.id)!.invoice_no, "INV-3836");
});

test("series rules: prefix and next number are validated", async () => {
  assert.match((await c.rpc("set_number_series", { p_kind: "invoice", p_prefix: "WAY TOO LONG PREFIX", p_next: 5 })).error.message, /prefix/);
  assert.match((await c.rpc("set_number_series", { p_kind: "invoice", p_prefix: "INV-", p_next: 0 })).error.message, /1 or more/);
});

test("a typed booking number and invoice number are used as typed (upper case)", async () => {
  const r = await newBooking({ code: "bk-9001", invoice_no: "inv-3603" });
  assert.equal(r.error, null);
  assert.equal(r.data.code, "BK-9001");
  assert.equal(r.data.invoice_no, "INV-3603");
});

test("numbers are unique: a typed duplicate is refused, an automatic one skips used numbers", async () => {
  const dupInvoice = await newBooking({ invoice_no: "INV-3603" });
  assert.equal(dupInvoice.error.code, "23505");
  assert.match(dupInvoice.error.message, /invoice_no/);
  const dupCode = await newBooking({ code: "BK-9001" });
  assert.equal(dupCode.error.code, "23505");
  await c.rpc("set_number_series", { p_kind: "invoice", p_prefix: "INV-", p_next: 3603 }); // 3603 is taken
  const b = (await newBooking()).data;
  await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  assert.equal((await rows("bookings")).find((x) => x.id === b.id)!.invoice_no, "INV-3604"); // skipped 3603
});

test("bad formats are refused", async () => {
  assert.match((await newBooking({ code: "BK 9002!" })).error.message, /booking number/);
  assert.match((await newBooking({ invoice_no: "***" })).error.message, /invoice number/);
});

test("changing an invoice number: payments follow, removal is refused, duplicates are refused", async () => {
  const b = (await newBooking()).data;
  await c.from("payments").insert({ booking_id: b.id, amount: 50, method: "cash" });
  const before = (await rows("bookings")).find((x) => x.id === b.id)!;
  assert.ok(before.invoice_no);
  assert.equal((await c.from("bookings").update({ invoice_no: "inv-7001" }).eq("id", b.id)).error, null);
  assert.equal((await rows("payments")).find((p) => p.booking_id === b.id)!.invoice_no, "INV-7001");
  assert.match((await c.from("bookings").update({ invoice_no: null }).eq("id", b.id)).error.message, /cannot be removed/);
  assert.equal((await c.from("bookings").update({ invoice_no: "INV-3603" }).eq("id", b.id)).error.code, "23505");
});

test("the booking number cannot change once parcels exist", async () => {
  const withParcels = (await rows("bookings")).find((x) => x.code === "BK-1003")!;
  const r = await c.from("bookings").update({ code: "BK-9100" }).eq("id", withParcels.id);
  assert.match(r.error.message, /once parcels exist/);
  const fresh = (await newBooking()).data;
  assert.equal((await c.from("bookings").update({ code: "BK-9100" }).eq("id", fresh.id)).error, null);
});
