export type Role = "admin" | "staff" | "driver" | "warehouse";
export type Profile = { id: string; full_name: string; role: Role; active: boolean };

export type PaymentMethod = "cash" | "bank_transfer";
export type BookingStatus = "booked" | "collected" | "at_warehouse" | "cancelled";
export type ParcelStatus = "in_warehouse" | "loaded" | "in_transit" | "arrived" | "delivered";
export type ContainerStatus = "loading" | "departed" | "arrived";

export type Driver = { id: string; name: string; phone: string | null; user_id: string | null };
export type Warehouse = { id: string; code: string; name: string };

export type Payment = {
  id: string;
  booking_id: string;
  amount: number;
  method: PaymentMethod;
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
  sender_name: string;
  sender_phone: string | null;
  receiver_name: string;
  receiver_phone: string | null;
  receiver_address: string | null;
  pickup_area: string;
  pickup_address: string;
  driver_id: string | null;
  status: BookingStatus;
  estimated_bill: number | null; // approximate, known at booking
  invoice_amount: number | null; // real bill, known once invoiced
  notes: string | null;
  created_at: string;
  collected_at: string | null;
  driver?: { name: string } | null;
  payments?: Payment[];
};

export type Parcel = {
  id: string;
  booking_id: string;
  seq: number;
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
  status: BookingStatus;
  booked_at: string;
  parcels: TrackedParcel[];
};
