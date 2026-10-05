// Customer module, step 2: warning flag, receivers' address book, Emirates ID, duplicates and merge.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const create = (over: R = {}) =>
  c.rpc("create_customer", { p_name: "Ismail Khan", p_phone: "+971567375716", p_whatsapp: null, p_address: "Deira, Dubai", p_lat: null, p_lng: null, p_eid: null, ...over });
const job = async (over: R = {}) =>
  (await c.from("bookings").insert({ sender_name: "Job Sender", sender_phone: "+971500009999", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-02-01", ...over }).select("*").single()).data;
const link = (booking: string, customer: string | null, role = "customer") => c.rpc("link_booking_customer", { p_booking_id: booking, p_customer_id: customer, p_role: role });

test("a warning note shows on every invoice of the customer, and clears when emptied", async () => {
  const id = (await create({ p_name: "Warn Me", p_phone: "+971500100001" })).data;
  const b = await job();
  await link(b.id, id);
  assert.equal((await c.rpc("booking_warning", { p_booking_id: b.id })).data, null);
  await c.rpc("set_customer_warning", { p_id: id, p_note: "Collect payment first" });
  assert.equal((await c.rpc("booking_warning", { p_booking_id: b.id })).data, "Collect payment first");
  await c.rpc("set_customer_warning", { p_id: id, p_note: "  " });
  assert.equal((await c.rpc("booking_warning", { p_booking_id: b.id })).data, null);
});

test("address book: a receiver is a person, reused by phone, never their own receiver", async () => {
  const sender = (await create({ p_name: "Book Owner", p_phone: "+971500100002" })).data;
  const first = await c.rpc("add_receiver", { p_sender: sender, p_name: "Aunt Sara", p_phone: "+923001234567", p_address: "Lahore, house 4" });
  assert.equal(first.error, null);
  await c.rpc("add_receiver", { p_sender: sender, p_name: "Aunt Sara", p_phone: "+923001234567", p_address: "Karachi, flat 9" }); // same person, second address
  await c.rpc("add_receiver", { p_sender: sender, p_name: "Aunt Sara", p_phone: "+923001234567", p_address: "Karachi, flat 9" }); // exact repeat: no new entry
  const book = (await c.rpc("customer_receivers_of", { p_sender: sender })).data;
  assert.equal(book.length, 2);
  assert.equal(new Set(book.map((r: R) => r.receiver_id)).size, 1); // one person, two addresses
  assert.match((await c.rpc("add_receiver", { p_sender: sender, p_name: "Me", p_phone: "+971500100002", p_address: null })).error.message, /own receiver/);
  await c.rpc("remove_receiver", { p_id: book[0].id });
  assert.equal((await c.rpc("customer_receivers_of", { p_sender: sender })).data.length, 1);
});

test("save receiver from the booking: person created, address book filled, linked as receiver", async () => {
  const sender = (await create({ p_name: "Sender Two", p_phone: "+971500100003" })).data;
  const b = await job({ receiver_name: "Receiver Rana", receiver_phone: "+923009876543", receiver_address: "Gujranwala" });
  assert.match((await c.rpc("save_booking_receiver", { p_booking_id: b.id })).error.message, /Link a customer/);
  await link(b.id, sender);
  const rid = (await c.rpc("save_booking_receiver", { p_booking_id: b.id })).data;
  assert.ok(rid);
  assert.equal((await c.rpc("customer_receivers_of", { p_sender: sender })).data[0].address, "Gujranwala");
  const links = (await c.from("booking_contacts").select("role, customer_id").eq("booking_id", b.id)).data;
  assert.equal(links.find((l: R) => l.role === "receiver").customer_id, rid);
});

test("an Emirates ID recorded at pickup fills the customer, and the setting can make it required", async () => {
  const id = (await create({ p_name: "Has ID", p_phone: "+971500100004" })).data;
  const b = await job();
  await link(b.id, id);

  await c.from("app_settings").update({ value: true }).eq("key", "require_id_before_collected");
  const blocked = await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  assert.match(blocked.error.message, /Emirates ID/);

  await c.from("id_documents").insert({ booking_id: b.id, emirates_id: "784 1991 7654321 2", photo_path: `${b.id}/x.jpg` });
  assert.equal((await c.from("customers").select("*").eq("id", id).single()).data.emirates_id, "784-1991-7654321-2");
  assert.equal((await c.from("bookings").update({ status: "collected" }).eq("id", b.id)).error, null);
  await c.from("app_settings").update({ value: false }).eq("key", "require_id_before_collected");
});

test("deleting an ID record needs a reason and leaves a record of why", async () => {
  const b = await job();
  const doc = (await c.from("id_documents").insert({ booking_id: b.id, emirates_id: "784-1991-7654321-2", photo_path: `${b.id}/y.jpg` }).select("*").single()).data;
  assert.match((await c.rpc("delete_id_document", { p_id: doc.id, p_reason: " " })).error.message, /reason/);
  const gone = await c.rpc("delete_id_document", { p_id: doc.id, p_reason: "Customer asked" });
  assert.equal(gone.data, `${b.id}/y.jpg`); // the app removes the file with this path
  assert.equal((await c.from("id_documents").select("*").eq("booking_id", b.id)).data.length, 0);
  const rec = (await c.from("audit_log").select("*").eq("booking_id", b.id)).data.find((e: R) => e.table_name === "deletion_reason");
  assert.equal(rec.changes.reason, "Customer asked");
});

test("same phone shows as a possible duplicate; merging moves everything and loses nothing", async () => {
  const a = (await create({ p_name: "Dup One", p_phone: "+971500100005", p_address: null })).data;
  const d = (await create({ p_name: "Dup Two", p_phone: "+971500100005", p_address: "Sharjah", p_eid: "784-1992-1111111-1" })).data;
  const groups = (await c.rpc("possible_duplicates")).data;
  assert.ok(groups.some((g: R) => g.kind === "phone" && g.value === "+971500100005" && g.customers.length === 2));

  const b = await job();
  await link(b.id, d);
  await c.from("customer_notes").insert({ customer_id: d, body: "Note on the duplicate" });
  await c.rpc("add_receiver", { p_sender: d, p_name: "Rec", p_phone: "+923001110000", p_address: "A" });

  assert.equal((await c.rpc("merge_customers", { p_keep: a, p_remove: a })).error.message, "Choose two different customers");
  assert.equal((await c.rpc("merge_customers", { p_keep: a, p_remove: d })).error, null);
  const kept = (await c.from("customers").select("*").eq("id", a).single()).data;
  assert.equal(kept.address, "Sharjah"); // blanks are filled from the other record
  assert.equal(kept.emirates_id, "784-1992-1111111-1");
  assert.equal((await c.from("customers").select("*").eq("id", d).maybeSingle()).data, null);
  assert.equal((await c.from("booking_contacts").select("*").eq("booking_id", b.id).eq("role", "customer").single()).data.customer_id, a);
  assert.equal((await c.rpc("customer_receivers_of", { p_sender: a })).data.length, 1);
  const rows = (await c.rpc("customer_timeline", { p_customer_id: a, p_limit: 50, p_offset: 0 })).data;
  assert.ok(rows.some((r: R) => r.r_detail === "Note on the duplicate"));
  assert.ok(rows.some((r: R) => /Merged with/.test(r.r_detail ?? "")));
  assert.equal((await c.rpc("possible_duplicates")).data.some((g: R) => g.value === "+971500100005"), false);
});

test("a customer with invoices cannot be deleted; one without can", async () => {
  const withJob = (await create({ p_name: "Has Job", p_phone: "+971500100006" })).data;
  const b = await job();
  await link(b.id, withJob);
  assert.match((await c.rpc("delete_customer", { p_id: withJob })).error.message, /linked to invoices/);
  const free = (await create({ p_name: "Nobody", p_phone: "+971500100007" })).data;
  assert.equal((await c.rpc("delete_customer", { p_id: free })).error, null);
});

test("ID photos: the permission goes to staff and drivers; merging only to managers", async () => {
  const perms = (await c.from("role_permissions").select("*")).data as R[];
  const has = (role: string, p: string) => perms.some((x) => x.role === role && x.permission === p);
  assert.ok(has("driver", "customers.id_photo") && has("staff", "customers.id_photo") && !has("warehouse", "customers.id_photo"));
  assert.ok(has("manager", "customers.manage") && !has("staff", "customers.manage"));
});
