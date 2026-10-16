// Add, merge and split parcels, checked against the sample-data backend, which mirrors edit_parcels() in migration 0058
// (the same cases run against the real database in db-tests/rules.test.mts).
// Seed data: BK-1002 is collected with no parcels; BK-1001 is only booked.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const booking = async (code: string): Promise<R> => (await c.from("bookings").select("*").eq("code", code).single()).data;
const warehouses = async (): Promise<R[]> => (await c.from("warehouses").select("*")).data;
const parcels = async (bookingId: string): Promise<R[]> => ((await c.from("parcels").select("*").eq("booking_id", bookingId)).data as R[]).sort((a, b) => a.seq - b.seq);
const events = async (bookingId: string): Promise<string[]> =>
  ((await c.from("booking_events").select("*").eq("booking_id", bookingId)).data as R[]).filter((e) => e.kind === "parcels_edited").map((e) => e.reason);
const edit = (b: R, retire: string[], news: R[], warehouse: string | null = null, date: string | null = null) =>
  c.rpc("edit_parcels", { p_booking_id: b.id, p_retire_ids: retire, p_new: news, p_warehouse_id: warehouse, p_date: date });
const state = async (b: R) => JSON.stringify([await parcels(b.id), await events(b.id)]);
const refused = async (b: R, retire: string[], news: R[], pattern: RegExp, warehouse: string | null = null, date: string | null = null) => {
  const before = await state(b);
  assert.match((await edit(b, retire, news, warehouse, date)).error?.message ?? "NOT REFUSED", pattern);
  assert.equal(await state(b), before, "a refused edit changes nothing");
};

let b: R;
let ids: string[];
let wh: R;

test("setup: a collected booking received as three parcels", async () => {
  b = await booking("BK-1002");
  wh = (await warehouses())[0];
  const r = await c.rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: wh.id, p_parcels: [{ description: "Box A", weight_kg: 10 }, { description: "Box B", weight_kg: 12 }, { description: "Box C", weight_kg: 8 }] });
  assert.equal(r.error, null);
  ids = (await parcels(b.id)).map((p) => p.id);
  assert.equal(ids.length, 3);
});

test("merge retires the chosen parcels, makes one new parcel and writes the history line", async () => {
  const r = await edit(b, [ids[0], ids[1]], [{ description: "Boxes A and B", weight_kg: 22 }]);
  assert.equal(r.error, null);
  assert.equal(r.data, 1);
  const rows = await parcels(b.id);
  assert.deepEqual(rows.map((p) => [p.barcode, p.status, p.round]), [
    ["BK-1002-P1", "repacked", 1], ["BK-1002-P2", "repacked", 1], ["BK-1002-P3", "in_warehouse", 1], ["BK-1002-R2-P1", "in_warehouse", 2],
  ]);
  assert.deepEqual([rows[3].seq, rows[3].description, rows[3].weight_kg, rows[3].warehouse_id], [4, "Boxes A and B", 22, wh.id]);
  assert.deepEqual(await events(b.id), ["Merged parcels P1 and P2 into new parcel R2-P1"]);
});

test("split retires one parcel and makes several, add makes one and keeps the rest, rounds go up", async () => {
  const merged = (await parcels(b.id)).find((p) => p.barcode === "BK-1002-R2-P1")!;
  assert.equal((await edit(b, [merged.id], [{ weight_kg: 11 }, { weight_kg: 11 }])).data, 2);
  assert.equal((await edit(b, [], [{ description: "Missed box", weight_kg: 5 }], wh.id)).data, 1);
  const rows = await parcels(b.id);
  const labels = rows.map((p) => p.barcode);
  assert.equal(new Set(labels).size, labels.length, "every barcode is unique");
  assert.deepEqual(labels.slice(-3), ["BK-1002-R3-P1", "BK-1002-R3-P2", "BK-1002-R4-P1"]);
  const p3 = rows.find((p) => p.barcode === "BK-1002-P3")!;
  assert.deepEqual([p3.status, p3.round], ["in_warehouse", 1]);
  assert.deepEqual((await events(b.id)).slice(1), ["Split parcel R2-P1 into new parcels R3-P1 and R3-P2", "Added parcel R4-P1"]);
});

test("three new parcels: the labels are joined with commas and and", async () => {
  const p3 = (await parcels(b.id)).find((p) => p.barcode === "BK-1002-P3")!;
  assert.equal((await edit(b, [p3.id], [{ weight_kg: 3 }, { weight_kg: 3 }, { weight_kg: 2 }])).data, 3);
  assert.equal((await events(b.id)).at(-1), "Split parcel P3 into new parcels R5-P1, R5-P2 and R5-P3");
});

