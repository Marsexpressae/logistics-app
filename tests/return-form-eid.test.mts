// The return form shows the customer's ID under the mobile number (read from the source).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const page = () => read("src/app/warehouse-inventory/returns/[id]/page.tsx");

test("the printed form puts the customer's ID right under the mobile number, before the address", () => {
  const code = page();
  assert.ok(code.includes("return_customer_eid"), "the number comes from the database function, not a direct read of customers");
  assert.equal(/from\("customers"\)|from\("id_documents"\)/.test(code), false, "warehouse staff may not see those tables");
  const phone = code.indexOf("formatPhone(r.booking?.sender_phone");
  const eid = code.indexOf("ID: ", phone);
  const address = code.indexOf("r.booking?.pickup_area");
  assert.ok(phone > 0 && eid > phone && eid < address, "ID line sits between the phone and the address");
});

test("the signature area and the hand-over box stay as they were", () => {
  const code = page();
  assert.equal(code.includes("received_by_eid") || code.includes("p_received_eid"), false);
});

test("the sample data answers return_customer_eid like the database", () => {
  assert.ok(read("src/lib/mock-supabase.ts").includes("return_customer_eid"));
});

test("migration 0068 adds only the read function, for warehouse staff, with a fixed search path", () => {
  const sql = read("supabase/migrations/0068_return_customer_eid.sql");
  assert.match(sql, /function return_customer_eid\(p_return_id uuid\)/);
  assert.match(sql, /has_perm\('warehouse\.view'\) or has_perm\('warehouse\.manage'\)/);
  assert.match(sql, /security definer set search_path = public/);
  assert.equal(/alter table|drop function/i.test(sql), false, "nothing existing changes");
});
