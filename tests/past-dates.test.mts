// Entering old records: every step of a shipment can carry its real date, never a future one.
// Checked against the sample-data backend, which mirrors the database rules.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const newBooking = async (extra: R = {}) =>
  (await c.from("bookings").insert({ sender_name: "Old Record", sender_phone: "+971501110000", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2025-12-27", ...extra }).select("*").single()).data;
const events = async (parcelId: string) => (await c.from("parcel_events").select("*").eq("parcel_id", parcelId)).data as R[];
const dayOf = (iso: string) => iso.slice(0, 10);

test("a pickup can be rescheduled to a past date", async () => {
  const b = await newBooking({ pickup_date: "2026-10-01" });
  assert.equal((await c.rpc("reschedule_booking", { p_booking_id: b.id, p_new_date: "2025-12-27", p_reason: "Entering the old record" })).error, null);
  assert.equal((await c.from("bookings").select("*").eq("id", b.id).single()).data.pickup_date, "2025-12-27");
});

test("a payment can carry a past day, but not a future one", async () => {
  const b = await newBooking();
  const past = await c.from("payments").insert({ booking_id: b.id, amount: 100, method: "cash", created_at: "2025-12-27T12:00:00.000Z" }).select("*").single();
  assert.equal(past.error, null);
  assert.equal(dayOf(past.data.created_at), "2025-12-27");
  const future = await c.from("payments").insert({ booking_id: b.id, amount: 5, method: "cash", created_at: new Date(Date.now() + 3 * 86400_000).toISOString() });
  assert.match(future.error.message, /payment date cannot be in the future/);
  // an existing payment can be corrected to its real day
  assert.equal((await c.from("payments").update({ created_at: "2025-12-20T12:00:00.000Z" }).eq("id", past.data.id)).error, null);
});

test("the collected day (the invoice date) can be a past day, but not a future one", async () => {
  const b = await newBooking();
  assert.equal((await c.from("bookings").update({ status: "collected", collected_at: "2025-12-27T12:00:00.000Z" }).eq("id", b.id)).error, null);
  assert.equal(dayOf((await c.from("bookings").select("*").eq("id", b.id).single()).data.collected_at), "2025-12-27");
  const future = await c.from("bookings").update({ collected_at: new Date(Date.now() + 3 * 86400_000).toISOString() }).eq("id", b.id);
  assert.match(future.error.message, /collection date cannot be in the future/);
});

test("received and loaded can carry their real days, and the history shows them in order", async () => {
  const b = await newBooking();
  await c.from("bookings").update({ status: "collected", collected_at: "2025-12-27T12:00:00.000Z" }).eq("id", b.id);
  const warehouse = (await c.from("warehouses").select("*")).data[0];
  const parcels = [{ description: "Box", weight_kg: 10 }];

  // never in the future, and never before the collection
  assert.match((await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: warehouse.id, p_parcels: parcels, p_date: "2999-01-01" })).error.message, /future/);
  assert.match((await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: warehouse.id, p_parcels: parcels, p_date: "2025-12-01" })).error.message, /before the collection/);
  assert.equal((await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: warehouse.id, p_parcels: parcels, p_date: "2025-12-28" })).error, null);

  const parcel = (await c.from("parcels").select("*").eq("booking_id", b.id)).data[0];
  assert.equal(dayOf((await events(parcel.id)).find((e) => e.status === "in_warehouse")!.created_at), "2025-12-28");

  const container = (await c.from("containers").insert({ destination: "Karachi" }).select("*").single()).data;
  assert.match((await c.rpc("load_parcel", { p_container_id: container.id, p_barcode: parcel.barcode, p_date: "2999-01-01" })).error.message, /future/);
  assert.equal((await c.rpc("load_parcel", { p_container_id: container.id, p_barcode: parcel.barcode, p_date: "2025-12-30" })).error, null);
  const history = await events(parcel.id);
  assert.equal(dayOf(history.find((e) => e.status === "loaded")!.created_at), "2025-12-30");
  assert.ok(history.find((e) => e.status === "in_warehouse")!.created_at <= history.find((e) => e.status === "loaded")!.created_at);
});