test("refusals: shape, duplicates, other bookings, parcels that cannot be changed, weights, warehouse, dates, booking status", async () => {
  const live = (await parcels(b.id)).filter((p) => p.status === "in_warehouse");
  const [x, y] = [live[0].id, live[1].id];
  await refused(b, [], [{ weight_kg: 1 }, { weight_kg: 1 }], /Add one parcel at a time/, wh.id);
  await refused(b, [], [{ weight_kg: 1 }], /Choose where the new parcel goes/);
  await refused(b, [x], [{ weight_kg: 1 }], /Splitting needs two or more new parcels/);
  await refused(b, [x, y], [{ weight_kg: 1 }, { weight_kg: 1 }], /Merging makes exactly one new parcel/);
  await refused(b, [x, x], [{ weight_kg: 1 }], /The same parcel was chosen twice/);
  await refused(b, [x], [{ weight_kg: 1 }, { weight_kg: -1 }], /weight cannot be negative/);
  await refused(b, [], [{ weight_kg: -1 }], /weight cannot be negative/, wh.id);
  const msg = /Only parcels of this booking that are in the warehouse can be changed/;
  await refused(b, [crypto.randomUUID()], [{ weight_kg: 1 }, { weight_kg: 1 }], msg);
  const retired = (await parcels(b.id)).find((p) => p.status === "repacked")!;
  await refused(b, [retired.id], [{ weight_kg: 1 }, { weight_kg: 1 }], msg);
  const loaded = (await parcels(b.id)).find((p) => p.status === "in_warehouse")!;
  await c.from("parcels").update({ status: "loaded" }).eq("id", loaded.id);
  await refused(b, [loaded.id], [{ weight_kg: 1 }, { weight_kg: 1 }], msg);
  await c.from("parcels").update({ status: "in_warehouse" }).eq("id", loaded.id);
  const other = await booking("BK-1003");
  const foreign = (await parcels(other.id))[0];
  await refused(b, [foreign.id], [{ weight_kg: 1 }, { weight_kg: 1 }], msg);
  await refused(b, [], [{ weight_kg: 1 }], /future/, wh.id, "2999-01-01");
  await refused(b, [], [{ weight_kg: 1 }], /Received cannot be before the collection date/, wh.id, "2000-01-01");
  const unreceived = await booking("BK-1001");
  assert.match((await edit(unreceived, [], [{ weight_kg: 1 }], wh.id)).error.message, /has not been collected yet/);
  assert.match((await c.rpc("edit_parcels", { p_booking_id: crypto.randomUUID(), p_retire_ids: [], p_new: [{ weight_kg: 1 }], p_warehouse_id: wh.id })).error.message, /Booking not found/);
});

test("a weight of 0 and no description are accepted, and an inactive warehouse is refused", async () => {
  assert.equal((await edit(b, [], [{ weight_kg: 0 }], wh.id)).data, 1);
  const inactive = (await warehouses())[1];
  await c.from("warehouses").update({ active: false }).eq("id", inactive.id);
  await refused(b, [], [{ weight_kg: 1 }], /is not active/, inactive.id);
  await c.from("warehouses").update({ active: true }).eq("id", inactive.id);
});

test("the customer timeline labels parcel edits", async () => {
  const link = (await c.from("booking_contacts").select("*").eq("booking_id", b.id).eq("role", "customer")).data[0];
  assert.ok(link, "the seed booking has a customer");
  const rows = (await c.rpc("customer_timeline", { p_customer_id: link.customer_id, p_limit: 200, p_offset: 0 })).data as R[];
  const changed = rows.filter((r) => r.r_title === "Parcels changed").map((r) => r.r_detail);
  assert.ok(changed.includes("Merged parcels P1 and P2 into new parcel R2-P1"));
  assert.ok(!rows.some((r) => r.r_title === "parcels edited"));
});

test("the Warehouse page is split into smaller files", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  assert.ok(readFileSync("src/app/warehouse-inventory/page.tsx", "utf8").split("\n").length < 300, "page.tsx is under 300 lines");
  for (const f of ["types.ts", "StockList.tsx", "IntakeList.tsx", "ReturnsList.tsx"]) assert.ok(existsSync(`src/components/warehouse/${f}`), `${f} exists`);
});
