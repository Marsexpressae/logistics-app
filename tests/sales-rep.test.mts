// Sales rep (customer owner), checked against the sample-data backend, which mirrors migration 0061
// (the same rules run against the real database in db-tests/rules.test.mts).
// Profiles in the sample data: mock-user (super admin), sample-manager, sample-staff, sample-driver, and sample-warehouse (inactive).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const booking = async (code: string): Promise<R> => (await c.from("bookings").select("*").eq("code", code).single()).data;
const customers = async (): Promise<R[]> => (await c.from("customers").select("*")).data;
const newBooking = (phone: string, name: string, rep: string | null) =>
  c.from("bookings").insert({ sender_name: name, sender_phone: phone, pickup_area: "Dubai", pickup_address: "Somewhere", pickup_date: "2026-10-18", ...(rep ? { sales_rep_id: rep } : {}) }).select("*").single();
const customerOf = async (b: R): Promise<R> => {
  const link = (await c.from("booking_contacts").select("*").eq("booking_id", b.id).eq("role", "customer")).data[0];
  return (await customers()).find((x) => x.id === link.customer_id)!;
};

test("existing records have no rep", async () => {
  const b = await booking("BK-1002");
  assert.equal(b.sales_rep_id ?? null, null);
  assert.equal(b.sales_rep_name ?? null, null);
  assert.ok((await customers()).every((x) => (x.sales_rep_id ?? null) === null));
});

test("the name is copied when a booking is created with a rep, and an inactive or unknown person is refused", async () => {
  const made = await newBooking("+971500888001", "Rep Booking One", "sample-staff");
  assert.equal(made.error, null);
  assert.deepEqual([made.data.sales_rep_id, made.data.sales_rep_name], ["sample-staff", "Sam Staff"]);
  for (const who of ["sample-warehouse", "nobody-here"]) {
    assert.match((await newBooking("+971500888002", "Refused", who)).error?.message ?? "NOT REFUSED", /That person is not active staff/);
  }
});

test("a booking can change its rep, and clearing it clears the name", async () => {
  const b = (await newBooking("+971500888003", "Rep Booking Two", "sample-staff")).data;
  assert.equal((await c.from("bookings").update({ sales_rep_id: "sample-manager" }).eq("id", b.id)).error, null);
  assert.deepEqual([(await booking(b.code)).sales_rep_id, (await booking(b.code)).sales_rep_name], ["sample-manager", "Mona Manager"]);
  await c.from("bookings").update({ sales_rep_id: null }).eq("id", b.id);
  assert.deepEqual([(await booking(b.code)).sales_rep_id ?? null, (await booking(b.code)).sales_rep_name ?? null], [null, null]);
  assert.match((await c.from("bookings").update({ sales_rep_id: "sample-warehouse" }).eq("id", b.id)).error?.message ?? "NOT REFUSED", /not active staff/);
});

test("a booking for a new customer gives the customer the same owner; an existing customer keeps theirs", async () => {
  const first = (await newBooking("+971500888004", "Owner Test", "sample-staff")).data;
  assert.deepEqual([(await customerOf(first)).sales_rep_id, (await customerOf(first)).sales_rep_name], ["sample-staff", "Sam Staff"]);
  const second = (await newBooking("+971500888004", "Owner Test", "sample-manager")).data; // same phone: same customer
  assert.equal((await customerOf(second)).id, (await customerOf(first)).id);
  assert.equal((await customerOf(second)).sales_rep_id, "sample-staff", "the owner is unchanged");
  assert.equal((await booking(second.code)).sales_rep_id, "sample-manager", "the booking keeps its own rep");
  // a customer with no owner is not given one by a later booking
  const bare = (await newBooking("+971500888005", "No Owner", null)).data;
  await newBooking("+971500888005", "No Owner", "sample-staff");
  assert.equal((await customerOf(bare)).sales_rep_id ?? null, null);
});

test("a customer added by hand gets the signed-in person as owner, and the owner can be changed", async () => {
  const id = (await c.rpc("create_customer", { p_name: "By Hand", p_phone: "+971500888006", p_whatsapp: null, p_address: null, p_lat: null, p_lng: null, p_eid: null })).data;
  const row = (await customers()).find((x) => x.id === id)!;
  assert.deepEqual([row.sales_rep_id, row.sales_rep_name], ["mock-user", "Tester (super admin)"]);
  assert.equal((await c.rpc("set_customer_sales_rep", { p_customer_id: id, p_sales_rep_id: "sample-manager" })).error, null);
  assert.equal((await customers()).find((x) => x.id === id)!.sales_rep_name, "Mona Manager");
  assert.match((await c.rpc("set_customer_sales_rep", { p_customer_id: id, p_sales_rep_id: "sample-warehouse" })).error?.message ?? "NOT REFUSED", /not active staff/);
  assert.match((await c.rpc("set_customer_sales_rep", { p_customer_id: crypto.randomUUID(), p_sales_rep_id: null })).error?.message ?? "NOT REFUSED", /Customer not found/);
});

test("changing a customer's owner leaves their old bookings alone", async () => {
  const b = (await newBooking("+971500888007", "Old Bookings", "sample-staff")).data;
  const cust = await customerOf(b);
  await c.rpc("set_customer_sales_rep", { p_customer_id: cust.id, p_sales_rep_id: "sample-manager" });
  assert.equal((await booking(b.code)).sales_rep_id, "sample-staff");
});

test("sales_rep_choices lists the active staff, by name", async () => {
  const list = (await c.rpc("sales_rep_choices")).data as { id: string; name: string }[];
  assert.deepEqual(list.map((x) => x.id).sort(), ["mock-user", "sample-driver", "sample-manager", "sample-staff"]);
  assert.deepEqual(list.map((x) => x.name), [...list.map((x) => x.name)].sort((a, b) => a.localeCompare(b)));
});

test("Accounts, global search and customer search carry the rep", async () => {
  const b = (await newBooking("+971500888008", "Zzowner Qxone", "sample-staff")).data;
  await c.from("bookings").update({ invoice_no: "INV-9001" }).eq("id", b.id);
  const inv = (await c.rpc("accounts_invoices", { p_search: "INV-9001" })).data as R[];
  assert.equal(inv[0].r_sales_rep, "Sam Staff");
  assert.equal((await c.rpc("accounts_invoices", { p_search: "INV-1001" })).data[0].r_sales_rep ?? null, null);
  const g = (await c.rpc("global_search", { p_query: "Zzowner" })).data as R;
  assert.equal(g.bookings[0].sales_rep, "Sam Staff");
  assert.equal(g.customers[0].sales_rep, "Sam Staff");
  const cs = (await c.rpc("search_customers", { p_query: "Zzowner" })).data as R;
  assert.deepEqual([cs.customers[0].sales_rep_id, cs.customers[0].sales_rep], ["sample-staff", "Sam Staff"]);
});

test("the permission exists and goes to managers and super admins", async () => {
  const perm = (await c.from("permissions").select("*").eq("key", "sales_rep.change")).data[0];
  assert.equal(perm.label, "Change the sales rep (owner)");
  const roles = ((await c.from("role_permissions").select("*").eq("permission", "sales_rep.change")).data as R[]).map((r) => r.role).sort();
  assert.deepEqual(roles, ["manager", "super_admin"]);
});
