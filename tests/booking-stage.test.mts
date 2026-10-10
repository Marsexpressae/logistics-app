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
