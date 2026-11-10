// Send alert: a button on a colleague's profile, one database function, alerts shown with their own icon (read from the source).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("a colleague's profile has the Send alert button, but not on your own profile", () => {
  const code = read("src/app/people/[id]/page.tsx");
  assert.match(code, /person\.id !== me\.id \? <SendAlertButton/);
});

test("the dialog calls send_alert with the person and the message, and keeps the message to 300 characters", () => {
  const code = read("src/components/notifications/SendAlertButton.tsx");
  assert.match(code, /rpc\("send_alert", \{ p_to: personId, p_message: text \}\)/);
  assert.match(code, /MAX_LENGTH = 300/);
});

test("each alert is its own phone message: two alerts do not replace each other", () => {
  assert.match(read("src/app/api/push/route.ts"), /n\.kind === "alert" \? notification_id : n\.kind/);
});

test("the notifications page gives alerts their own icon", () => {
  assert.match(read("src/app/notifications/page.tsx"), /n\.kind === "alert"/);
});

test("the sample data answers send_alert like the database", () => {
  assert.ok(read("src/lib/mock-supabase.ts").includes("send_alert({ p_to, p_message })"));
});

test("migration 0069 adds only send_alert, for signed-in people, with a fixed search path", () => {
  const sql = read("supabase/migrations/0069_send_alert.sql");
  assert.match(sql, /function send_alert\(p_to uuid, p_message text\)/);
  assert.match(sql, /security definer set search_path = public/);
  assert.match(sql, /grant execute on function send_alert\(uuid, text\) to authenticated/);
  assert.equal(/alter table|drop function/i.test(sql), false, "nothing existing changes");
});
