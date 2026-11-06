import type { ReturnRequest } from "./types.ts";

type PickParcel = { id: string; status: string; barcode: string; position?: string | null };

/**
 * The parcels the warehouse has to pull for a return request: the asked-for ones that are still in the warehouse
 * (all of the booking's when the request names none), in walking order: by place, then barcode, parcels with no place last.
 */
export function pickList<T extends PickParcel>(request: Pick<ReturnRequest, "parcel_ids">, parcels: T[]): T[] {
  const wanted = request.parcel_ids?.length ? new Set(request.parcel_ids) : null;
  return parcels
    .filter((p) => p.status === "in_warehouse" && (!wanted || wanted.has(p.id)))
    .sort((a, b) => {
      if (!a.position !== !b.position) return a.position ? -1 : 1;
      return (a.position ?? "").localeCompare(b.position ?? "") || a.barcode.localeCompare(b.barcode);
    });
}

/** How many of the asked-for parcels are no longer in the warehouse (moved, loaded, merged, split or returned). 0 when the request asks for all. */
export function changedCount(request: Pick<ReturnRequest, "parcel_ids">, parcels: { id: string; status: string }[]): number {
  if (!request.parcel_ids?.length) return 0;
  return request.parcel_ids.filter((id) => !parcels.some((p) => p.id === id && p.status === "in_warehouse")).length;
}

/** "INV-1002 · Fatima Noor": the one-line title of a request on both screens. */
export function requestLine(r: Pick<ReturnRequest, "booking">): string {
  const b = r.booking;
  return b ? `${b.invoice_no ?? b.code} · ${b.sender_name}` : "Booking";
}
