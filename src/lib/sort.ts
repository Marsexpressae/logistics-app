/**
 * Sorting for the lists (Bookings, Containers ...). Pure rules, no screen code, so they can be tested.
 *
 * - Text ignores capitals and sorts numbers inside text as numbers, so BK-9 comes before BK-10.
 * - Numbers sort as numbers, dates as dates (a day written YYYY-MM-DD sorts correctly as plain text).
 * - Empty values always go LAST, whichever way you sort, so "no driver" never crowds the top.
 * - Rows that tie keep the order they came in (the list's normal order), so the result is predictable.
 */
export type SortDir = "asc" | "desc";
export type SortKind = "text" | "number" | "date";

export type SortColumn<T> = {
  key: string;
  label: string;
  kind?: SortKind; // default text
  value?: (row: T) => string | number | null | undefined; // not needed when the database does the sorting
  firstDir?: SortDir; // the direction of the first click. Text starts A to Z; numbers and dates start biggest/newest first.
  hint?: string; // for example "Sorts by the amount still to pay"
  words?: [string, string]; // how the two directions read in the phone dropdown, when the usual words do not fit
};

export const firstDirOf = <T,>(c: SortColumn<T>): SortDir => c.firstDir ?? (c.kind === "number" || c.kind === "date" ? "desc" : "asc");

const empty = (v: unknown) => v === null || v === undefined || v === "";

export function compareValues(a: string | number, b: string | number, kind: SortKind = "text"): number {
  if (kind === "number") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export function sortRows<T>(rows: T[], column: SortColumn<T> | undefined, dir: SortDir): T[] {
  if (!column?.value) return rows;
  const sign = dir === "asc" ? 1 : -1;
  const valueOf = column.value;
  return rows
    .map((row, index) => ({ row, index, v: valueOf(row) }))
    .sort((x, y) => {
      if (empty(x.v) && empty(y.v)) return x.index - y.index;
      if (empty(x.v)) return 1; // empty last, in both directions
      if (empty(y.v)) return -1;
      return sign * compareValues(x.v as string | number, y.v as string | number, column.kind) || x.index - y.index;
    })
    .map((x) => x.row);
}

/** A position in a fixed order (for example Booked, Collected, At warehouse ...), so status sorts by progress, not by letter. */
export const orderOf = (order: readonly string[], value: string | null | undefined) => {
  const i = order.indexOf(value ?? "");
  return i === -1 ? order.length : i;
};

/** Booking stages, from first to last. */
export const STAGE_ORDER = ["booked", "collected", "at_warehouse", "loaded", "in_transit", "arrived", "delivered", "returned", "cancelled"] as const;
/** Container stages, from first to last. */
export const CONTAINER_ORDER = ["loading", "departed", "arrived"] as const;
