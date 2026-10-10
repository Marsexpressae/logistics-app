/**
 * The stage a booking shows on screen.
 *
 * A booking itself only knows four stages (booked, collected, at warehouse, cancelled). After it reaches the warehouse its
 * real progress lives in its parcels, so the screens work the stage out from them, and it can never disagree with the parcels:
 *
 * - Every current parcel returned to the customer      -> "returned"
 * - Otherwise the LEAST advanced parcel decides, so cargo still in the warehouse keeps the booking "At warehouse"
 *   (a partial return, or part of it shipped), and the booking only becomes "In transit" once every parcel has left, and so on:
 *   at warehouse -> loaded in a container -> in transit -> arrived -> delivered.
 *
 * Returned parcels do not hold a booking back: if 2 of 5 are returned and the other 3 are delivered, it shows "Delivered".
 * Parcels that were repacked are history, not cargo, so they are ignored. Without parcel information (no permission to see
 * parcels, or none created yet) the stored stage is shown unchanged.
 */
const PROGRESS = ["at_warehouse", "loaded", "in_transit", "arrived", "delivered"] as const;
const RANK: Record<string, number> = { in_warehouse: 0, ready_for_return: 0, loaded: 1, in_transit: 2, arrived: 3, delivered: 4 };

export function bookingStage(status: string, parcels?: { status: string }[] | null): string {
  if (status !== "at_warehouse" || !parcels?.length) return status;
  const current = parcels.filter((p) => p.status !== "repacked");
  if (!current.length) return status;
  if (current.every((p) => p.status === "returned")) return "returned";
  const moving = current.filter((p) => p.status !== "returned");
  const least = Math.min(...moving.map((p) => RANK[p.status] ?? 0));
  return PROGRESS[least];
}
