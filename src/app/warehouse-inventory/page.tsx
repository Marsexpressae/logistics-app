"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { kg } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Parcel, ReturnForm, Warehouse } from "@/lib/types";

type Tab = "intake" | "unpacked" | "packed" | "returns";
type StockParcel = Parcel & { booking: { code: string; invoice_no: string | null; sender_name: string } };

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
  const [open, setOpen] = useState<string[]>([]); // invoices whose packages are showing
  const [returnError, setReturnError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canOperate = usePermissions().can("warehouse.manage");

  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const awaiting = useQuery<Booking[]>(() => supabase.from("bookings").select("*").eq("status", "collected").order("collected_at"));
  const parcels = useQuery<StockParcel[]>(() =>
    supabase
      .from("parcels")
      .select("*, warehouse:warehouses(code), booking:bookings(code, invoice_no, sender_name)")
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
  const toggleOpen = (bookingId: string) => setOpen(open.includes(bookingId) ? open.filter((x) => x !== bookingId) : [...open, bookingId]);
  // Ticking an invoice ticks every package of it that can be returned.
  const toggleGroup = (list: StockParcel[]) => {
    const ids = list.filter((p) => p.status === "in_warehouse").map((p) => p.id);
    const all = ids.length > 0 && ids.every((id) => picked.includes(id));
    setPicked(all ? picked.filter((id) => !ids.includes(id)) : [...new Set([...picked, ...ids])]);
  };

  async function prepareReturn() {
    setBusy(true);
    setReturnError(null);
    const { data, error } = await supabase.rpc("prepare_return", { p_booking_id: [...pickedBookings][0], p_parcel_ids: picked });
    setBusy(false);
    if (error) return setReturnError(error.message);
    router.push(`/warehouse-inventory/returns/${data}`);
  }

  // One group per invoice (booking), in invoice order, with its packages inside.
  const groups = (list: StockParcel[]) => {
    const byBooking = new Map<string, { bookingId: string; invoice: string; code: string; customer: string; parcels: StockParcel[] }>();
    for (const p of list) {
      const g = byBooking.get(p.booking_id) ?? {
        bookingId: p.booking_id,
        invoice: p.booking?.invoice_no ?? p.booking?.code ?? "",
        code: p.booking?.code ?? "",
        customer: p.booking?.sender_name ?? "",
        parcels: [],
      };
      g.parcels.push(p);
      byBooking.set(p.booking_id, g);
    }
    return [...byBooking.values()].sort((a, b) => b.invoice.localeCompare(a.invoice, undefined, { numeric: true }));
  };

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
                  <th className="px-4 py-3">Invoice / package</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Weight</th>
                  <th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              {groups(visible).map((g) => {
                const isOpen = open.includes(g.bookingId);
                const selectable = g.parcels.filter((p) => p.status === "in_warehouse");
                const ticked = selectable.filter((p) => picked.includes(p.id)).length;
                const statuses = [...new Set(g.parcels.map((p) => p.status))];
                const places = [...new Set(g.parcels.map((p) => p.warehouse?.code).filter(Boolean))].join(", ");
                return (
                  <tbody key={g.bookingId} className="divide-y divide-slate-100 border-t border-slate-200">
                    <tr className="bg-slate-50/60">
                      {canOperate && (
                        <td className="px-4 py-3">
                          {selectable.length > 0 && (
                            <input
                              type="checkbox"
                              aria-label={`Select all packages of ${g.invoice}`}
                              checked={ticked === selectable.length}
                              ref={(el) => {
                                if (el) el.indeterminate = ticked > 0 && ticked < selectable.length;
                              }}
                              onChange={() => toggleGroup(g.parcels)}
                            />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleOpen(g.bookingId)}
                          aria-expanded={isOpen}
                          className="inline-flex items-center gap-1 font-mono font-semibold text-blue-700"
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {g.invoice}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {g.customer} · <span className="font-mono text-xs text-slate-500">{g.code}</span> ·{" "}
                        {g.parcels.length} {g.parcels.length === 1 ? "package" : "packages"}
                      </td>
                      <td className="px-4 py-3 font-medium">{kg(g.parcels.reduce((s, p) => s + Number(p.weight_kg), 0))}</td>
                      <td className="px-4 py-3">{places}</td>
                      <td className="space-x-1 px-4 py-3">
                        {statuses.map((s) => (
                          <StatusBadge key={s} status={s} />
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        {canOperate && (
                          <Link href={`/warehouse-inventory/split/${g.bookingId}`} className="text-blue-700">
                            Labels
                          </Link>
                        )}
                      </td>
                    </tr>
                    {isOpen &&
                      g.parcels.map((p) => (
                        <tr key={p.id}>
                          {canOperate && (
                            <td className="px-4 py-2.5">
                              {p.status === "in_warehouse" && (
                                <input type="checkbox" aria-label={`Select ${p.barcode} for return`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                              )}
                            </td>
                          )}
                          <td className="py-2.5 pl-10 pr-4 font-mono font-medium">{p.barcode}</td>
                          <td className="px-4 py-2.5">{p.description ?? "—"}</td>
                          <td className="px-4 py-2.5">{kg(Number(p.weight_kg))}</td>
                          <td className="px-4 py-2.5">{p.warehouse?.code}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="px-4 py-2.5"></td>
                        </tr>
                      ))}
                  </tbody>
                );
              })}
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
