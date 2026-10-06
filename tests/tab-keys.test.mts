// Arrow keys move between tabs, like every tab strip on the web.
import test from "node:test";
import assert from "node:assert/strict";
import { nextTabIndex } from "../src/lib/tab-keys.ts";

test("right and down go to the next tab, and wrap from the last to the first", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 4), 1);
  assert.equal(nextTabIndex("ArrowDown", 2, 4), 3);
  assert.equal(nextTabIndex("ArrowRight", 3, 4), 0);
});

test("left and up go to the previous tab, and wrap from the first to the last", () => {
  assert.equal(nextTabIndex("ArrowLeft", 2, 4), 1);
  assert.equal(nextTabIndex("ArrowUp", 1, 4), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 4), 3);
});

test("Home and End jump to the ends; other keys are left alone", () => {
  assert.equal(nextTabIndex("Home", 2, 4), 0);
  assert.equal(nextTabIndex("End", 0, 4), 3);
  assert.equal(nextTabIndex("Enter", 1, 4), null);
  assert.equal(nextTabIndex("a", 1, 4), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});
