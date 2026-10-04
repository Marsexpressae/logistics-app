// The search behind the top-bar box and the results page, checked against the sample-data backend
// (it follows the same rules as the database function global_search()).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const search = async (q: string, limit?: number) => (await c.rpc("global_search", { p_query: q, p_limit: limit ?? 6 })).data;
const codes = (r: any) => r.bookings.map((b: any) => b.invoice_no ?? b.code); // eslint-disable-line @typescript-eslint/no-explicit-any

test("less than two characters finds nothing", async () => {
  assert.equal((await search("a")).bookings_total, 0);
  assert.equal((await search("   ")).bookings_total, 0);
});

test("an invoice number, a booking code and a name find the job", async () => {
  assert.deepEqual(codes(await search("inv-1002")), ["INV-1002"]);
  assert.deepEqual(codes(await search("BK-1002")), ["INV-1001"]);
  assert.deepEqual(codes(await search("INV-1001")), ["INV-1001"]); // digits inside a code are not a phone number
  assert.ok(codes(await search("fatima")).includes("INV-1002"));
});

test("several words narrow the result", async () => {
  const both = await search("fatima deira");
  assert.ok(codes(both).includes("INV-1002"));
  assert.equal((await search("fatima sharjah")).bookings_total, 0);
});

test("a phone number matches however it was typed", async () => {
  for (const typed of ["0524005000", "52 400 5000", "+971524005000", "971 52 400 5000"]) {
    assert.ok(codes(await search(typed)).includes("INV-1002"), typed);
  }
  assert.equal((await search("0599999999")).bookings_total, 0);
});

test("packages are found by barcode, position and place", async () => {
  const any = (await search("BK-1003-P1")).parcels;
  assert.equal(any.length, 1);
  await c.rpc("set_parcel_position", { p_parcel_id: any[0].id, p_position: "Rack 9 left wall" });
  const byPosition = (await search("rack 9")).parcels;
  assert.equal(byPosition[0].barcode, "BK-1003-P1");
  assert.equal(byPosition[0].invoice_no, "INV-1002");
});

test("containers are found by code or destination", async () => {
  assert.ok((await search("CN-101")).containers.length >= 1);
  assert.ok((await search("karachi")).containers.length >= 1);
});

test("the quick results are limited, and the total says how many there are", async () => {
  for (let i = 0; i < 8; i++) {
    await c.from("bookings").insert({ sender_name: `Bulk Sender ${i}`, sender_phone: "+971501110000", pickup_area: "Dubai", pickup_address: "x", pickup_date: "2026-10-05" });
  }
  const few = await search("bulk sender", 5);
  assert.equal(few.bookings.length, 5);
  assert.equal(few.bookings_total, 8);
  assert.equal((await search("bulk sender", 25)).bookings.length, 8);
});

test("wildcard characters in the text are just text", async () => {
  assert.equal((await search("%%")).bookings_total, 0);
  assert.equal((await search("__")).bookings_total, 0);
});
