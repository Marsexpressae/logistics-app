"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDate, money, totalPaid } from "@/lib/format";
import type { Booking } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "booked", label: "Booked" },
  { value: "collected", label: "Collected" },
  { value: "at_warehouse", label: "At warehouse" },
  { value: "cancelled", label: "Cancelled" },
];

export default function BookingsPage() {
  const { data, error, loading } = useQuery<Booking[]>(() =>
    supabase
      .from("bookings")
      .select("*, driver:drivers(name), payments(amount)")
      .order("created_at", { ascending: false })
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const term = search.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (b) =>
      (status === "all" || b.status === status) &&
      (!term ||
        [b.code, b.sender_name, b.receiver_name, b.sender_phone, b.receiver_phone]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(term)))
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Bookings" description="Customer shipment bookings." />
        <Link
          href="/bookings/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New booking
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name or phone"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-auto`}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <ErrorMessage message={error} />
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !rows.length ? (
        <EmptyState message={data?.length ? "No bookings match your filters." : "No bookings yet."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Sender → Receiver</th>
                <th className="px-4 py-3">Area</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => {
                const paid = totalPaid(b.payments);
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/bookings/${b.id}`} className="font-mono font-medium text-blue-700">
                        {b.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {b.sender_name} → {b.receiver_name}
                    </td>
                    <td className="px-4 py-3">{b.pickup_area}</td>
                    <td className="px-4 py-3">{b.driver?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3">
                      {b.invoice_amount !== null ? (
                        <>
                          {money(paid)} / {money(b.invoice_amount)}
                          <span className="ml-1 text-xs text-slate-500">(invoiced)</span>
                        </>
                      ) : (
                        <>
                          {paid > 0 ? `${money(paid)} paid · ` : ""}
                          <span className="text-slate-500">
                            {b.estimated_bill !== null ? `est. ${money(b.estimated_bill)}` : "not invoiced"}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
