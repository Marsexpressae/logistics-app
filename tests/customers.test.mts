// Customer records: created from bookings, found by phone / Emirates ID / old invoice, linked to bookings, with one history.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const create = (over: R = {}) =>
  c.rpc("create_customer", { p_name: "Ismail Khan", p_phone: "+971567375716", p_whatsapp: null, p_address: "Deira, Dubai", p_lat: null, p_lng: null, p_eid: null, ...over });
const find = async (q: string): Promise<R[]> => (await c.rpc("search_customers", { p_query: q, p_limit: 10 })).data.customers;

test("existing bookings already have customers, one per sender phone", async () => {
  const list = (await c.rpc("list_customers", { p_limit: 50, p_offset: 0 })).data;
  assert.ok(list.total >= 1);
  assert.equal((await c.rpc("bookings_without_customer", { p_limit: 50 })).data.total, 0);
});

test("a customer is created with a clean phone and Emirates ID", async () => {
  const { data: id, error } = await create({ p_eid: "784 1990 1234567 1" });
  assert.equal(error, null);
  const row = (await c.from("customers").select("*").eq("id", id).single()).data;
  assert.equal(row.emirates_id, "784-1990-1234567-1");
  assert.equal(row.phone, "+971567375716");
});

test("bad input is refused with a plain message", async () => {
  assert.match((await create({ p_name: "  " })).error.message, /name/);
  assert.match((await create({ p_eid: "123" })).error.message, /Emirates ID/);
  assert.match((await create({ p_phone: "abc" })).error.message, /phone/);
});

test("a WhatsApp number equal to the phone is not stored twice", async () => {
  const { data: id } = await create({ p_name: "Same Number", p_phone: "+971501110000", p_whatsapp: "+971501110000" });
  assert.equal((await c.from("customers").select("*").eq("id", id).single()).data.whatsapp, null);
});

test("search finds a customer by name, phone in any format, Emirates ID, and an old invoice", async () => {
  const { data: id } = await create({ p_name: "Zainab Search", p_phone: "+971521234567", p_eid: "784-1985-7654321-0" });
  const b = (await c.from("bookings").insert({ sender_name: "Zainab Search", sender_phone: "+971521234567", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-01-02", invoice_no: "INV-7771" }).select("*").single()).data;
  await c.rpc("link_booking_customer", { p_booking_id: b.id, p_customer_id: id, p_role: "customer" });
  for (const q of ["zainab", "0521234567", "52 123 4567", "784-1985-7654321-0", "7654321", "INV-7771"]) {
    assert.ok((await find(q)).some((x) => x.id === id), q);
  }
  const hit = (await find("INV-7771")).find((x) => x.id === id)!;
  assert.equal(hit.invoices, 1);
  assert.equal(hit.last_invoice, "INV-7771");
});

test("linking: one customer per role per booking, replaced or removed on request", async () => {
  const a = (await create({ p_name: "Link A", p_phone: "+971500000001" })).data;
  const b2 = (await create({ p_name: "Link B", p_phone: "+971500000002" })).data;
  const bk = (await c.from("bookings").insert({ sender_name: "X", sender_phone: "+971500000009", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-01-02" }).select("*").single()).data;
  await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: a, p_role: "customer" });
  await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: b2, p_role: "booker" });
  await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: b2, p_role: "customer" }); // replaces A as the customer
  const links = (await c.from("booking_contacts").select("role, customer_id").eq("booking_id", bk.id)).data;
  assert.equal(links.filter((l: R) => l.role === "customer").length, 1);
  assert.equal(links.find((l: R) => l.role === "customer").customer_id, b2);
  await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: null, p_role: "booker" });
  assert.equal((await c.from("booking_contacts").select("role").eq("booking_id", bk.id)).data.length, 1);
  assert.match((await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: a, p_role: "boss" })).error.message, /role/);
});

test("create from booking copies the sender; the booking follows later edits until it is collected", async () => {
  const bk = (await c.from("bookings").insert({ sender_name: "From Booking", sender_phone: "+971500000077", pickup_area: "Dubai", pickup_address: "Legacy invoice 3603", pickup_date: "2026-01-02" }).select("*").single()).data;
  const id = (await c.rpc("create_customer_from_booking", { p_booking_id: bk.id })).data;
  const cust = (await c.from("customers").select("*").eq("id", id).single()).data;
  assert.equal(cust.full_name, "From Booking");
  assert.equal(cust.address, null); // a placeholder address is not copied
  await c.rpc("update_customer", { p_id: id, p_name: "Renamed", p_phone: "+971500000077", p_whatsapp: null, p_address: null, p_lat: null, p_lng: null, p_eid: null });
  assert.equal((await c.from("bookings").select("*").eq("id", bk.id).single()).data.sender_name, "Renamed"); // still waiting for pickup: follows the customer
});

test("the timeline brings bookings, notes and customer notes together, newest first", async () => {
  const id = (await create({ p_name: "Timeline Person", p_phone: "+971500000055" })).data;
  const bk = (await c.from("bookings").insert({ sender_name: "Timeline Person", sender_phone: "+971500000055", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-01-02" }).select("*").single()).data;
  await c.rpc("link_booking_customer", { p_booking_id: bk.id, p_customer_id: id, p_role: "customer" });
  await c.from("booking_notes").insert({ booking_id: bk.id, body: "Call before arriving" });
  await c.from("customer_notes").insert({ customer_id: id, body: "Prefers WhatsApp" });
  const rows = (await c.rpc("customer_timeline", { p_customer_id: id, p_limit: 50, p_offset: 0 })).data;
  const kinds = rows.map((r: R) => r.r_kind);
  for (const k of ["customer", "booking", "note"]) assert.ok(kinds.includes(k), k);
  assert.ok(rows.some((r: R) => r.r_detail === "Prefers WhatsApp"));
  assert.ok(rows.some((r: R) => r.r_detail === "Call before arriving" && r.r_booking_id === bk.id));
  const times = rows.map((r: R) => r.r_at);
  assert.deepEqual(times, [...times].sort().reverse());
});

test("the top search also finds customers", async () => {
  await create({ p_name: "Globally Found", p_phone: "+971500000066" });
  const r = (await c.rpc("global_search", { p_query: "globally", p_limit: 5 })).data;
  assert.equal(r.customers.length, 1);
  assert.equal(r.customers_total, 1);
});

test("customer permissions: staff can view and edit, only managers can manage", async () => {
  const perms = (await c.from("role_permissions").select("*")).data as R[];
  const has = (role: string, p: string) => perms.some((x) => x.role === role && x.permission === p);
  assert.ok(has("staff", "customers.view") && has("staff", "customers.edit") && !has("staff", "customers.manage"));
  assert.ok(has("manager", "customers.manage"));
  assert.ok(!has("driver", "customers.view"));
});
