// The private error log: noise is ignored, repeats are counted, and the list can be cleared.
import test from "node:test";
import assert from "node:assert/strict";
import { isNoise } from "../src/lib/error-noise.ts";
import { createMockClient } from "../src/lib/mock-supabase.ts";

const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const log = (message: string) => c.rpc("log_client_error", { p_message: message, p_stack: "at x", p_path: "/bookings", p_agent: "test" });
const list = async () => (await c.from("client_errors").select("*")).data as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

test("noise from browsers and dropped connections is ignored", () => {
  for (const m of ["ResizeObserver loop completed with undelivered notifications.", "Script error.", "Failed to fetch", "Loading chunk 42 failed", "AbortError: The operation was aborted"]) {
    assert.equal(isNoise(m), true, m);
  }
  assert.equal(isNoise("Cannot read properties of undefined (reading 'id')"), false);
});

test("a real error is saved, and the same error again is counted not repeated", async () => {
  await log("Cannot read properties of undefined (reading 'id')");
  await log("Cannot read properties of undefined (reading 'id')");
  await log("Something else broke");
  const rows = await list();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.message.startsWith("Cannot read"))!.count, 2);
});

test("an empty message is not saved, and the list can be cleared", async () => {
  await log("   ");
  assert.equal((await list()).length, 2);
  assert.equal((await c.rpc("clear_client_errors")).error, null);
  assert.equal((await list()).length, 0);
});
