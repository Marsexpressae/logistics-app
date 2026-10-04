// Deleting a booking (with its pickup and invoice): what blocks it, what is removed, and what is kept as a record.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const del = (id: string, reason = "Test entry", withPayments = false) => c.rpc("delete_booking", { p_booking_id: id, p_reason: reason, p_with_payments: withPayments });

async function newJob(invoice: string, withParcel = true): Promise<R> {
  const b = (await c.from("bookings").insert({ sender_name: "Old Sender", sender_phone: "+971501112233", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2025-12-27", invoice_no: invoice }).select("*").single()).data;
  await c.from("booking_items").insert({ booking_id: b.id, description: "Box", quantity: 1, weight_kg: 10 });
  await c.from("booking_notes").insert({ booking_id: b.id, body: "a note" });
  if (withParcel) {
    await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
    await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: (await rows("warehouses"))[0].id, p_parcels: [{ description: "Box", weight_kg: 10 }] });
  }
  return b;
}

test("a reason is required", async () => {
  const b = await newJob("INV-9001");
  assert.match((await del(b.id, "  ")).error.message, /reason/);
  assert.ok((await rows("bookings")).some((x) => x.id === b.id)); // nothing was deleted
});

test("deleting removes the job with its items, packages, notes and history, and leaves a record", async () => {
  const b = await newJob("INV-9002");
  assert.equal((await del(b.id, "Duplicate booking")).error, null);
  assert.equal((await rows("bookings")).some((x) => x.id === b.id), false);
  for (const t of ["booking_items", "parcels", "booking_notes"]) assert.equal((await rows(t)).some((x) => x.booking_id === b.id), false, t);
  const record = (await rows("audit_log")).find((e) => e.table_name === "deletion_reason" && e.booking_id === b.id)!;
  assert.equal(record.changes.reason, "Duplicate booking");
  assert.equal(record.changes.invoice, "INV-9002");
});

test("money is never deleted by accident", async () => {
  const b = await newJob("INV-9003");
  await c.from("payments").insert({ booking_id: b.id, amount: 250, method: "cash" });
  const refused = await del(b.id);
  assert.match(refused.error.message, /^PAYMENTS_EXIST/);
  assert.ok((await rows("bookings")).some((x) => x.id === b.id));
  assert.equal((await del(b.id, "Test payment, entered twice", true)).error, null);
  assert.equal((await rows("payments")).some((p) => p.booking_id === b.id), false);
  const record = (await rows("audit_log")).find((e) => e.table_name === "deletion_reason" && e.booking_id === b.id)!;
  assert.equal(record.changes.payments_total, 250);
});

test("shipped packages block it", async () => {
  const b = await newJob("INV-9004");
  const parcel = (await rows("parcels")).find((p) => p.booking_id === b.id)!;
  const cont = (await rows("containers")).find((x) => x.status === "loading")!;
  await c.rpc("load_parcel", { p_container_id: cont.id, p_barcode: parcel.barcode });
  assert.match((await del(b.id)).error.message, /have shipped/); // loaded counts: unload it first
  await c.rpc("unload_parcel", { p_parcel_id: parcel.id });
  assert.equal((await del(b.id)).error, null);
});

test("return forms go with it", async () => {
  const b = await newJob("INV-9005");
  const parcel = (await rows("parcels")).find((p) => p.booking_id === b.id)!;
  await c.rpc("prepare_return", { p_booking_id: b.id, p_parcel_ids: [parcel.id] });
  assert.equal((await del(b.id)).error, null);
  assert.equal((await rows("returns")).some((r) => r.booking_id === b.id), false);
});

test("a job that never had packages can be deleted too", async () => {
  const b = await newJob("INV-9006", false);
  assert.equal((await del(b.id)).error, null);
});
