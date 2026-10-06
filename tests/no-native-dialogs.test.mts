// The browser's own pop-ups (alert, confirm, prompt) cannot be styled, hide nothing, and are hard to use on a phone.
// Everything goes through the shared dialog in src/lib/ask.ts instead. This test fails if one slips back in.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mts)$/.test(name) ? [p] : [];
  });
}

test("no screen uses alert(), confirm() or prompt()", () => {
  const offenders = files("src").flatMap((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .flatMap((line, i) => (/(^|[^\w.])(window\.)?(alert|confirm|prompt)\(/.test(line) && !/confirmAction|askText|^\s*(\/\/|\*)/.test(line) ? [`${p}:${i + 1}`] : []))
  );
  assert.deepEqual(offenders, []);
});
