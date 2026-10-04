// Warehouse names (and rack positions) you manage in Settings. Checked against the sample-data backend.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const list = async (): Promise<R[]> => (await c.from("warehouses").select("*")).data;
const named = async (n: string) => (await list()).find((w) => w.name === n)!;

test("add: a short code is made from the name, and made unique", async () => {
  assert.equal((await c.rpc("add_warehouse", { p_name: "Tarpal A", p_code: null })).error, null);
  assert.equal((await named("Tarpal A")).code, "TA");
  await c.rpc("add_warehouse", { p_name: "Tarpal 2", p_code: null });
  assert.equal((await named("Tarpal 2")).code, "T2");
  await c.rpc("add_warehouse", { p_name: "East Shed", p_code: null });
  assert.equal((await named("East Shed")).code, "ES");
  await c.rpc("add_warehouse", { p_name: "Tall Annex", p_code: null }); // also TA, so it gets TA2
  assert.equal((await named("Tall Annex")).code, "TA2");
  await c.rpc("add_warehouse", { p_name: "Rack A3", p_code: "ra3" });
  assert.equal((await named("Rack A3")).code, "RA3");
});

test("names must be new and not empty", async () => {
  assert.match((await c.rpc("add_warehouse", { p_name: "east shed", p_code: null })).error.message, /already exists/);
  assert.match((await c.rpc("add_warehouse", { p_name: "   ", p_code: null })).error.message, /name/);
});

test("rename and deactivate; the last active one cannot be deactivated", async () => {
  const ta = await named("Tarpal A");
  assert.equal((await c.rpc("update_warehouse", { p_id: ta.id, p_name: "Tarpal Alpha", p_code: "TA", p_active: true })).error, null);
  assert.equal((await named("Tarpal Alpha")).code, "TA");
  assert.equal((await c.rpc("update_warehouse", { p_id: ta.id, p_name: "Tarpal Alpha", p_code: "TA", p_active: false })).error, null);
  assert.equal((await named("Tarpal Alpha")).active, false);
  for (const w of (await list()).filter((x) => x.active !== false).slice(0, -1)) {
    await c.rpc("update_warehouse", { p_id: w.id, p_name: w.name, p_code: w.code, p_active: false });
  }
  const last = (await list()).find((x) => x.active !== false)!;
  assert.match((await c.rpc("update_warehouse", { p_id: last.id, p_name: last.name, p_code: last.code, p_active: false })).error.message, /at least one active/);
});

test("delete: allowed when unused, refused when parcels exist or it is the last active one", async () => {
  const wa = (await list()).find((w) => w.code === "A")!;
  await c.rpc("update_warehouse", { p_id: wa.id, p_name: wa.name, p_code: wa.code, p_active: true }); // an active one besides Rack A3
  const unused = await named("Rack A3");
  assert.equal((await c.rpc("delete_warehouse", { p_id: unused.id })).error, null);
  assert.equal((await list()).some((w) => w.name === "Rack A3"), false);
  const withParcels = (await list()).find((w) => w.code === "A")!;
  assert.match((await c.rpc("delete_warehouse", { p_id: withParcels.id })).error.message, /has parcels/);
  const last = (await list()).find((x) => x.active !== false)!;
  const refusal = (await c.rpc("delete_warehouse", { p_id: last.id })).error.message;
  assert.match(refusal, /has parcels|at least one active/);
});

test("a parcel position is optional free text: set, change, clear, and not too long", async () => {
  const parcel = (await c.from("parcels").select("*")).data[0];
  assert.equal((await c.rpc("set_parcel_position", { p_parcel_id: parcel.id, p_position: "  Rack 3 " })).error, null);
  assert.equal((await c.from("parcels").select("*")).data.find((p: R) => p.id === parcel.id).position, "Rack 3");
  assert.equal((await c.rpc("set_parcel_position", { p_parcel_id: parcel.id, p_position: "Left wall" })).error, null);
  assert.equal((await c.rpc("set_parcel_position", { p_parcel_id: parcel.id, p_position: "   " })).error, null);
  assert.equal((await c.from("parcels").select("*")).data.find((p: R) => p.id === parcel.id).position, null);
  assert.match((await c.rpc("set_parcel_position", { p_parcel_id: parcel.id, p_position: "x".repeat(61) })).error.message, /60/);
  assert.match((await c.rpc("set_parcel_position", { p_parcel_id: "nope", p_position: "A" })).error.message, /not found/);
});

