"use client";

import { useEffect, useRef } from "react";
import { decideSwipe, type SwipePoint } from "./swipe";

// Things a finger may start on that must keep their own behaviour: typing, choosing, and anything marked data-no-swipe.
const KEEP = 'input, textarea, select, [contenteditable="true"], [data-no-swipe]';

/** Does this element, or a parent inside the container, scroll sideways right now (for example a wide table on a phone)? */
function insideSideScroller(start: Element | null, container: HTMLElement): boolean {
  for (let el: Element | null = start; el && el !== container; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrolls = style.overflowX === "auto" || style.overflowX === "scroll";
    if (scrolls && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/**
 * Swipe left or right on the element this ref is attached to. Phones and tablets only (a mouse never fires these events).
 * It never blocks scrolling: a finger moving up or down, or on a table that scrolls sideways, behaves as normal.
 */
export function useSwipe(onSwipe: (direction: "next" | "previous") => void) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(onSwipe);
  useEffect(() => {
    latest.current = onSwipe;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: SwipePoint | null = null;

    const onStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (e.touches.length !== 1 || target?.closest(KEEP) || insideSideScroller(target, el)) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.changedTouches.length === 0) return;
      const end = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY, t: Date.now() };
      const direction = decideSwipe(start, end, window.innerWidth);
      start = null;
      if (direction) latest.current(direction);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", () => (start = null), { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);

  return ref;
}
