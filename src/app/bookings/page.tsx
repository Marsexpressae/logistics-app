"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import RowCard from "@/components/ui/RowCard";
import ShowMore from "@/components/ui/ShowMore";
import { useWindow } from "@/lib/window";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ListSearch from "@/components/ui/ListSearch";
import { matchesSearch } from "@/lib/search";
import RowLimitNotice from "@/components/ui/RowLimitNotice";
import { ErrorMessage, StatusBadge, inputClass, Loading, Notice } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { formatDate, formatDay, money, totalPaid } from "@/lib/format";
import { bookingStage } from "@/lib/booking-stage";
import type { Booking } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "booked", label: "Booked" },
  { value: "collected", label: "Collected" },
  { value: "at_warehouse", label: "At warehouse" },
  { value: "loaded", label: "Loaded in container" },
  { value: "in_transit", label: "In transit" },
  { value: "arrived", label: "Arrived at destination" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
];

function BookingsContent() {
  const { data, error, loading } = useQuery<Booking[]>(() =>
    supabase
      .from("bookings")
      .select("*, driver:drivers(name), payments(amount), parcels(status)")
      .order("pickup_date", { ascending: false })
      .order("created_at", { ascending: false })
  );
  const canCreate = usePermissions().can("bookings.create");
  const [search, setSearch] = useState("");
  const params = useSearchParams();
  const initial = params.get("status") ?? "all";
  const created = params.get("created");
  const [status, setStatus] = useState(STATUS_FILTERS.some((f) => f.value === initial) ? initial : "all");

  const rows = (data ?? []).filter(
    (b) =>
      (status === "all" || bookingStage(b.status, b.parcels) === status) &&
      matchesSearch(
        search,
        [b.code, b.invoice_no, b.sender_name, b.receiver_name, b.pickup_area, b.pickup_address, b.receiver_address, b.notes, b.driver?.name],
        [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp]
      )
  );
  const win = useWindow(rows);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Bookings" description="Customer shipment bookings." />
        {canCreate && (
          <Link
            href="/bookings/new"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> New booking
          </Link>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <ListSearch value={search} onChange={setSearch} placeholder="Invoice, booking, name or phone" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={`${inputClass} w-auto`}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {created && <Notice className="mb-3">Booking {created} created.</Notice>}
      <ErrorMessage message={error} />
      <RowLimitNotice count={data?.length} what="bookings" effect="older ones will not appear here. Use Search, or tell the developer." />
      {loading ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState message={data?.length ? "No bookings match your filters." : "No bookings yet."} />
      ) : (
        <>
        {/* Phones: one big card per booking. Wide screens: the table below. */}
        <ul className="space-y-3 md:hidden">
          {win.shown.map((b) => {
            const paid = totalPaid(b.payments);
            return (
              <RowCard key={b.id} href={`/bookings/${b.id}`}>
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-mono text-lg font-semibold text-brand-700">{b.invoice_no ?? b.code}</span>
                    {b.invoice_no && <span className="block font-mono text-sm text-slate-600">{b.code}</span>}
                  </span>
                  <StatusBadge large status={bookingStage(b.status, b.parcels)} />
                </span>
                <span className="mt-1 block text-base text-slate-900">
                  {b.sender_name} → {b.receiver_name ?? <span className="text-slate-600">receiver not set</span>}
                </span>
                <span className="mt-1 block text-base text-slate-700">
                  {formatDay(b.pickup_date)} · {b.pickup_area}
                  {b.driver?.name ? ` · ${b.driver.name}` : ""}
                </span>
                <span className="mt-1 block text-base font-medium text-slate-800">
                  {b.invoice_amount !== null
                    ? `${money(paid)} / ${money(b.invoice_amount)}`
                    : `${paid > 0 ? `${money(paid)} paid · ` : ""}${b.estimated_bill !== null ? `est. ${money(b.estimated_bill)}` : "not invoiced"}`}
                </span>
                {b.status === "cancelled" && b.cancellation_reason && <span className="mt-1 block text-sm text-slate-600">{b.cancellation_reason}</span>}
              </RowCard>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Customer → Receiver</th>
                <th className="px-4 py-3">Pickup</th>
                <th className="px-4 py-3">Area</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {win.shown.map((b) => {
                const paid = totalPaid(b.payments);
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/bookings/${b.id}`} className="inline-flex min-h-11 items-center font-mono font-medium text-brand-700">
                        {b.code}
                      </Link>
                      {b.invoice_no && <span className="block font-mono text-xs text-slate-500">{b.invoice_no}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {b.sender_name} → {b.receiver_name ?? <span className="text-slate-500">receiver not set</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDay(b.pickup_date)}</td>
                    <td className="px-4 py-3">{b.pickup_area}</td>
                    <td className="px-4 py-3">{b.driver?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={bookingStage(b.status, b.parcels)} />
                      {b.status === "cancelled" && b.cancellation_reason && (
                        <p className="mt-1 max-w-48 text-xs text-slate-500" title={b.cancellation_reason}>
                          {b.cancellation_reason.length > 40 ? `${b.cancellation_reason.slice(0, 40)}…` : b.cancellation_reason}
                        </p>
                      )}
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
        <ShowMore remaining={win.remaining} onClick={win.showMore} what="bookings" />
        </>
      )}
    </>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={null}>
      <BookingsContent />
    </Suspense>
  );
}
