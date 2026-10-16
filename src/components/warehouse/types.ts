import { Boxes, Package, PackageCheck, Undo2, type LucideIcon } from "lucide-react";
import type { Parcel } from "@/lib/types";

export type Tab = "intake" | "unpacked" | "packed" | "returns";
export type StockParcel = Parcel & { booking: { code: string; invoice_no: string | null; sender_name: string } };

// Each tab has its own colour and icon, so staff can recognise it without reading (used by the big tiles on phones).
export const TABS: { key: Tab; label: string; hint: string; icon: LucideIcon; tile: string; tileOn: string }[] = [
  { key: "intake", label: "Intake", hint: "Collected cargo waiting to be received into the warehouse.", icon: PackageCheck,
    tile: "border-orange-400 bg-orange-50 text-orange-900", tileOn: "border-orange-700 bg-orange-700 text-white" },
  { key: "unpacked", label: "Unpacked", hint: "Received parcels, as the driver collected them.", icon: Boxes,
    tile: "border-blue-400 bg-blue-50 text-blue-900", tileOn: "border-blue-700 bg-blue-700 text-white" },
  { key: "packed", label: "Packed", hint: "Parcels the warehouse repacked or consolidated, with new labels.", icon: Package,
    tile: "border-emerald-500 bg-emerald-50 text-emerald-900", tileOn: "border-emerald-700 bg-emerald-700 text-white" },
  { key: "returns", label: "Returns", hint: "Cargo going back to the customer, with the signed return form.", icon: Undo2,
    tile: "border-rose-400 bg-rose-50 text-rose-900", tileOn: "border-rose-700 bg-rose-700 text-white" },
];
