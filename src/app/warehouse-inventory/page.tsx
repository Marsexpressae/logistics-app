"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { canOperateWarehouse } from "@/config/navigation";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Parcel, Warehouse } from "@/lib/types";

export default function WarehouseInventoryPage() {
  const [filter, setFilter] = useState("all");
  const canOperate = canOperateWarehouse(useCurrentProfile().role);

  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const awaiting = useQuery<Booking[]>(() =>
    supabase.from("bookings").select("*").eq("status", "collected").order("collected_at")
  );
  const parcels = useQuery<(Parcel & { booking: { code: string } })[]>(() =>
    supabase
      .from("parcels")
      .select("*, warehouse:warehouses(code), booking:bookings(code)")
      .eq("status", "in_warehouse")
      .order("barcode")
  );

  const visible = parcels.data?.filter((p) => filter === "all" || p.warehouse?.code === filter) ?? [];

  return (
    <>
      <PageHeader title="Warehouse Inventory" description="Receive collected packages and split them into parcels." />
      <ErrorMessage message={awaiting.error ?? parcels.error} />

      <Card title="Awaiting warehouse intake" className="mb-6">
        {!awaiting.data?.length ? (
          <p className="text-sm text-slate-500">No collected bookings waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {awaiting.data.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono font-medium">{b.code}</span> · {b.sender_name} → {b.receiver_name}
                </span>
                {canOperate && (
                  <Link href={`/warehouse-inventory/split/${b.id}`} className="font-medium text-blue-700">
                    Receive & split
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

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

      {!visible.length ? (
        <EmptyState message="No parcels in the warehouse." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
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
                        Labels / re-split
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
