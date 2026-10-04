// Roles are data now (the roles table); the key is e.g. "super_admin", "manager", "staff".
export type Role = string;
export type Profile = { id: string; full_name: string; role: Role; active: boolean };

export type PaymentMethod = "cash" | "bank_transfer";
export type BookingStatus = "booked" | "collected" | "at_warehouse" | "cancelled";
export type ParcelStatus = "in_warehouse" | "loaded" | "in_transit" | "arrived" | "delivered" | "repacked" | "ready_for_return" | "returned";
export type ContainerStatus = "loading" | "departed" | "arrived";

export type Driver = { id: string; name: string; phone: string | null; user_id: string | null };
export type Warehouse = { id: string; code: string; name: string };

export type Payment = {
  id: string;
  booking_id: string;
  amount: number;
  method: PaymentMethod;
  invoice_no: string | null;
  received_by_driver: string | null;
  note: string | null;
  created_at: string;
};

export type BookingItem = {
  id: string;
  booking_id: string;
  description: string;
  quantity: number;
  weight_kg: number;
};

export type Booking = {
  id: string;
  code: string;
  invoice_no: string | null; // issued when the pickup is collected
  sender_name: string;
  sender_phone: string | null;
  sender_whatsapp: string | null; // only set when different from sender_phone
  receiver_name: string | null; // optional at booking time
  receiver_phone: string | null;
  receiver_whatsapp: string | null;
  receiver_address: string | null;
  pickup_area: string;
  pickup_address: string;
  pickup_date: string; // YYYY-MM-DD
  geo_lat: number | null;
  geo_lng: number | null;
  driver_id: string | null;
  status: BookingStatus;
  estimated_bill: number | null; // approximate, known at booking
  invoice_amount: number | null; // real bill, known once invoiced
  notes: string | null;
  created_at: string;
  collected_at: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  updated_at: string; // version stamp used to detect edit conflicts
  driver?: { name: string } | null;
  payments?: Payment[];
};

export type Parcel = {
  id: string;
  booking_id: string;
  seq: number;
  round?: number; // 1 = as collected, 2+ = repacked by the warehouse
  barcode: string;
  description: string | null;
  weight_kg: number;
  status: ParcelStatus;
  warehouse_id: string | null;
  container_id: string | null;
  warehouse?: { code: string } | null;
};

export type Container = {
  id: string;
  code: string;
  destination: string | null;
  status: ContainerStatus;
  departed_at: string | null;
  created_at: string;
  parcels?: { count: number }[];
};

export type TrackedParcel = {
  barcode: string;
  description: string | null;
  weight_kg: number;
  status: ParcelStatus;
  warehouse: string | null;
  container: string | null;
  updated_at: string;
  events: { status: string; at: string }[];
};

export type TrackedBooking = {
  code: string;
  invoice_no: string | null;
  status: BookingStatus;
  booked_at: string;
  parcels: TrackedParcel[];
};

export type AuditEntry = {
  id: number;
  table_name: string;
  row_id: string | null;
  booking_id: string | null;
  action: "insert" | "update" | "delete";
  actor_name: string | null;
  changed_at: string;
  changes: Record<string, unknown>; // insert/delete: the row; update: { column: { old, new } }
};

export type RoleRow = { key: string; label: string; description: string; sort: number };
export type PermissionRow = { key: string; group_name: string; label: string; description: string; sort: number };

export type BookingEvent = {
  id: string;
  booking_id: string;
  kind: "rescheduled" | "cancelled" | "loaded_without_payment" | "departed_with_missing" | "returned";
  reason: string;
  old_date: string | null;
  new_date: string | null;
  actor_name: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  booking_id: string | null;
  kind: string;
  title: string;
  body: string;
  actor_name: string | null;
  created_at: string;
  read_at: string | null;
};

export type ReturnForm = {
  id: string;
  code: string;
  booking_id: string;
  status: "open" | "completed" | "cancelled";
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by_name: string | null;
  received_by_name: string | null;
  booking?: Pick<Booking, "code" | "invoice_no" | "sender_name" | "sender_phone" | "pickup_address" | "pickup_area"> | null;
  parcels?: Parcel[];
};

export type BookingNote = {
  id: string;
  booking_id: string;
  author_id: string;
  author_name: string;
  body: string;
  mentions: string[];
  created_at: string;
};
