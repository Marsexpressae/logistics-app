// Every page in the app must be covered by an access rule. A page without one would be open to every signed-in person
// (the data stays protected, but the screen should not be). Public pages (login, tracking) are the only exceptions.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canAccess, hasAccessRule } from "../src/config/navigation.ts";

function pages(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "api" || name === "icons") return [];
      return pages(full, `${base}/${name}`);
    }
    return name === "page.tsx" ? [base || "/"] : [];
  });
}

const PUBLIC = ["/login", "/track", "/track/[code]"];

test("every page has an access rule (except the public ones)", () => {
  const found = pages("src/app").filter((p) => !PUBLIC.includes(p));
  assert.ok(found.length >= 15, "the page list was read");
  for (const route of found) {
    const sample = route.replace(/\[[^\]]+\]/g, "sample-id");
    assert.equal(hasAccessRule(sample), true, `${route} has no access rule`);
  }
});

test("an address that is not a page has no rule, so it shows Page not found", () => {
  assert.equal(hasAccessRule("/no-such-page"), false);
  assert.equal(hasAccessRule("/settings-secret"), false);
});

test("the account page is open to everyone who is signed in, whatever their role", () => {
  assert.equal(canAccess([], "/account"), true);
  assert.equal(canAccess(["pickups.view_own"], "/account"), true);
  assert.equal(canAccess([], "/accounts"), false); // not to be confused with the Accounts (money) page
});

test("a known page still needs its permission", () => {
  assert.equal(canAccess([], "/accounts"), false);
  assert.equal(canAccess(["accounts.view"], "/accounts"), true);
  assert.equal(canAccess(["bookings.view"], "/settings/roles"), false);
  assert.equal(canAccess(["roles.manage"], "/settings/roles"), true);
});

test("Tracking sits right after Accounts in the menu, and Settings can hide it", async () => {
  const { navItems } = await import("../src/config/navigation.ts");
  const labels = navItems.map((i) => i.label);
  assert.equal(labels[labels.indexOf("Accounts") + 1], "Tracking");
  assert.equal(navItems.find((i) => i.label === "Tracking")!.setting, "show_tracking_menu");
});
