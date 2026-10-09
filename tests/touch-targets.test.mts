// Tap targets: a mouse may get tighter 40px controls, but a touch screen keeps 44px at any width.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|css)$/.test(p) ? [p] : [];
  });
}

test("every tighter 40px control (sm:min-h-10) also keeps 44px for touch (coarse:min-h-11)", () => {
  const offenders = files("src")
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ f, code: readFileSync(f, "utf8") }))
    .filter(({ code }) => code.includes("sm:min-h-10") && !code.includes("coarse:min-h-11"))
    .map(({ f }) => f);
  assert.deepEqual(offenders, []);
});

test("the coarse variant is defined once, for touch screens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /@custom-variant coarse \(@media \(pointer: coarse\)\)/);
});
