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

test("the rewards settings page is reachable by the right people and built from sortable tables and one give form", () => {
  assert.ok(existsSync("src/app/settings/rewards/page.tsx"), "the settings page is missing");
  for (const f of ["RulesTable", "LevelsTable", "BadgesTable", "GiveForm"]) assert.ok(existsSync(`${dir}/${f}.tsx`), `${f} is missing`);
  for (const f of ["RulesTable", "LevelsTable", "BadgesTable"]) {
    const code = readFileSync(`${dir}/${f}.tsx`, "utf8");
    assert.ok(code.includes("SortableTh") && code.includes("useSort"), `${f} needs sortable headings`);
    assert.equal(/<th className="px-4 py-3/.test(code), false, `${f} has a heading that cannot be sorted`);
  }
  assert.ok(readFileSync("src/app/settings/page.tsx", "utf8").includes("/settings/rewards"), "Settings should link to it");
  for (const key of ["rewards.give", "rewards.manage"]) assert.ok(readFileSync("src/config/navigation.ts", "utf8").includes(key));
});

// ---- fixes after the whole-branch review ----
test("Settings shows only on/off settings as switches (the rewards limits are numbers)", () => {
  const code = readFileSync("src/app/settings/page.tsx", "utf8");
  assert.match(code, /typeof s\.value === "boolean"/);
});

test("a colleague's page does not show their point reasons, and the saved note is not lost when a row reloads", () => {
  assert.equal(readFileSync("src/app/people/[id]/page.tsx", "utf8").includes("PointsList"), false);
  for (const [f, key] of [["RulesTable", "r.key"], ["LevelsTable", "l.number"], ["BadgesTable", "b.key"]]) {
    const code = readFileSync(`${dir}/${f}.tsx`, "utf8");
    assert.ok(code.includes(`key={${key}}`), `${f} rows should be keyed by ${key} only`);
  }
  assert.equal(readFileSync(`${dir}/LevelsTable.tsx`, "utf8").includes("Nobody ever loses a level"), false);
  assert.equal(readFileSync("src/app/settings/rewards/page.tsx", "utf8").includes("Nobody ever loses a level"), false);
});

test("managers can set a person's team, job title and joined date from the rewards settings", () => {
  const code = readFileSync(`${dir}/StaffDetailsTable.tsx`, "utf8");
  assert.ok(code.includes("set_staff_details") && code.includes("SortableTh") && code.includes("useSort"));
  assert.ok(readFileSync("src/app/settings/rewards/page.tsx", "utf8").includes("StaffDetailsTable"));
});

// ---- team medals: the look ----
test("the medal pieces exist, the wall groups badges into families, and the header shows the emblem and flame", () => {
  for (const f of ["Medal", "LevelEmblem", "StreakFlame"]) assert.ok(existsSync(`${dir}/${f}.tsx`), `${f} is missing`);
  const wall = readFileSync(`${dir}/BadgeGrid.tsx`, "utf8");
  assert.ok(wall.includes("groupBadges") && wall.includes("Medal"), "the wall is built from the family groups and medals");
  const header = readFileSync(`${dir}/ProfileHeader.tsx`, "utf8");
  assert.ok(header.includes("LevelEmblem") && header.includes("StreakFlame"));
  const medal = readFileSync(`${dir}/Medal.tsx`, "utf8");
  assert.match(medal, /role="img"/);
  assert.match(medal, /aria-label/);
  assert.ok(medal.includes("medalColors"));
});

test("the medal pieces are flat: no gradients, shadows or raw z-index", () => {
  for (const f of ["Medal", "LevelEmblem", "StreakFlame", "BadgeGrid"]) {
    const code = readFileSync(`${dir}/${f}.tsx`, "utf8");
    assert.equal(/gradient|shadow-/.test(code), false, `${f} should use flat colours`);
    assert.equal(/\bz-\d/.test(code), false);
  }
});

// ---- team medals: the Team page ----
test("the Team page shows colleagues as cards that open their profile, with no points", () => {
  for (const f of ["src/app/team/page.tsx", `${dir}/TeamCard.tsx`, `${dir}/AchievementsList.tsx`]) assert.ok(existsSync(f), `${f} is missing`);
  const card = readFileSync(`${dir}/TeamCard.tsx`, "utf8");
  assert.ok(card.includes("/people/") && card.includes("LevelEmblem") && card.includes("StreakFlame") === false);
  const page = readFileSync("src/app/team/page.tsx", "utf8");
  assert.ok(page.includes("team_overview") && page.includes("TeamCard"));
  for (const code of [card, page]) assert.equal(/\.total\b|points/i.test(code.replace(/\/\/.*$/gm, "")), false, "the Team page never shows points");
  const colleague = readFileSync("src/app/people/[id]/page.tsx", "utf8");
  assert.ok(colleague.includes("AchievementsList") && !colleague.includes("PointsList") && !colleague.includes("ProfileEditor"));
  assert.match(readFileSync("src/lib/profile-context.tsx", "utf8"), /p === "\*"/, "menu checks understand the everyone rule");
});
