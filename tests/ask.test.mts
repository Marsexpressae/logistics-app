// The shared question dialog: confirmAction() and askText() wait for the person's answer.
import test from "node:test";
import assert from "node:assert/strict";
import { answerAsk, askText, confirmAction, subscribeAsk, type PendingAsk } from "../src/lib/ask.ts";

test("with no dialog on screen the answer is 'no', never a hang or a surprise yes", async () => {
  assert.equal(await confirmAction({ title: "Sure?" }), false);
  assert.equal(await askText({ title: "Reason", field: { label: "Reason" } }), null);
});

test("a confirmation resolves with what the person chose", async () => {
  let seen: PendingAsk[] = [];
  const stop = subscribeAsk((q) => (seen = q));
  const yes = confirmAction({ title: "Delete?", danger: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].title, "Delete?");
  answerAsk(seen[0], true);
  assert.equal(await yes, true);

  const no = confirmAction({ title: "Delete again?" });
  answerAsk(seen[0], false);
  assert.equal(await no, false);
  assert.equal(seen.length, 0); // the line is empty again
  stop();
});

test("typed answers come back as text, and a cancel is null", async () => {
  let seen: PendingAsk[] = [];
  const stop = subscribeAsk((q) => (seen = q));
  const pw = askText({ title: "New password", field: { label: "Password", secret: true, minLength: 8 } });
  assert.equal(seen[0].field?.secret, true); // shown as dots, never in plain text
  answerAsk(seen[0], "correct horse");
  assert.equal(await pw, "correct horse");

  const reason = askText({ title: "Reason", field: { label: "Reason" } });
  answerAsk(seen[0], null);
  assert.equal(await reason, null);
  stop();
});

test("two questions at once are asked one after the other", async () => {
  let seen: PendingAsk[] = [];
  const stop = subscribeAsk((q) => (seen = q));
  const first = confirmAction({ title: "First" });
  const second = confirmAction({ title: "Second" });
  assert.deepEqual(seen.map((q) => q.title), ["First", "Second"]);
  answerAsk(seen[0], true);
  assert.equal(await first, true);
  assert.equal(seen[0].title, "Second");
  answerAsk(seen[0], false);
  assert.equal(await second, false);
  stop();
});
