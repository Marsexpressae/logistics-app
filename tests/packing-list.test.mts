// The packing list (order, serial numbers, move up and down), checked against the sample-data backend, which mirrors
// migration 0060 (the same rules run against the real database in db-tests/rules.test.mts).
// Seed data: BK-1002 has two items (Suitcase, Carton box), BK-1003 has one (Mixed goods).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const booking = async (code: string): Promise<R> => (await c.from("bookings").select("*").eq("code", code).single()).data;
// the read the pages use
const list = async (b: R): Promise<R[]> => (await c.from("booking_items").select("*").eq("booking_id", b.id).order("position").order("id")).data;
const names = async (b: R) => (await list(b)).map((i) => i.description);
const add = (b: R, description: string) => c.from("booking_items").insert({ booking_id: b.id, description, quantity: 1, weight_kg: 5 });
const move = (item: R, direction: string) => c.rpc("move_booking_item", { p_item_id: item.id, p_direction: direction });

test("seed items have positions in order, and a new item goes last", async () => {
  const b = await booking("BK-1002");
  assert.deepEqual((await list(b)).map((i) => [i.description, i.position]), [["Suitcase", 1], ["Carton box", 2]]);
  assert.equal((await add(b, "Third")).error, null);
  assert.deepEqual((await list(b)).map((i) => [i.description, i.position]).at(-1), ["Third", 3]);
  const other = await booking("BK-1003");
  assert.deepEqual((await list(other)).map((i) => i.position), [1]);
});

test("up and down swap with the neighbour", async () => {
  const b = await booking("BK-1002");
  let items = await list(b); // Suitcase, Carton box, Third
  assert.equal((await move(items[1], "up")).error, null);
  assert.deepEqual(await names(b), ["Carton box", "Suitcase", "Third"]);
  items = await list(b);
  assert.equal((await move(items[0], "down")).error, null);
  assert.deepEqual(await names(b), ["Suitcase", "Carton box", "Third"]);
});

test("the edges and bad input are refused and change nothing", async () => {
  const b = await booking("BK-1002");
  const items = await list(b);
  const before = await names(b);
  const refused = async (item: R, dir: string, pattern: RegExp) => {
    assert.match((await move(item, dir)).error?.message ?? "NOT REFUSED", pattern);
    assert.deepEqual(await names(b), before);
  };
  await refused(items[0], "up", /It is already first/);
  await refused(items[2], "down", /It is already last/);
  await refused(items[1], "sideways", /Direction must be up or down/);
  await refused({ id: crypto.randomUUID() }, "up", /Item not found/);
});

test("other bookings are untouched, and repeated moves give the expected order", async () => {
  const b = await booking("BK-1002");
  const other = await booking("BK-1003");
  for (const n of ["Fourth", "Fifth"]) await add(b, n);
  const otherBefore = await names(other);
  let items = await list(b); // Suitcase, Carton box, Third, Fourth, Fifth
  await move(items[4], "up");
  items = await list(b);
  await move(items[3], "up");
  assert.deepEqual(await names(b), ["Suitcase", "Carton box", "Fifth", "Third", "Fourth"]);
  assert.deepEqual(await names(other), otherBefore);
  const positions = (await list(b)).map((i) => i.position);
  assert.equal(new Set(positions).size, positions.length, "positions stay distinct");
});

test("removing an item leaves the others in order", async () => {
  const b = await booking("BK-1002");
  const items = await list(b); // Suitcase, Carton box, Fifth, Third, Fourth
  await c.from("booking_items").delete().eq("id", items[2].id);
  assert.deepEqual(await names(b), ["Suitcase", "Carton box", "Third", "Fourth"]);
});

// ---- the screens, checked as source ----
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(f, "utf8");

test("the card is called Packing list, shows serial numbers and has move up and down buttons", () => {
  const card = read("src/components/bookings/ItemsCard.tsx");
  assert.ok(card.includes('title="Packing list"') && !card.includes("Package items"));
  assert.ok(card.includes('"move_booking_item"') && card.includes('"up"') && card.includes('"down"'));
  assert.ok(card.includes("`Move ${") && card.includes("n + 1"), "serial number and button labels");
  assert.ok(card.includes("ArrowUp") && card.includes("ArrowDown"));
});

test("every screen that reads the items puts them in packing-list order", () => {
  for (const f of ["src/app/bookings/[id]/page.tsx", "src/app/pickups/[id]/page.tsx", "src/app/pickups/[id]/receipt/page.tsx", "src/app/warehouse-inventory/split/[bookingId]/page.tsx"]) {
    assert.ok(read(f).includes('.order("position").order("id")'), `${f} orders by position`);
  }
});

test("the printed receipt has a # column with the serial number", () => {
  const code = read("src/app/pickups/[id]/receipt/page.tsx");
  assert.match(code, /<th[^>]*>#<\/th>/);
  assert.ok(code.includes("n + 1"));
  assert.ok(code.includes("colSpan={3}"), "the total row spans the new column");
});

test("long item descriptions wrap instead of running under the buttons", () => {
  const card = read("src/components/bookings/ItemsCard.tsx");
  assert.ok(card.includes("min-w-0 break-words"));
});
