export type Customer = {
  id: string;
  full_name: string;
  phone: string | null;
  whatsapp: string | null; // only set when different from the phone
  address: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  emirates_id: string | null;
  warning_note: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

/** A customer as the search and the list return it. */
export type CustomerHit = {
  id: string;
  full_name: string;
  phone: string | null;
  whatsapp?: string | null;
  address: string | null;
  geo_lat?: number | null;
  geo_lng?: number | null;
  emirates_id?: string | null;
  invoices: number;
  last_invoice: string | null;
};

export type TimelineRow = {
  r_at: string;
  r_kind: "booking" | "event" | "package" | "payment" | "item" | "invoice" | "note" | "link" | "customer";
  r_title: string;
  r_detail: string | null;
  r_booking_id: string | null;
  r_invoice: string | null;
  r_actor: string | null;
};

export type ContactRole = "customer" | "booker" | "receiver";
export const ROLE_LABEL: Record<ContactRole, string> = { customer: "Customer (sender)", booker: "Booker", receiver: "Receiver" };

export type BookingWithoutCustomer = {
  id: string;
  code: string;
  invoice_no: string | null;
  sender_name: string;
  sender_phone: string | null;
  pickup_address: string;
  status: string;
  created_at: string;
};

/** A Google Maps link for a customer: the exact pin when saved, otherwise a search for the address. */
export function customerMapsUrl(c: { geo_lat?: number | null; geo_lng?: number | null; address?: string | null }): string | null {
  if (c.geo_lat != null && c.geo_lng != null) return `https://www.google.com/maps/search/?api=1&query=${c.geo_lat},${c.geo_lng}`;
  if (c.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`;
  return null;
}

export type ReceiverEntry = { id: string; receiver_id: string; name: string; phone: string | null; whatsapp: string | null; address: string | null };

export type DuplicateGroup = {
  kind: "phone" | "emirates_id";
  value: string;
  customers: { id: string; full_name: string; phone: string | null; emirates_id: string | null; address: string | null; invoices: number }[];
};

export type IdDocument = {
  id: string;
  booking_id: string;
  emirates_id: string | null;
  photo_path: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};
