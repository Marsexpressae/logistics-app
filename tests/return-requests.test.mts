// Return requests on the sample-data backend, which mirrors migration 0067 (the same rules run against the real database in
// db-tests/rules.test.mts), and the pure pick-list helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient, freshMockData, setMockUser } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (name: string, args?: R): Promise<{ data: any; error: { message: string } | null }> => c.rpc(name, args); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const msg = async (name: string, args: R) => (await rpc(name, args)).error?.message ?? "";
const daysAway = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** A collected booking received into the warehouse as three parcels, and the ids of those parcels. */
async function received() {
  const b = (await c.from("bookings").insert({ sender_name: "Test Sender", sender_phone: "+971501112233", pickup_area: "Dubai", pickup_address: "Somewhere", pickup_date: "2026-10-05" }).select("*").single()).data as R;
  await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  const wh = (await rows("warehouses"))[0];
  assert.equal((await rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: wh.id, p_parcels: [{ description: "A", weight_kg: 10 }, { description: "B", weight_kg: 12 }, { description: "C", weight_kg: 8 }] })).error, null);
  const ids = (await rows("parcels")).filter((p) => p.booking_id === b.id && p.status === "in_warehouse").sort((x, y) => x.seq - y.seq).map((p) => p.id as string);
  return { booking: b, ids };
}
const ask = (booking: string, note: string | null = null, needed: string | null = null, ids: string[] | null = null) =>
  rpc("request_return", { p_booking_id: booking, p_note: note, p_needed_by: needed, p_parcel_ids: ids });
const mailOf = async (user: string) => (await rows("notifications")).filter((n) => n.user_id === user);

test("mock: only people with returns.request can raise a request, with checked input", async () => {
  freshMockData();
  const { booking, ids } = await received();
  const other = await received();
  setMockUser("sample-driver");
  assert.match(await msg("request_return", { p_booking_id: booking.id }), /permission/i);
  setMockUser("sample-staff");
  const first = await ask(booking.id, "Customer collects Thursday");
  assert.equal(first.error, null);
  const row = (await rows("return_requests")).find((r) => r.id === first.data)!;
  assert.deepEqual([row.status, row.parcel_ids, row.note, row.requested_by, row.requested_by_name], ["open", null, "Customer collects Thursday", "sample-staff", "Sam Staff"]);
  assert.match((await ask(booking.id)).error?.message ?? "", /already has an open return request/);

  const bare = (await c.from("bookings").insert({ sender_name: "X", sender_phone: "+971501112233", pickup_area: "Dubai", pickup_address: "S", pickup_date: "2026-10-05" }).select("*").single()).data as R;
  assert.match((await ask(bare.id)).error?.message ?? "", /no parcels in the warehouse/);
  await c.from("bookings").update({ status: "cancelled", cancellation_reason: "test" }).eq("id", bare.id);
  assert.match((await ask(bare.id)).error?.message ?? "", /cancelled booking cannot have a return request/);
  assert.match((await ask("nope")).error?.message ?? "", /Booking not found/);
  assert.match((await ask(other.booking.id, null, daysAway(-3))).error?.message ?? "", /cannot be in the past/);
  assert.match((await ask(other.booking.id, null, null, [ids[0]])).error?.message ?? "", /Choose parcels of this booking that are in the warehouse/);

  const picked = await ask(other.booking.id, null, daysAway(2), [other.ids[1], other.ids[1]]); // a repeated id counts once
  assert.equal(picked.error, null);
  const p = (await rows("return_requests")).find((r) => r.id === picked.data)!;
  assert.deepEqual(p.parcel_ids, [other.ids[1]]);
  assert.equal(p.needed_by, daysAway(2));
});

test("mock: the warehouse is told, the requester is not, and the booking history records it", async () => {
  freshMockData();
  const { booking } = await received();
  setMockUser("sample-staff");
  await ask(booking.id, "Customer collects Thursday", daysAway(3));
  // the manager and the super admin prepare returns; the inactive warehouse login and the requester get nothing
  const people = (await rows("notifications")).filter((n) => n.kind === "return_requested").map((n) => n.user_id).sort();
  assert.deepEqual(people, ["mock-user", "sample-manager"]);
  const mail = (await mailOf("sample-manager"))[0];
  assert.match(mail.title, /^Return requested: /);
  assert.match(mail.body, /Customer collects Thursday/);
  assert.match(mail.body, /Needed by/);
  assert.equal(mail.booking_id, booking.id);
  const events = (await rows("booking_events")).filter((e) => e.booking_id === booking.id && e.kind === "return_requested");
  assert.equal(events.length, 1);
  assert.match(events[0].reason, /Customer collects Thursday/);
});

