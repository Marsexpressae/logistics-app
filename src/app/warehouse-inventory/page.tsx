"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Parcel, ReturnForm, Warehouse } from "@/lib/types";

export default function WarehouseInventoryPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canOperate = usePermissions().can("warehouse.manage");

  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const awaiting = useQuery<Booking[]>(() =>
    supabase.from("bookings").select("*").eq("status", "collected").order("collected_at")
  );
  const parcels = useQuery<(Parcel & { booking: { code: string } })[]>(() =>
    supabase
      .from("parcels")
      .select("*, warehouse:warehouses(code), booking:bookings(code)")
      .in("status", ["in_warehouse", "ready_for_return"]) // both are physically in the warehouse
      .order("barcode")
  );
  const returns = useQuery<ReturnForm[]>(() =>
    supabase.from("returns").select("*, booking:bookings(code, sender_name)").order("created_at", { ascending: false }).limit(8)
  );

  // A return form covers the parcels of one booking.
  const pickedParcels = (parcels.data ?? []).filter((p) => picked.includes(p.id));
  const pickedBookings = new Set(pickedParcels.map((p) => p.booking_id));
  const oneBooking = pickedBookings.size === 1;
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function prepareReturn() {
    setBusy(true);
    setReturnError(null);
    const { data, error } = await supabase.rpc("prepare_return", { p_booking_id: [...pickedBookings][0], p_parcel_ids: picked });
    setBusy(false);
    if (error) return setReturnError(error.message);
    router.push(`/warehouse-inventory/returns/${data}`);
  }

  const visible = parcels.data?.filter((p) => filter === "all" || p.warehouse?.code === filter) ?? [];

  return (
    <>
      <PageHeader title="Warehouse" description="Receive collected packages, then print their labels." />
      <ErrorMessage message={awaiting.error ?? parcels.error} />

      <Card id="awaiting-intake" title="Awaiting warehouse intake" className="mb-6 scroll-mt-4">
        {!awaiting.data?.length ? (
          <p className="text-sm text-slate-500">No collected bookings waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {awaiting.data.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono font-medium">{b.code}</span> · {b.sender_name} → {b.receiver_name ?? "receiver not set"}
                </span>
                {canOperate && (
                  <Link href={`/warehouse-inventory/split/${b.id}`} className="font-medium text-blue-700">
                    Receive
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!!returns.data?.length && (
        <Card title="Returns" className="mb-6">
          <ul className="divide-y divide-slate-100 text-sm">
            {returns.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono font-medium">{r.code}</span> · {r.booking?.code} · {r.booking?.sender_name}
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={r.status} />
                  {canOperate && (
                    <Link href={`/warehouse-inventory/returns/${r.id}`} className="font-medium text-blue-700">
                      {r.status === "open" ? "Form" : "View"}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        {[{ code: "all", name: "All" }, ...(warehouses.data ?? []).map((w) => ({ code: w.code, name: w.name }))].map((w) => (
          <button
            key={w.code}
            onClick={() => setFilter(w.code)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === w.code ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {w.name}
          </button>
        ))}
      </div>

      {canOperate && picked.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
          <span>
            {picked.length} selected
            {!oneBooking && <span className="ml-2 text-orange-800">Select parcels from one booking per return form.</span>}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setPicked([])} disabled={busy}>
              Clear
            </Button>
            <Button onClick={prepareReturn} disabled={busy || !oneBooking}>
              <Undo2 className="h-4 w-4" /> {busy ? "Preparing…" : "Return selected"}
            </Button>
          </span>
        </div>
      )}
      <ErrorMessage message={returnError} />

      {!visible.length ? (
        <EmptyState message="No parcels in the warehouse." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {canOperate && <th className="w-8 px-4 py-3"></th>}
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Weight</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((p) => (
                <tr key={p.id}>
                  {canOperate && (
                    <td className="px-4 py-3">
                      {p.status === "in_warehouse" && (
                        <input type="checkbox" aria-label={`Select ${p.barcode} for return`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono font-medium">{p.barcode}</td>
                  <td className="px-4 py-3">{p.description ?? "—"}</td>
                  <td className="px-4 py-3">{Number(p.weight_kg)} kg</td>
                  <td className="px-4 py-3">{p.warehouse?.code}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3">
                    {canOperate && (
                      <Link href={`/warehouse-inventory/split/${p.booking_id}`} className="text-blue-700">
                        Labels
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
