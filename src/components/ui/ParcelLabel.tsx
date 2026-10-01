"use client";

import Barcode from "react-barcode";
import { site } from "@/config/site";

type ParcelLabelProps = {
  barcode: string;
  description?: string | null;
  weightKg?: number;
  warehouse?: string | null;
};

// One printable label; the barcode value is the parcel barcode, e.g. BK-1001-P2.
export default function ParcelLabel({ barcode, description, weightKg, warehouse }: ParcelLabelProps) {
  return (
    <div className="break-inside-avoid rounded-md border border-slate-300 bg-white p-3 text-center text-xs">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{site.name}</p>
      <Barcode value={barcode} height={50} fontSize={14} margin={0} />
      <p className="mt-1 text-slate-600">
        {description || "—"} · {Number(weightKg ?? 0)} kg{warehouse ? ` · WH ${warehouse}` : ""}
      </p>
    </div>
  );
}
