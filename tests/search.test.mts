// The shared list search: several words, capitals, and phone numbers in any format.
import test from "node:test";
import assert from "node:assert/strict";
import { matchesSearch } from "../src/lib/search.ts";

const fields = ["INV-3603", "BK-802", "Mubeen Akhtar", "Hamid Ahmed Hassan", "Dubai", "Legacy invoice"];
const phones = ["+971553221017", null, "+923304157192"];

test("an empty search matches everything", () => {
  assert.equal(matchesSearch("", fields, phones), true);
  assert.equal(matchesSearch("   ", fields, phones), true);
});

test("text matches in any field, ignoring capitals", () => {
  assert.equal(matchesSearch("inv-3603", fields), true);
  assert.equal(matchesSearch("mubeen", fields), true);
  assert.equal(matchesSearch("DUBAI", fields), true);
  assert.equal(matchesSearch("karachi", fields), false);
});

test("several words must all be found, in any fields", () => {
  assert.equal(matchesSearch("mubeen dubai", fields), true);
  assert.equal(matchesSearch("mubeen sharjah", fields), false);
  assert.equal(matchesSearch("hamid 3603", fields), true);
});

test("phone numbers match however they are typed", () => {
  for (const typed of ["0553221017", "55 322 1017", "+971553221017", "971 55 322 1017"]) assert.equal(matchesSearch(typed, fields, phones), true, typed);
  assert.equal(matchesSearch("0330 4157192", fields, phones), true);
  assert.equal(matchesSearch("0501112233", fields, phones), false);
});

test("a few digits are not enough to match a phone number", () => {
  assert.equal(matchesSearch("55", [], phones), false);
});

test("words and a phone number can be combined", () => {
  assert.equal(matchesSearch("mubeen 3221017", fields, phones), true);
  assert.equal(matchesSearch("zzz 3221017", fields, phones), false);
});

test("digits inside a code are not mistaken for a phone number", () => {
  assert.equal(matchesSearch("inv-3221", [], phones), false);
  assert.equal(matchesSearch("inv-3221017", [], phones), false);
  assert.equal(matchesSearch("3221017", [], phones), true);
});
