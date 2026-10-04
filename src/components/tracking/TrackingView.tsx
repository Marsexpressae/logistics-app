"use client";

import Link from "next/link";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { STATUS } from "@/lib/status";
import type { TrackedBooking } from "@/lib/types";

/** The tracking result for an invoice number or booking code. Used by the public page and by the Tracking page inside the app. */
export default function TrackingView({ code, searchHref }: { code: string; searchHref: string }) {
  const { data, error, loading } = useQuery<TrackedBooking>(() => supabase.rpc("track_booking", { p_code: code }), [code]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <ErrorMessage message={error} />;
  if (!data)
    return (
      <Card>
        <p className="text-sm">
          No booking found for <span className="font-mono font-medium">{code}</span>.{" "}
          <Link href={searchHref} className="text-blue-700">
            Try another code
          </Link>
        </p>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <p className="font-mono text-lg font-semibold">{data.invoice_no ?? data.code}</p>
        {data.invoice_no && <p className="font-mono text-xs text-slate-500">Booking {data.code}</p>}
        <p className="text-sm text-slate-500">Booked {formatDate(data.booked_at)}</p>
        <p className="mt-2 text-sm text-slate-600">
          Status: <StatusBadge status={data.status} />
        </p>
        {data.status === "cancelled" && <p className="mt-2 text-sm text-slate-600">This booking was cancelled.</p>}
        {data.status !== "cancelled" && !data.parcels.length && (
          <p className="mt-2 text-sm text-slate-600">Parcels will appear once your cargo reaches our warehouse.</p>
        )}
      </Card>

      {data.parcels.map((p) => (
        <Card key={p.barcode}>
          <div className="flex items-center justify-between">
            <span className="font-mono font-semibold">{p.barcode}</span>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-sm text-slate-500">
            {p.description ?? "Parcel"} · {Number(p.weight_kg)} kg
            {p.container ? ` · Container ${p.container}` : ""}
          </p>
          {p.status === "delivered" && (p.delivery_partner || p.delivery_tracking) && (
            <p className="mt-2 text-sm text-slate-700">
              Delivered{p.delivery_partner ? ` by ${p.delivery_partner}` : ""}
              {p.delivery_tracking ? <span className="font-mono"> · Tracking {p.delivery_tracking}</span> : null}
            </p>
          )}
          <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
            {p.events.map((ev, i) => (
              <li key={i}>
                <span className="font-medium">{STATUS[ev.status]?.label ?? ev.status}</span>
                <span className="ml-2 text-slate-500">{formatDate(ev.at)}</span>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
