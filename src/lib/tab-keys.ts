/**
 * Keyboard movement for a row of tabs (the WAI-ARIA tabs pattern): arrows move to the next or previous tab and wrap round,
 * Home and End jump to the first and last. Returns the tab to select, or null when the key is not a tab key.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
