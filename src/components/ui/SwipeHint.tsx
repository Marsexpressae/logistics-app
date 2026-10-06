"use client";

import { useEffect, useState } from "react";
import { MoveHorizontal, X } from "lucide-react";

const SHOWN_LIMIT = 3;

const readCount = (key: string) => {
  try {
    return Number(localStorage.getItem(key) ?? 0);
  } catch {
    return 0; // storage can be blocked; then the hint simply shows
  }
};

/**
 * A small one-line hint for the swipe gesture. Phones only, shown on the first three visits, never again after that
 * or once it is dismissed.
 */
export default function SwipeHint({ id, children }: { id: string; children: string }) {
  const key = `swipe-hint-${id}`;
  const [visible, setVisible] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && readCount(key) < SHOWN_LIMIT
  );

  useEffect(() => {
    if (!visible) return;
    try {
      localStorage.setItem(key, String(readCount(key) + 1));
    } catch {
      // not saved, so it may show again: harmless
    }
  }, [visible, key]);

  if (!visible) return null;
  return (
    <p className="mb-3 flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800 md:hidden">
      <MoveHorizontal className="h-4 w-4 shrink-0" />
      <span className="flex-1">{children}</span>
      <button
        aria-label="Hide this hint"
        onClick={() => {
          try {
            localStorage.setItem(key, String(SHOWN_LIMIT));
          } catch {
            // ignore
          }
          setVisible(false);
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <X className="h-5 w-5" />
      </button>
    </p>
  );
}
