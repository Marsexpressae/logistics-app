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
