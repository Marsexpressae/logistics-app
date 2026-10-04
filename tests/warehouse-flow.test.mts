// Runs the whole flow against the sample-data backend (src/lib/mock-supabase.ts), which mirrors the database rules.
// It does not run the SQL itself. The steps share one in-memory database, so they run in order.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rows = async (t: string): Promise<R[]> => (await c.from(t).select("*")).data;
const rpc = (name: string, args: object) => c.rpc(name, args);
const booking = async (code: string) => (await rows("bookings")).find((x) => x.code === code)!;

test("invoice numbers: first payment issues one, collecting keeps it, numbers are not reused", async () => {
  const b = await booking("BK-1001");
  assert.equal(b.invoice_no, undefined);
  await c.from("payments").insert({ booking_id: b.id, amount: 100, method: "cash" });
  const after = await booking("BK-1001");
  assert.match(after.invoice_no, /^INV-\d+$/);
  const pay = (await rows("payments")).find((p) => p.booking_id === b.id)!;
  assert.equal(pay.invoice_no, after.invoice_no);
  await c.from("bookings").update({ status: "collected" }).eq("id", b.id);
  assert.equal((await booking("BK-1001")).invoice_no, after.invoice_no);
  const numbers = (await rows("bookings")).map((x) => x.invoice_no).filter(Boolean);
  assert.equal(new Set(numbers).size, numbers.length);
});

test("repack keeps history and uses new barcodes; negative weights are refused", async () => {
  const b = await booking("BK-1003");
  const wh = (await rows("warehouses"))[0];
  const bad = await rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: wh.id, p_parcels: [{ description: "x", weight_kg: -1 }] });
  assert.match(bad.error.message, /negative/);
  const ok = await rpc("split_booking", {
    p_booking_id: b.id,
    p_warehouse_id: wh.id,
    p_parcels: [
      { description: "A", weight_kg: 10 },
      { description: "B", weight_kg: 10 },
      { description: "C", weight_kg: 20 },
    ],
  });
  assert.equal(ok.data, 3);
  const ps = (await rows("parcels")).filter((p) => p.booking_id === b.id);
  assert.equal(ps.filter((p) => p.status === "repacked").length, 2);
  const live = ps.filter((p) => p.status === "in_warehouse");
  assert.deepEqual(live.map((p) => p.barcode), ["BK-1003-R2-P1", "BK-1003-R2-P2", "BK-1003-R2-P3"]);
  assert.equal(new Set(ps.map((p) => p.barcode)).size, ps.length); // no clashing labels
  const old = ps.find((p) => p.status === "repacked")!;
  const cont = (await rows("containers")).find((x) => x.status === "loading")!;
  const load = await rpc("load_parcel", { p_container_id: cont.id, p_barcode: old.barcode });
  assert.match(load.error.message, /repacked/);
});

test("container check flags a missing parcel; departure needs a reason", async () => {
  const b = await booking("BK-1003");
  const cont = (await rows("containers")).find((x) => x.status === "loading")!;
  const live = (await rows("parcels")).filter((p) => p.booking_id === b.id && p.status === "in_warehouse");
  for (const p of live.slice(0, 2)) assert.equal((await rpc("load_parcel", { p_container_id: cont.id, p_barcode: p.barcode })).error, null);
  const check = (await rpc("container_check", { p_container_id: cont.id })).data[0];
  assert.equal(check.expected, 3);
  assert.equal(check.loaded, 2);
  assert.deepEqual(check.missing, ["BK-1003-R2-P3"]);
  const blocked = await rpc("depart_container", { p_container_id: cont.id });
  assert.match(blocked.error.message, /^PARCELS_MISSING/);
  const ok = await rpc("depart_container", { p_container_id: cont.id, p_override_reason: "Third box next week" });
  assert.equal(ok.error, null);
  const log = (await rows("booking_events")).filter((e) => e.kind === "departed_with_missing");
  assert.equal(log.length, 1);
  assert.match(log[0].reason, /Third box next week/);
});

test("payment before loading: blocked when on, override needs a reason and is logged", async () => {
  await c.from("app_settings").update({ value: true }).eq("key", "require_payment_before_loading");
  const wh = (await rows("warehouses"))[0];
  const b = await booking("BK-1002"); // invoice 800, only 400 paid
  let parcel = (await rows("parcels")).find((p) => p.booking_id === b.id && p.status === "in_warehouse");
  if (!parcel) {
    await rpc("split_booking", { p_booking_id: b.id, p_warehouse_id: wh.id, p_parcels: [{ description: "Z", weight_kg: 5 }] });
    parcel = (await rows("parcels")).find((p) => p.booking_id === b.id && p.status === "in_warehouse");
  }
  const cont = (await c.from("containers").insert({ destination: "Test" }).select("*").single()).data;
  const refused = await rpc("load_parcel", { p_container_id: cont.id, p_barcode: parcel!.barcode });
  assert.match(refused.error.message, /^PAYMENT_REQUIRED/);
  const allowed = await rpc("load_parcel", { p_container_id: cont.id, p_barcode: parcel!.barcode, p_override_reason: "Pays on arrival" });
  assert.equal(allowed.error, null);
  const log = (await rows("booking_events")).filter((e) => e.kind === "loaded_without_payment");
  assert.equal(log.length, 1);
});

test("returns: prepare, complete, cannot complete twice", async () => {
  const first = (await rows("parcels")).filter((p) => p.status === "in_warehouse")[0];
  const mixed = await rpc("prepare_return", { p_booking_id: first.booking_id, p_parcel_ids: [first.id, "nope"] });
  assert.match(mixed.error.message, /Only parcels/);
  const rid = (await rpc("prepare_return", { p_booking_id: first.booking_id, p_parcel_ids: [first.id] })).data;
  assert.equal((await rows("parcels")).find((p) => p.id === first.id)!.status, "ready_for_return");
  const cont = (await rows("containers")).find((x) => x.status === "loading")!;
  assert.match((await rpc("load_parcel", { p_container_id: cont.id, p_barcode: first.barcode })).error.message, /not in a warehouse/);
  assert.match((await rpc("complete_return", { p_return_id: rid, p_received_by: " " })).error.message, /name/);
  assert.equal((await rpc("complete_return", { p_return_id: rid, p_received_by: "Ismail" })).error, null);
  assert.equal((await rows("parcels")).find((p) => p.id === first.id)!.status, "returned");
  assert.match((await rpc("complete_return", { p_return_id: rid, p_received_by: "x" })).error.message, /already completed/);
});

test("notes: a mention reaches the colleague; only valid people are listed", async () => {
  const b = (await rows("bookings")).find((x) => x.code === "BK-1002")!;
  const people = (await rpc("mentionable_users", { p_booking_id: b.id })).data;
  assert.ok(people.length > 0);
  assert.ok(!people.some((p: R) => p.id === "mock-user")); // you cannot mention yourself
  const target = people[0];
  const saved = await c.from("booking_notes").insert({ booking_id: b.id, body: `Customer wants it after 4pm @${target.full_name}`, mentions: [target.id] });
  assert.equal(saved.error, null);
  const note = (await rows("booking_notes"))[0];
  assert.equal(note.author_name.length > 0, true);
  const alert = (await rows("notifications")).find((n) => n.kind === "note_mention" && n.user_id === target.id);
  assert.match(alert!.title, /mentioned you on INV-/);
  assert.match(alert!.body, /after 4pm/);
});
