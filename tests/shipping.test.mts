// Container numbers you choose, real dates on the journey, and delivery details. Checked against the sample-data backend.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const day = (iso: string) => String(iso).slice(0, 10);

async function parcelInWarehouse(invoice: string): Promise<R> {
  const b = (await c.from("bookings").insert({ sender_name: "Old Sender", sender_phone: "+971501112233", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2025-12-27", invoice_no: invoice }).select("*").single()).data;
  await c.from("booking_items").insert({ booking_id: b.id, description: "Plastic box", quantity: 1, weight_kg: 13 });
  await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  const wh = (await rows("warehouses"))[0];
  await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: wh.id, p_parcels: [{ description: "Plastic box", weight_kg: 13 }] });
  return (await rows("parcels")).find((p) => p.booking_id === b.id)!;
}

test("a container can have your own number; it must be unique and well formed", async () => {
  const made = await c.from("containers").insert({ code: "38", destination: "Pakistan" }).select("*").single();
  assert.equal(made.error, null);
  assert.equal(made.data.code, "38");
  assert.equal((await c.from("containers").insert({ code: "38" })).error.code, "23505");
  assert.match((await c.from("containers").insert({ code: "no spaces!" })).error.message, /container number/);
  const auto = await c.from("containers").insert({ destination: "Karachi" }).select("*").single();
  assert.match(auto.data.code, /^CN-\d+$/); // leaving it empty still gives the automatic number
});

test("the journey can be recorded on its real days, and the history shows them", async () => {
  const parcel = await parcelInWarehouse("INV-3593");
  const cont = (await rows("containers")).find((x) => x.code === "38")!;
  assert.equal((await c.rpc("load_parcel", { p_container_id: cont.id, p_barcode: parcel.barcode })).error, null);

  assert.match((await c.rpc("depart_container", { p_container_id: cont.id, p_date: "2999-01-01" })).error.message, /future/);
  assert.equal((await c.rpc("depart_container", { p_container_id: cont.id, p_date: "2026-05-20" })).error, null);
  assert.equal(day((await rows("containers")).find((x) => x.id === cont.id)!.departed_at), "2026-05-20");

  assert.match((await c.rpc("arrive_container", { p_container_id: cont.id, p_date: "2026-05-19" })).error.message, /before the departure/);
  assert.equal((await c.rpc("arrive_container", { p_container_id: cont.id, p_date: "2026-06-18" })).error, null);
  assert.equal(day((await rows("containers")).find((x) => x.id === cont.id)!.arrived_at), "2026-06-18");

  const arrived = (await rows("parcels")).find((p) => p.id === parcel.id)!;
  assert.equal(arrived.status, "arrived");
  assert.match((await c.rpc("deliver_parcel", { p_parcel_id: arrived.id, p_partner: "Leopards Courier", p_date: "2026-06-01" })).error.message, /before the arrival/);
  assert.equal((await c.rpc("deliver_parcel", { p_parcel_id: arrived.id, p_partner: " Leopards Courier ", p_tracking: "KI0723184741", p_date: "2026-06-25" })).error, null);

  const done = (await rows("parcels")).find((p) => p.id === parcel.id)!;
  assert.equal(done.status, "delivered");
  assert.equal(done.delivery_partner, "Leopards Courier");
  assert.equal(done.delivery_tracking, "KI0723184741");
  assert.equal(day(done.delivered_at), "2026-06-25");

  const history = (await rows("parcel_events")).filter((e) => e.parcel_id === parcel.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  assert.deepEqual(history.map((e) => e.status), ["in_warehouse", "loaded", "in_transit", "arrived", "delivered"]);
  assert.deepEqual(history.slice(2).map((e) => day(e.created_at)), ["2026-05-20", "2026-06-18", "2026-06-25"]);
});

test("the customer's tracking page shows who delivered it and the tracking number", async () => {
  const tracked = (await c.rpc("track_booking", { p_code: "INV-3593" })).data;
  const p = tracked.parcels[0];
  assert.equal(p.status, "delivered");
  assert.equal(p.delivery_partner, "Leopards Courier");
  assert.equal(p.delivery_tracking, "KI0723184741");
});

test("without a date, today is used as before", async () => {
  const parcel = await parcelInWarehouse("INV-3594");
  const cont = (await c.from("containers").insert({ code: "39" }).select("*").single()).data;
  await c.rpc("load_parcel", { p_container_id: cont.id, p_barcode: parcel.barcode });
  assert.equal((await c.rpc("depart_container", { p_container_id: cont.id })).error, null);
  assert.equal(day((await rows("containers")).find((x) => x.id === cont.id)!.departed_at), new Date().toISOString().slice(0, 10));
});
