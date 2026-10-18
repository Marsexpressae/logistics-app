// The staff rewards screens follow the project rules (read from the source, like touch-targets.test.mts and sort.test.mts).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { progressPercent } from "../src/lib/rewards.ts";

const dir = "src/components/rewards";
const rewardsFiles = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => `${dir}/${f}`) : []);
const pages = ["src/app/account/page.tsx", "src/app/people/[id]/page.tsx"];
const screens = () => [...rewardsFiles(), ...pages.filter(existsSync)];

test("progressPercent: how far along to the next level, and full at the top", () => {
  assert.equal(progressPercent({ total: 150, level_min: 100, next_min: 300 }), 25);
  assert.equal(progressPercent({ total: 0, level_min: 0, next_min: 100 }), 0);
  assert.equal(progressPercent({ total: 99999, level_min: 12000, next_min: null }), 100);
});

test("the profile screens exist and use the shared pieces", () => {
  for (const f of ["ProfileHeader", "LevelBar", "BadgeGrid", "PointsList", "ProfileEditor"]) assert.ok(existsSync(`${dir}/${f}.tsx`), `${f} is missing`);
  assert.ok(existsSync("src/app/people/[id]/page.tsx"), "the colleague page is missing");
  const account = readFileSync("src/app/account/page.tsx", "utf8");
  assert.ok(account.includes("ProfileHeader") && account.includes("BadgeGrid") && account.includes("ProfileEditor"), "My profile should show the header, badges and the editor");
  const colleague = readFileSync("src/app/people/[id]/page.tsx", "utf8");
  assert.ok(colleague.includes("ProfileHeader") && colleague.includes("BadgeGrid") && !colleague.includes("ProfileEditor"), "a colleague's page is read-only");
});

test("the rewards screens use no raw z-index numbers, and hints are 14px, not 12px", () => {
  for (const f of screens()) {
    const code = readFileSync(f, "utf8");
    assert.equal(/\bz-\d/.test(code), false, `${f} has a raw z-index`);
    assert.equal(/<p[^>]*text-xs[^>]*text-slate-[56]00|<p[^>]*text-slate-[56]00[^>]*text-xs/.test(code), false, `${f} has a 12px hint paragraph`);
  }
});

test("the points list has sortable headings and no plain ones", () => {
  const code = readFileSync(`${dir}/PointsList.tsx`, "utf8");
  assert.ok(code.includes("SortableTh") && code.includes("useSort"));
  assert.equal(/<th className="px-4 py-3/.test(code), false);
});

test("buttons on the rewards screens use the shared Button (44px) or carry a 44px class", () => {
  for (const f of screens()) {
    const code = readFileSync(f, "utf8");
    for (const m of code.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /min-h-11|min-h-12/, `${f}: ${m[0].slice(0, 80)} is under 44px`);
  }
});

test("feature tracking is mounted once in the app shell, scanning counts when a parcel is looked up, and the feed is on the dashboard", () => {
  assert.ok(readFileSync("src/components/layout/AppShell.tsx", "utf8").includes("FeatureUseTracker"));
  assert.ok(readFileSync("src/components/scan/ScanParcel.tsx", "utf8").includes('recordFeature("use_scan")'));
  assert.ok(readFileSync("src/app/page.tsx", "utf8").includes("WinsFeed"));
  const toast = readFileSync(`${dir}/FeatureUseTracker.tsx`, "utf8");
  assert.ok(toast.includes("z-(--z-toast)"), "the badge toast sits on the named toast layer");
  assert.match(toast, /localStorage/);
  assert.match(toast, /try \{/, "browser storage is wrapped in try/catch");
});
