/**
 * Where does a person open a job (a booking or invoice)?
 * Office staff open the booking, the pickup team opens the pickup, the warehouse team opens the receive screen.
 */
export function jobHref(can: (permission: string) => boolean, bookingId: string): string | null {
  if (can("bookings.view")) return `/bookings/${bookingId}`;
  if (can("pickups.view_all") || can("pickups.view_own")) return `/pickups/${bookingId}`;
  if (can("warehouse.manage")) return `/warehouse-inventory/split/${bookingId}`;
  return null;
}

/** The result of global_search(): a few matches per kind, and how many there are in total. */
export type SearchBooking = {
  id: string;
  code: string;
  invoice_no: string | null;
  sender_name: string;
  receiver_name: string | null;
  sender_phone: string | null;
  status: string;
  pickup_date: string;
  pickup_area: string;
  pay_status: "not_invoiced" | "unpaid" | "partial" | "paid" | null;
};
export type SearchParcel = {
  id: string;
  barcode: string;
  description: string | null;
  weight_kg: number;
  status: string;
  position: string | null;
  booking_id: string;
  invoice_no: string | null;
  booking_code: string;
  sender_name: string;
  place: string | null;
};
export type SearchContainer = { id: string; code: string; destination: string | null; status: string };
export type SearchCustomer = { id: string; full_name: string; phone: string | null; address: string | null; invoices: number; last_invoice: string | null };
export type SearchResult = {
  bookings: SearchBooking[];
  parcels: SearchParcel[];
  containers: SearchContainer[];
  customers?: SearchCustomer[];
  customers_total?: number;
  bookings_total: number;
  parcels_total: number;
  containers_total: number;
};
export const EMPTY_RESULT: SearchResult = { bookings: [], parcels: [], containers: [], bookings_total: 0, parcels_total: 0, containers_total: 0 };
