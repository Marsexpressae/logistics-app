// Swipe left/right to move between tabs. The rules live here (no screen, no browser) so they can be tested.
//
//   * a swipe is a clear sideways movement: far enough, mostly horizontal, and quick
//   * a swipe that starts at the very edge of the screen belongs to the phone (its back gesture), so it is ignored
//   * swiping left goes to the next tab, swiping right to the previous one (like turning a page)

export type SwipePoint = { x: number; y: number; t: number };

export const MIN_DISTANCE = 60; // px sideways
export const MAX_DURATION = 800; // ms
export const EDGE = 24; // px at each side of the screen that belong to the phone

export function decideSwipe(start: SwipePoint, end: SwipePoint, screenWidth: number): "next" | "previous" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (start.x < EDGE || start.x > screenWidth - EDGE) return null; // the phone's own gesture
  if (end.t - start.t > MAX_DURATION) return null; // a slow drag is not a swipe
  if (Math.abs(dx) < MIN_DISTANCE) return null; // too short
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return null; // mostly vertical: the person is scrolling
  return dx < 0 ? "next" : "previous";
}

/** The tab to go to, or null at either end (it does not wrap around). */
export function neighbour<T>(items: T[], current: T, direction: "next" | "previous"): T | null {
  const i = items.indexOf(current);
  if (i < 0) return null;
  return items[direction === "next" ? i + 1 : i - 1] ?? null;
}
