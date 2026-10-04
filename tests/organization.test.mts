// The organization's legal details: validated and saved. Checked against the sample-data backend.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient } from "../src/lib/mock-supabase.ts";

const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const org = async () => (await c.from("organization").select("*").single()).data;

test("starts with AED and the UAE, and no legal name yet", async () => {
  const o = await org();
  assert.equal(o.currency, "AED");
  assert.equal(o.country, "United Arab Emirates");
  assert.equal(o.legal_name, "");
});

test("saving sets the legal name, currency and country (currency in capitals)", async () => {
  const saved = await c.rpc("set_organization", { p_legal_name: "  Mars Express Cargo LLC ", p_currency: "usd", p_country: "United Arab Emirates" });
  assert.equal(saved.error, null);
  const o = await org();
  assert.equal(o.legal_name, "Mars Express Cargo LLC");
  assert.equal(o.currency, "USD");
});

test("bad values are refused", async () => {
  assert.match((await c.rpc("set_organization", { p_legal_name: "X", p_currency: "DOLLARS", p_country: "UAE" })).error.message, /currency/);
  assert.match((await c.rpc("set_organization", { p_legal_name: "X", p_currency: "AED", p_country: "  " })).error.message, /country/);
  assert.match((await c.rpc("set_organization", { p_legal_name: "x".repeat(121), p_currency: "AED", p_country: "UAE" })).error.message, /120/);
});
