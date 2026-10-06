// Choosing a new password: the rules, and the messages people see.
import test from "node:test";
import assert from "node:assert/strict";
import { checkNewPassword } from "../src/lib/password.ts";

test("a good new password passes", () => {
  assert.equal(checkNewPassword("old-secret", "a-better-one-9", "a-better-one-9", "amir@example.com"), null);
});

test("each rule gives its own plain message", () => {
  assert.match(checkNewPassword("", "longenough1", "longenough1") ?? "", /current password/);
  assert.match(checkNewPassword("old", "short", "short") ?? "", /at least 8/);
  assert.match(checkNewPassword("samesame1", "samesame1", "samesame1") ?? "", /different/);
  assert.match(checkNewPassword("old", "aaaaaaaaaa", "aaaaaaaaaa") ?? "", /repetitive/);
  assert.match(checkNewPassword("old", "amir-2026-xx", "amir-2026-xx", "amir@example.com") ?? "", /email name/);
  assert.match(checkNewPassword("old-secret", "a-better-one-9", "a-better-one-8") ?? "", /not the same/);
});
