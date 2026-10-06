"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanLine, X } from "lucide-react";
import CameraScanner from "@/components/scan/CameraScanner";
import ParcelPosition from "@/components/warehouse/ParcelPosition";
import { Button, Card, StatusBadge } from "@/components/ui/form";
import { jobHref } from "@/lib/job-link";
import { kg } from "@/lib/format";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type Found = {
  id: string;
  barcode: string;
  description: string | null;
  weight_kg: number;
  status: string;
  position: string | null;
  booking_id: string;
  warehouse: { name: string; code: string } | null;
  booking: { code: string; invoice_no: string | null; sender_name: string } | null;
};

/**
 * A big "Scan a parcel" button. After a scan it shows what the parcel is (invoice, customer, place, position, status)
 * with a button to open its invoice. Staff never need to search or type.
 */
export default function ScanParcel() {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ code: string; parcel: Found | null; failed: boolean } | null>(null);

  async function lookup(code: string) {
    const { data, error } = await supabase
      .from("parcels")
      .select("*, warehouse:warehouses(name, code), booking:bookings(code, invoice_no, sender_name)")
      .eq("barcode", code)
      .maybeSingle();
    setResult({ code, parcel: (data as Found | null) ?? null, failed: !!error });
  }

  const p = result?.parcel;
  const href = p ? jobHref(can, p.booking_id) : null;

  return (
    <div className="mb-4 space-y-3">
      <Button size="large" onClick={() => setOpen(true)}>
        <ScanLine className="h-6 w-6" aria-hidden="true" /> Scan a parcel
      </Button>
      <CameraScanner open={open} onClose={() => setOpen(false)} onCode={lookup} />

      {result && (
        <Card>
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-lg font-semibold">{result.code}</p>
            <button type="button" aria-label="Clear the scan result" onClick={() => setResult(null)} className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {result.failed ? (
            <p role="alert" className="mt-2 text-base text-red-800">
              Could not look it up. Check the connection and try again.
            </p>
          ) : !p ? (
            <p role="status" className="mt-2 text-base text-slate-800">
              No parcel with this barcode. Check the label, or scan again.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-semibold text-brand-700">{p.booking?.invoice_no ?? p.booking?.code}</span>
                <StatusBadge large status={p.status} />
              </p>
              <p className="text-base text-slate-900">{p.booking?.sender_name}</p>
              <p className="text-base text-slate-700">
                {p.description ?? "—"} · {kg(Number(p.weight_kg))}
              </p>
              <p className="text-base text-slate-700">
                Place: <span className="font-medium">{p.warehouse?.name ?? "not in a warehouse"}</span>
              </p>
              <p className="flex items-center gap-1 text-base text-slate-700">
                Position: <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit={can("warehouse.manage")} onChanged={() => lookup(p.barcode)} />
              </p>
              {href && (
                <Link href={href} className="flex min-h-14 items-center justify-center rounded-md border-2 border-brand-600 text-base font-semibold text-brand-700 active:bg-brand-50">
                  Open the invoice
                </Link>
              )}
            </div>
          )}
          <Button size="large" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
            <ScanLine className="h-6 w-6" aria-hidden="true" /> Scan another
          </Button>
        </Card>
      )}
    </div>
  );
}