test("mock: cancel by the requester or the warehouse, not by anyone else", async () => {
  freshMockData();
  const { booking } = await received();
  setMockUser("sample-staff");
  const first = (await ask(booking.id)).data as string;
  setMockUser("sample-driver");
  assert.match(await msg("cancel_return_request", { p_request_id: first }), /Only the person who asked, or the warehouse, can cancel this request/);
  setMockUser("sample-staff");
  assert.equal((await rpc("cancel_return_request", { p_request_id: first })).error, null);
  const row = (await rows("return_requests")).find((r) => r.id === first)!;
  assert.equal(row.status, "cancelled");
  assert.equal(row.closed_by_name, "Sam Staff");
  assert.ok(row.closed_at);
  assert.equal((await rows("notifications")).filter((n) => n.kind === "return_request_cancelled" && n.user_id === "sample-manager").length, 1);
  assert.equal((await rows("booking_events")).filter((e) => e.booking_id === booking.id && e.kind === "return_request_cancelled").length, 1);
  assert.match(await msg("cancel_return_request", { p_request_id: first }), /already cancelled/);
  assert.match(await msg("cancel_return_request", { p_request_id: "nope" }), /Return request not found/);
  const second = (await ask(booking.id)).data as string; // allowed again once the first is closed
  setMockUser("sample-manager");
  assert.equal((await rpc("cancel_return_request", { p_request_id: second })).error, null); // the warehouse may cancel someone else's request
});

test("mock: preparing a return closes the open request and tells the requester", async () => {
  freshMockData();
  const { booking, ids } = await received();
  setMockUser("sample-staff");
  const request = (await ask(booking.id, "Customer collects Thursday")).data as string;
  assert.match(await msg("prepare_return", { p_booking_id: booking.id, p_parcel_ids: [ids[0]] }), /permission/i); // staff cannot prepare
  setMockUser("sample-manager");
  const ret = (await rpc("prepare_return", { p_booking_id: booking.id, p_parcel_ids: [ids[0], ids[1]] })).data as string;
  const code = (await rows("returns")).find((r) => r.id === ret)!.code;
  const row = (await rows("return_requests")).find((r) => r.id === request)!;
  assert.deepEqual([row.status, row.return_id, row.closed_by_name], ["prepared", ret, "Mona Manager"]);
  const mail = (await mailOf("sample-staff")).filter((n) => n.kind === "return_prepared");
  assert.equal(mail.length, 1);
  assert.ok(mail[0].title.includes(code));
  assert.match(await msg("prepare_return", { p_booking_id: booking.id, p_parcel_ids: [ids[0]] }), /Only parcels of this booking that are in the warehouse/);

  const plain = await received(); // a return without any request works as before and creates no request
  assert.equal((await rpc("prepare_return", { p_booking_id: plain.booking.id, p_parcel_ids: [plain.ids[0]] })).error, null);
  assert.equal((await rows("return_requests")).filter((r) => r.booking_id === plain.booking.id).length, 0);
});

test("mock: parcels_for_return_request lists only the parcels in the warehouse, for people who may request", async () => {
  freshMockData();
  const { booking, ids } = await received();
  await c.from("parcels").update({ status: "delivered" }).eq("id", ids[2]);
  setMockUser("sample-driver");
  assert.match(await msg("parcels_for_return_request", { p_booking_id: booking.id }), /permission/i);
  setMockUser("sample-staff");
  const list = (await rpc("parcels_for_return_request", { p_booking_id: booking.id })).data as R[];
  assert.deepEqual(list.map((p) => p.id), [ids[0], ids[1]]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["barcode", "description", "id", "weight_kg"]);
});

test("mock: a deleted booking takes its requests with it, and the roles that can edit bookings or prepare returns may request", async () => {
  freshMockData();
  const { booking } = await received();
  setMockUser("sample-staff");
  await ask(booking.id);
  setMockUser("mock-user");
  assert.equal((await rpc("delete_booking", { p_booking_id: booking.id, p_reason: "test", p_with_payments: true })).error, null);
  assert.equal((await rows("return_requests")).filter((r) => r.booking_id === booking.id).length, 0);
  const grants = await rows("role_permissions");
  const has = (role: string) => grants.some((g) => g.role === role && g.permission === "returns.request");
  for (const role of ["super_admin", "manager", "staff", "warehouse"]) assert.equal(has(role), true, role);
  for (const role of ["accounts", "driver"]) assert.equal(has(role), false, role);
});
