// The stage a booking shows follows its parcels (a returned or shipped booking must not say "At warehouse").
import test from "node:test";
import assert from "node:assert/strict";
import { bookingStage } from "../src/lib/booking-stage.ts";

const p = (...statuses: string[]) => statuses.map((status) => ({ status }));

test("stages before the warehouse, and cancelled, are shown as stored", () => {
  assert.equal(bookingStage("booked", p("returned")), "booked");
  assert.equal(bookingStage("collected", p("delivered")), "collected");
  assert.equal(bookingStage("cancelled", p("in_warehouse")), "cancelled");
});

test("without parcel information the stored stage stays", () => {
  assert.equal(bookingStage("at_warehouse"), "at_warehouse");
  assert.equal(bookingStage("at_warehouse", null), "at_warehouse");
  assert.equal(bookingStage("at_warehouse", []), "at_warehouse");
  assert.equal(bookingStage("at_warehouse", p("repacked", "repacked")), "at_warehouse");
});

test("all current parcels returned makes the booking Returned; repacked history is ignored (BK-802)", () => {
  assert.equal(bookingStage("at_warehouse", p("repacked", "repacked", "returned", "returned")), "returned");
});

test("a partial return stays At warehouse", () => {
  assert.equal(bookingStage("at_warehouse", p("returned", "in_warehouse", "in_warehouse")), "at_warehouse");
  assert.equal(bookingStage("at_warehouse", p("returned", "ready_for_return")), "at_warehouse");
});

test("shipping: the least advanced parcel decides", () => {
  assert.equal(bookingStage("at_warehouse", p("in_warehouse", "in_transit")), "at_warehouse"); // some cargo still here
  assert.equal(bookingStage("at_warehouse", p("loaded", "loaded")), "loaded");
  assert.equal(bookingStage("at_warehouse", p("loaded", "in_transit")), "loaded");
  assert.equal(bookingStage("at_warehouse", p("in_transit", "in_transit")), "in_transit");
  assert.equal(bookingStage("at_warehouse", p("in_transit", "arrived")), "in_transit");
  assert.equal(bookingStage("at_warehouse", p("arrived", "delivered")), "arrived");
  assert.equal(bookingStage("at_warehouse", p("delivered", "delivered")), "delivered");
});

test("returned parcels do not hold a shipped booking back", () => {
  assert.equal(bookingStage("at_warehouse", p("returned", "delivered", "delivered")), "delivered");
  assert.equal(bookingStage("at_warehouse", p("returned", "in_transit")), "in_transit");
});

// The screens ask the data layer for the stage (select("*, stage")); the sample-data layer must answer like the database does.
import { createMockClient } from "../src/lib/mock-supabase.ts";

test("the data layer returns the stage as a column, in search and in tracking", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = createMockClient();
  const warehouse = (await c.from("warehouses").select("*")).data[0];
  const booking = (await c.from("bookings").insert({ sender_name: "Stage Test", sender_phone: "+971501110001", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-01-02" }).select("*").single()).data;
  await c.from("bookings").update({ status: "collected" }).eq("id", booking.id);
  await c.rpc("split_booking", { p_booking_id: booking.id, p_warehouse_id: warehouse.id, p_parcels: [{ description: "Box", weight_kg: 5 }] });

  const stage = async () => (await c.from("bookings").select("*, stage").eq("id", booking.id).single()).data.stage;
  assert.equal(await stage(), "at_warehouse");

  // return the only parcel: the stage is Returned (and the stored status is untouched)
  const parcel = (await c.from("parcels").select("*").eq("booking_id", booking.id)).data[0];
  const returnId = (await c.rpc("prepare_return", { p_booking_id: booking.id, p_parcel_ids: [parcel.id] })).data;
  await c.rpc("complete_return", { p_return_id: returnId, p_received_by: "Customer" });
  assert.equal(await stage(), "returned");
  assert.equal((await c.from("bookings").select("*").eq("id", booking.id).single()).data.status, "at_warehouse");

  // search and public tracking show the same stage
  const code = booking.code;
  const found = (await c.rpc("global_search", { p_query: code })).data;
  assert.equal(found.bookings.find((b: { code: string }) => b.code === code).status, "returned");
  assert.equal((await c.rpc("track_booking", { p_code: code })).data.status, "returned");
});
