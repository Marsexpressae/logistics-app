// The sender is the customer: every booking has one, and the booking follows the customer until it is collected.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const book = async (over: R = {}) =>
  (await c.from("bookings").insert({ sender_name: "Walk In", sender_phone: "+971500555001", pickup_area: "Dubai", pickup_address: "Somewhere", pickup_date: "2026-03-01", ...over }).select("*").single()).data;
const customerOf = async (bookingId: string) => {
  const link = (await c.from("booking_contacts").select("customer_id").eq("booking_id", bookingId).eq("role", "customer").maybeSingle()).data;
  return link ? (await c.from("customers").select("*").eq("id", link.customer_id).single()).data : null;
};
const count = async () => (await c.from("customers").select("*")).data.length;

test("a new booking always gets a customer, created from its details", async () => {
  const b = await book();
  const cu = await customerOf(b.id);
  assert.equal(cu.full_name, "Walk In");
  assert.equal(cu.phone, "+971500555001");
  assert.equal((await c.rpc("bookings_without_customer", { p_limit: 10 })).data.total, 0);
});

test("a second booking with the same phone reuses the customer, no duplicate", async () => {
  const before = await count();
  const a = await book({ sender_phone: "+971500555002", sender_name: "Repeat Customer" });
  const b = await book({ sender_phone: "+971500555002", sender_name: "Repeat Customer" });
  assert.equal((await customerOf(a.id)).id, (await customerOf(b.id)).id);
  assert.equal((await count()) - before, 1);
});

test("editing the customer updates bookings waiting for pickup, but not collected ones", async () => {
  const waiting = await book({ sender_phone: "+971500555003", sender_name: "Before Edit" });
  const cu = await customerOf(waiting.id);
  const done = await book({ sender_phone: "+971500555003", sender_name: "Before Edit" });
  await c.from("bookings").update({ status: "collected" }).eq("id", done.id);

  await c.rpc("update_customer", { p_id: cu.id, p_name: "After Edit", p_phone: "+971500555099", p_whatsapp: null, p_address: null, p_lat: null, p_lng: null, p_eid: null });
  const w = (await c.from("bookings").select("*").eq("id", waiting.id).single()).data;
  const d = (await c.from("bookings").select("*").eq("id", done.id).single()).data;
  assert.deepEqual([w.sender_name, w.sender_phone], ["After Edit", "+971500555099"]);
  assert.deepEqual([d.sender_name, d.sender_phone], ["Before Edit", "+971500555003"]); // the collected invoice keeps what was true then
});

test("correcting the number on a pickup corrects the customer too", async () => {
  const b = await book({ sender_phone: "+971500555004" });
  const fixed = await c.rpc("update_contact", { p_booking_id: b.id, p_party: "sender", p_phone: "+971500555005", p_whatsapp: null });
  assert.equal(fixed.error, null);
  assert.equal((await customerOf(b.id)).phone, "+971500555005");
});

test("the roles are named for people: customer, booked by, receiver", async () => {
  const { ROLE_LABEL } = await import("../src/lib/customers.ts");
  assert.deepEqual(ROLE_LABEL, { customer: "Customer", booker: "Booked by", receiver: "Receiver" });
});