test("moving packages: a whole invoice, one package, different places; history is written; position clears", async () => {
  const wh = (await c.from("warehouses").select("*")).data as R[];
  await c.rpc("add_warehouse", { p_name: "Maxpol", p_code: null });
  await c.rpc("add_warehouse", { p_name: "Sea Prince", p_code: null });
  const maxpol = (await c.from("warehouses").select("*")).data.find((w: R) => w.name === "Maxpol");
  const sea = (await c.from("warehouses").select("*")).data.find((w: R) => w.name === "Sea Prince");
  const home = wh.find((w) => w.code === "A")!;
  await c.rpc("update_warehouse", { p_id: home.id, p_name: home.name, p_code: home.code, p_active: true });

  const bk = (await c.from("bookings").select("*")).data.find((b: R) => b.code === "BK-1003")!;
  const wsplit = await c.rpc("split_booking", { p_booking_id: bk.id, p_warehouse_id: home.id, p_parcels: [{ description: "a", weight_kg: 10 }, { description: "b", weight_kg: 10 }, { description: "c", weight_kg: 10 }] });
  assert.equal(wsplit.error, null);
  const mine = () => c.from("parcels").select("*").then((r: R) => (r.data as R[]).filter((p) => p.booking_id === bk.id && p.status === "in_warehouse").sort((x, y) => x.seq - y.seq));
  let ps = await mine();
  assert.equal(ps.length, 3);
  await c.rpc("set_parcel_position", { p_parcel_id: ps[0].id, p_position: "Rack 3" });

  // all three to one place
  assert.equal((await c.rpc("move_parcels", { p_parcel_ids: ps.map((p) => p.id), p_warehouse_id: maxpol.id })).data, 3);
  ps = await mine();
  assert.ok(ps.every((p) => p.warehouse_id === maxpol.id));
  assert.equal(ps[0].position, null); // the old position described the old place
  // one package to a different place
  assert.equal((await c.rpc("move_parcels", { p_parcel_ids: [ps[1].id], p_warehouse_id: sea.id })).data, 1);
  // and one to a third place
  assert.equal((await c.rpc("move_parcels", { p_parcel_ids: [ps[2].id], p_warehouse_id: home.id })).data, 1);
  ps = await mine();
  assert.deepEqual(ps.map((p) => p.warehouse_id), [maxpol.id, sea.id, home.id]); // three packages, three places
  // already there: nothing to do
  assert.equal((await c.rpc("move_parcels", { p_parcel_ids: [ps[0].id], p_warehouse_id: maxpol.id })).data, 0);

  const log = (await c.from("booking_events").select("*")).data.filter((e: R) => e.kind === "moved");
  assert.equal(log.length, 3);
  assert.match(log[0].reason, /Moved 3 packages from .* to Maxpol/);

  // rules
  assert.match((await c.rpc("move_parcels", { p_parcel_ids: [], p_warehouse_id: sea.id })).error.message, /at least one/);
  assert.match((await c.rpc("move_parcels", { p_parcel_ids: [ps[0].id], p_warehouse_id: "nope" })).error.message, /Choose where/);
  await c.rpc("update_warehouse", { p_id: sea.id, p_name: "Sea Prince", p_code: sea.code, p_active: false });
  assert.match((await c.rpc("move_parcels", { p_parcel_ids: [ps[0].id], p_warehouse_id: sea.id })).error.message, /not active/);
});
