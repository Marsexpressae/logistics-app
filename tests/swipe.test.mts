// The swipe rules: what counts as a swipe, what is left to the phone, and moving between tabs.
import test from "node:test";
import assert from "node:assert/strict";
import { decideSwipe, neighbour } from "../src/lib/swipe.ts";

const W = 390; // a phone
const at = (x: number, y: number, t: number) => ({ x, y, t });

test("a clear swipe left goes to the next tab, right to the previous", () => {
  assert.equal(decideSwipe(at(300, 400, 0), at(180, 410, 200), W), "next");
  assert.equal(decideSwipe(at(100, 400, 0), at(240, 395, 200), W), "previous");
});

test("a short movement is not a swipe", () => {
  assert.equal(decideSwipe(at(200, 400, 0), at(160, 400, 100), W), null);
});

test("scrolling up or down is not a swipe", () => {
  assert.equal(decideSwipe(at(200, 600, 0), at(120, 300, 200), W), null); // mostly vertical
  assert.equal(decideSwipe(at(200, 500, 0), at(130, 470, 200), W), "next"); // slightly diagonal is still a swipe
});

test("a slow drag is not a swipe", () => {
  assert.equal(decideSwipe(at(300, 400, 0), at(150, 400, 1500), W), null);
});

test("a swipe starting at the screen edge belongs to the phone", () => {
  assert.equal(decideSwipe(at(10, 400, 0), at(150, 400, 200), W), null); // left edge: the back gesture
  assert.equal(decideSwipe(at(W - 10, 400, 0), at(200, 400, 200), W), null); // right edge
});

test("moving between tabs stops at the ends and never wraps around", () => {
  const areas = ["all", "Dubai", "Abu Dhabi", "Sharjah", "Ajman"];
  assert.equal(neighbour(areas, "Dubai", "next"), "Abu Dhabi");
  assert.equal(neighbour(areas, "Dubai", "previous"), "all");
  assert.equal(neighbour(areas, "all", "previous"), null);
  assert.equal(neighbour(areas, "Ajman", "next"), null);
  assert.equal(neighbour(areas, "unknown", "next"), null);
});
