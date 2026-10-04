"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Undo2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Parcel, ReturnForm, Warehouse } from "@/lib/types";

type Tab = "intake" | "unpacked" | "packed" | "returns";
type StockParcel = Parcel & { booking: { code: string; invoice_no: string | null } };

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "intake", label: "Intake", hint: "Collected cargo waiting to be received into the warehouse." },
  { key: "unpacked", label: "Unpacked", hint: "Received parcels, as the driver collected them." },
  { key: "packed", label: "Packed", hint: "Parcels the warehouse repacked or consolidated, with new labels." },
  { key: "returns", label: "Returns", hint: "Cargo going back to the customer, with the signed return form." },
];

function WarehouseContent() {
  const router = useRouter();
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === asked) ? (asked as Tab) : "intake");
  const [filter, setFilter] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canOperate = usePermissions().can("warehouse.manage");

  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const awaiting = useQuery<Booking[]>(() => supabase.from("bookings").select("*").eq("status", "collected").order("collected_at"));
  const parcels = useQuery<StockParcel[]>(() =>
    supabase
      .from("parcels")
      .select("*, warehouse:warehouses(code), booking:bookings(code, invoice_no)")
      .in("status", ["in_warehouse", "ready_for_return"]) // both are physically in the warehouse
      .order("barcode")
  );
  const returns = useQuery<ReturnForm[]>(() =>
    supabase.from("returns").select("*, booking:bookings(code, invoice_no, sender_name)").order("created_at", { ascending: false }).limit(30)
  );

  // Unpacked = as collected (first round). Packed = repacked by the warehouse (a later round).
  const stock = parcels.data ?? [];
  const unpacked = stock.filter((p) => (p.round ?? 1) <= 1);
  const packed = stock.filter((p) => (p.round ?? 1) > 1);
  const openReturns = (returns.data ?? []).filter((r) => r.status === "open").length;
  const counts: Record<Tab, number> = {
    intake: awaiting.data?.length ?? 0,
    unpacked: unpacked.length,
    packed: packed.length,
    returns: openReturns,
  };

  // A return form covers the parcels of one booking.
  const pickedBookings = new Set(stock.filter((p) => picked.includes(p.id)).map((p) => p.booking_id));
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

  const renderParcels = (list: StockParcel[], empty: string) => {
    const visible = list.filter((p) => filter === "all" || p.warehouse?.code === filter);
    return (
      <>
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
          <EmptyState message={empty} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {canOperate && <th className="w-8 px-4 py-3"></th>}
                  <th className="px-4 py-3">Invoice</th>
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
                    <td className="px-4 py-3 font-mono text-xs">{p.booking?.invoice_no ?? p.booking?.code}</td>
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
  };

  return (
    <>
      <PageHeader title="Warehouse" description="Receive cargo, then unpack, pack and return." />
      <ErrorMessage message={awaiting.error ?? parcels.error ?? returns.error} />

      <div role="tablist" className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {t.label}
            <span className={`ml-2 rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/25" : "bg-slate-100 text-slate-600"}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-slate-500">{TABS.find((t) => t.key === tab)!.hint}</p>

      {tab === "intake" && (
        <Card id="awaiting-intake">
          {!awaiting.data?.length ? (
            <p className="text-sm text-slate-500">No collected bookings waiting.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {awaiting.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-mono font-medium">{b.invoice_no ?? b.code}</span>{" "}
                    <span className="font-mono text-xs text-slate-500">{b.invoice_no ? b.code : ""}</span> · {b.sender_name} →{" "}
                    {b.receiver_name ?? "receiver not set"}
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
      )}

      {tab === "unpacked" && renderParcels(unpacked, "No unpacked parcels in the warehouse.")}
      {tab === "packed" && renderParcels(packed, "Nothing has been repacked yet.")}

      {tab === "returns" && (
        <Card>
          {!returns.data?.length ? (
            <p className="text-sm text-slate-500">No returns yet. Tick parcels in Unpacked or Packed, then press Return selected.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {returns.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-mono font-medium">{r.code}</span> · {r.booking?.invoice_no ?? r.booking?.code} · {r.booking?.sender_name}
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
          )}
        </Card>
      )}
    </>
  );
}

export default function WarehouseInventoryPage() {
  return (
    <Suspense fallback={null}>
      <WarehouseContent />
    </Suspense>
  );
}
