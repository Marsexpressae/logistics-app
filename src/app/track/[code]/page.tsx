"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import BrandMark from "@/components/brand/BrandMark";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { site } from "@/config/site";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { STATUS } from "@/lib/status";
import type { TrackedBooking } from "@/lib/types";

// Public page: no login. Data comes from the track_booking() database function only.
export default function TrackingPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const { data, error, loading } = useQuery<TrackedBooking>(() => supabase.rpc("track_booking", { p_code: code }), [code]);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2 pt-2">
        <BrandMark size={32} />
        <div>
          <p className="text-sm font-semibold leading-tight text-blue-700">{site.name}</p>
          <h1 className="text-xl font-semibold leading-tight">Cargo tracking</h1>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <ErrorMessage message={error} />
      ) : !data ? (
        <Card>
          <p className="text-sm">
            No booking found for <span className="font-mono font-medium">{code}</span>.{" "}
            <Link href="/track" className="text-blue-700">
              Try another code
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="font-mono text-lg font-semibold">{data.code}</p>
            <p className="text-sm text-slate-500">Booked {formatDate(data.booked_at)}</p>
            {!data.parcels.length && (
              <p className="mt-2 text-sm text-slate-600">
                Status: <StatusBadge status={data.status} />. Parcels will appear once your cargo reaches our warehouse.
              </p>
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
        </>
      )}
    </div>
  );
}
