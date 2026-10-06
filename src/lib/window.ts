import { useState } from "react";

export const PAGE_SIZE = 50;

/**
 * Long lists show 50 at a time with a "Show more" button, so a phone is never asked to draw hundreds of cards at once.
 * (The database still sends everything up to its 1,000-row limit; the warning for that is RowLimitNotice.)
 */
export function useWindow<T>(list: T[], step = PAGE_SIZE) {
  const [limit, setLimit] = useState(step);
  return {
    shown: list.slice(0, limit),
    remaining: Math.max(0, list.length - limit),
    total: list.length,
    showMore: () => setLimit((n) => n + step),
  };
}
