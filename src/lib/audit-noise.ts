import type { AuditEntry } from "./types.ts";

/**
 * Moving an item up or down in a packing list writes "position" changes to the change log (two per move). They are
 * bookkeeping, not news, so the Activity screens leave them out. They stay in the database. A move that came together
 * with a real change (a weight, a description) is kept.
 */
export function isPositionMove(e: AuditEntry): boolean {
  if (e.table_name !== "booking_items" || e.action !== "update") return false;
  const keys = Object.keys(e.changes ?? {}).filter((k) => k !== "updated_at");
  return keys.length === 1 && keys[0] === "position";
}

export const withoutNoise = (entries: AuditEntry[]): AuditEntry[] => entries.filter((e) => !isPositionMove(e));
