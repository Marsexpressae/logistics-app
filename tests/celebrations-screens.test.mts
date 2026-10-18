// The celebration screens follow the project rules and the safety rules of the spec (read from the source, like rewards-screens.test.mts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const host = () => readFileSync("src/components/celebrations/CelebrationHost.tsx", "utf8");

test("the celebration host is mounted once in the app shell", () => {
  assert.ok(readFileSync("src/components/layout/AppShell.tsx", "utf8").includes("CelebrationHost"));
});

test("the host draws one canvas that never takes a tap, stops its loop, respects the device, and never throws into the caller", () => {
  const code = host();
  for (const needle of ["pointer-events-none", "aria-hidden", "z-(--z-toast)", "cancelAnimationFrame", "visibilitychange", "prefers-reduced-motion", "COOLDOWN_MS", "DURATION_MS", "isLightDevice", "chooseStyle", "shouldCelebrate", "onCelebrate", "onPreview", "Math.min(window.devicePixelRatio"]) {
    assert.ok(code.includes(needle), `the host should use ${needle}`);
  }
  assert.equal(/\bz-\d/.test(code), false, "no raw z-index number");
  assert.equal(/gradient/.test(code), false);
  assert.match(code, /try \{/);
  assert.match(code, /role="status"/);
  assert.match(code, /aria-live="polite"/);
  assert.match(code, /min-h-11/, "the Close button is 44px");
});

test("the device switch is on My profile and keeps its choice in browser storage safely", () => {
  assert.ok(readFileSync("src/app/account/page.tsx", "utf8").includes("DeviceToggle"));
  const toggle = readFileSync("src/components/celebrations/DeviceToggle.tsx", "utf8");
  assert.match(toggle, /try \{/);
  assert.ok(toggle.includes("localStorage") && toggle.includes("celebrations-off"));
  assert.ok(host().includes("celebrations-off"), "the host reads the same key");
  assert.match(toggle, /Celebrations on this device/);
});
