"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, MoveRight, Undo2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { formatDay, kg } from "@/lib/format";
import ParcelPosition from "@/components/warehouse/ParcelPosition";
import ListSearch from "@/components/ui/ListSearch";
import SwipeHint from "@/components/ui/SwipeHint";
import { matchesSearch } from "@/lib/search";
import { neighbour } from "@/lib/swipe";
import { useSwipe } from "@/lib/use-swipe";
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
  const [q, setQ] = useState("");
  const [slide, setSlide] = useState<"next" | "previous" | null>(null); // which way the tab content slides in after a swipe
  // Swiping over a wide table scrolls the table (the swipe helper ignores it); anywhere else it changes the tab.
  const swipeRef = useSwipe((direction) => {
    const to = neighbour(TABS.map((x) => x.key), tab, direction);
    if (to) {
      setSlide(direction);
      setTab(to);
    }
  });
  // keep the chosen tab in view in the row of tabs
  useEffect(() => {
    document.getElementById(`warehouse-tab-${tab}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]); // invoices whose packages are showing
  const [openReturns, setOpenReturns] = useState<string[]>([]); // invoices whose returns are showing
  const [returnError, setReturnError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [moved, setMoved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canOperate = usePermissions().can("warehouse.manage");

  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const awaiting = useQuery<Booking[]>(() => supabase.from("bookings").select("*").eq("status", "collected").order("collected_at"));
  const parcels = useQuery<StockParcel[]>(() =>
    supabase
      .from("parcels")
      .select("*, warehouse:warehouses(code, name), booking:bookings(code, invoice_no, sender_name)")
      .in("status", ["in_warehouse", "ready_for_return"]) // both are physically in the warehouse
      .order("barcode")
  );
  const returns = useQuery<ReturnForm[]>(() =>
    supabase.from("returns").select("*, booking:bookings(code, invoice_no, sender_name), parcels(barcode, weight_kg, description)").order("created_at", { ascending: false }).limit(60)
  );

  // Unpacked = as collected (first round). Packed = repacked by the warehouse (a later round).
  const stock = parcels.data ?? [];
  const unpacked = stock.filter((p) => (p.round ?? 1) <= 1);
  const packed = stock.filter((p) => (p.round ?? 1) > 1);
  const openReturnCount = (returns.data ?? []).filter((r) => r.status === "open").length;
  const counts: Record<Tab, number> = {
    intake: awaiting.data?.length ?? 0,
    unpacked: unpacked.length,
    packed: packed.length,
    returns: openReturnCount,
  };

  const intake = (awaiting.data ?? []).filter((b) =>
    matchesSearch(q, [b.code, b.invoice_no, b.sender_name, b.receiver_name, b.pickup_area, b.pickup_address], [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp])
  );
  const returnList = (returns.data ?? []).filter((x) =>
    matchesSearch(q, [x.code, x.booking?.invoice_no, x.booking?.code, x.booking?.sender_name, x.received_by_name, ...(x.parcels ?? []).flatMap((p) => [p.barcode, p.description])])
  );

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

  // One group per invoice (booking), newest first, with its returns inside.
  const returnGroups = (list: ReturnForm[]) => {
    const byBooking = new Map<string, { bookingId: string; invoice: string; code: string; customer: string; returns: ReturnForm[] }>();
    for (const x of list) {
      const g = byBooking.get(x.booking_id) ?? {
        bookingId: x.booking_id,
        invoice: x.booking?.invoice_no ?? x.booking?.code ?? "",
        code: x.booking?.code ?? "",
        customer: x.booking?.sender_name ?? "",
        returns: [],
      };
      g.returns.push(x);
      byBooking.set(x.booking_id, g);
    }
    return [...byBooking.values()].sort((a, b) => b.invoice.localeCompare(a.invoice, undefined, { numeric: true }));
  };

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

  // Move the ticked packages to another place. They can belong to different invoices; each move goes to one place.
  async function moveSelected() {
    setBusy(true);
    setReturnError(null);
    setMoved(null);
    const { data, error } = await supabase.rpc("move_parcels", { p_parcel_ids: picked, p_warehouse_id: moveTo });
    setBusy(false);
    if (error) return setReturnError(error.message);
    const place = warehouses.data?.find((w) => w.id === moveTo)?.name ?? "the new place";
    setMoved(data === 0 ? `They were already in ${place}.` : `Moved ${data} ${data === 1 ? "package" : "packages"} to ${place}.`);
    setPicked([]);
    setMoveTo("");
    parcels.reload();
  }

  const renderParcels = (list: StockParcel[], empty: string) => {
    const visible = list.filter(
      (p) =>
        (filter === "all" || p.warehouse?.code === filter) &&
        matchesSearch(q, [p.barcode, p.description, p.position, p.booking?.invoice_no, p.booking?.code, p.booking?.sender_name, p.warehouse?.name, p.warehouse?.code])
    );
    return (
      <>
        <div className="mb-3 flex flex-wrap gap-2">
          {[{ code: "all", name: "All" }, ...(warehouses.data ?? []).map((w) => ({ code: w.code, name: w.name }))].map((w) => (
            <button
              key={w.code}
              onClick={() => setFilter(w.code)}
              className={`min-h-11 rounded-full px-4 py-2 text-sm ${
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
              {!oneBooking && <span className="ml-2 text-orange-800">A return form covers one invoice at a time.</span>}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <select aria-label="Move to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${inputClass} w-auto`} disabled={busy}>
                <option value="">Move to…</option>
                {(warehouses.data ?? [])
                  .filter((w) => w.active !== false)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
              <Button onClick={moveSelected} disabled={busy || !moveTo}>
                <MoveRight className="h-4 w-4" /> Move
              </Button>
              <Button variant="secondary" onClick={() => setPicked([])} disabled={busy}>
                Clear
              </Button>
              <Button variant="secondary" onClick={prepareReturn} disabled={busy || !oneBooking}>
                <Undo2 className="h-4 w-4" /> Return selected
              </Button>
            </span>
          </div>
        )}
        {moved && <p className="mb-3 text-sm text-green-700">{moved}</p>}
        <ErrorMessage message={returnError} />

        {!visible.length ? (
          <EmptyState message={q.trim() ? "No packages match your search." : empty} />
        ) : (
          <>
          {/* Phones: one big card per invoice, with finger-sized checkboxes and buttons (the table below is for wide screens). */}
          <ul className="space-y-3 md:hidden">
            {groups(visible).map((g) => {
              const isOpen = open.includes(g.bookingId);
              const selectable = g.parcels.filter((p) => p.status === "in_warehouse");
              const ticked = selectable.filter((p) => picked.includes(p.id)).length;
              const statuses = [...new Set(g.parcels.map((p) => p.status))];
              const places = [...new Set(g.parcels.map((p) => p.warehouse?.name ?? p.warehouse?.code).filter(Boolean))].join(", ");
              const positions = [...new Set(g.parcels.map((p) => p.position).filter(Boolean))].join(", ");
              return (
                <li key={g.bookingId} className="rounded-lg border border-slate-300 bg-white">
                  <div className="flex items-stretch">
                    {canOperate && (
                      <label className="flex w-14 shrink-0 items-center justify-center">
                        {selectable.length > 0 && (
                          <input
                            type="checkbox"
                            className="h-7 w-7"
                            aria-label={`Select all packages of ${g.invoice}`}
                            checked={ticked === selectable.length}
                            ref={(el) => {
                              if (el) el.indeterminate = ticked > 0 && ticked < selectable.length;
                            }}
                            onChange={() => toggleGroup(g.parcels)}
                          />
                        )}
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleOpen(g.bookingId)}
                      aria-expanded={isOpen}
                      className="flex min-h-20 min-w-0 flex-1 items-center justify-between gap-2 py-3 pr-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-lg font-semibold text-blue-700">{g.invoice}</span>
                        <span className="block text-base text-slate-800">{g.customer}</span>
                        <span className="block text-sm text-slate-600">
                          {g.parcels.length} {g.parcels.length === 1 ? "package" : "packages"} · {kg(g.parcels.reduce((s, p) => s + Number(p.weight_kg), 0))}
                        </span>
                        <span className="block text-sm text-slate-600">
                          {places}
                          {positions ? ` · ${positions}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-2">
                        {statuses.map((st) => (
                          <StatusBadge key={st} status={st} />
                        ))}
                        {isOpen ? <ChevronDown className="h-6 w-6 text-slate-600" /> : <ChevronRight className="h-6 w-6 text-slate-600" />}
                      </span>
                    </button>
                  </div>
                  {isOpen && (
                    <div className="space-y-2 border-t border-slate-200 p-3">
                      {g.parcels.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
                          {canOperate && (
                            <span className="flex w-8 shrink-0 justify-center">
                              {p.status === "in_warehouse" && (
                                <input type="checkbox" className="h-7 w-7" aria-label={`Select ${p.barcode} for return`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                              )}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-base font-semibold">{p.barcode}</span>
                            <span className="block text-sm text-slate-700">
                              {p.description ?? "—"} · {kg(Number(p.weight_kg))}
                            </span>
                            <span className="mt-1 block text-sm text-slate-700">
                              {p.warehouse?.name ?? p.warehouse?.code}
                              <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit={canOperate} onChanged={parcels.reload} />
                            </span>
                          </span>
                          <StatusBadge status={p.status} />
                        </div>
                      ))}
                      {canOperate && (
                        <Link
                          href={`/warehouse-inventory/split/${g.bookingId}`}
                          className="flex min-h-14 items-center justify-center rounded-md border-2 border-blue-600 text-base font-semibold text-blue-700"
                        >
                          Labels
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {canOperate && <th className="w-8 px-4 py-3"></th>}
                  <th className="px-4 py-3">Invoice / package</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Weight</th>
                  <th className="px-4 py-3">Place</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              {groups(visible).map((g) => {
                const isOpen = open.includes(g.bookingId);
                const selectable = g.parcels.filter((p) => p.status === "in_warehouse");
                const ticked = selectable.filter((p) => picked.includes(p.id)).length;
                const statuses = [...new Set(g.parcels.map((p) => p.status))];
                const places = [...new Set(g.parcels.map((p) => p.warehouse?.name ?? p.warehouse?.code).filter(Boolean))].join(", ");
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
                          className="inline-flex min-h-11 items-center gap-1 font-mono font-semibold text-blue-700"
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
                      <td className="px-4 py-3 text-slate-600">{[...new Set(g.parcels.map((p) => p.position).filter(Boolean))].join(", ")}</td>
                      <td className="space-x-1 px-4 py-3">
                        {statuses.map((s) => (
                          <StatusBadge key={s} status={s} />
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        {canOperate && (
                          <Link href={`/warehouse-inventory/split/${g.bookingId}`} className="inline-flex min-h-11 items-center rounded-md border border-blue-600 px-4 font-medium text-blue-700">
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
                          <td className="px-4 py-2.5">{p.warehouse?.name ?? p.warehouse?.code}</td>
                          <td className="px-4 py-2.5">
                            <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit={canOperate} onChanged={parcels.reload} />
                          </td>
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
          </>
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader title="Warehouse" description="Receive cargo, then unpack, pack and return." />
      <ErrorMessage message={awaiting.error ?? parcels.error ?? returns.error} />

      <SwipeHint id="warehouse">Swipe left or right to change tab: Intake, Unpacked, Packed, Returns.</SwipeHint>
      <div ref={swipeRef} className="min-h-[70vh]">
      <div role="tablist" className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`warehouse-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setSlide(null);
              setTab(t.key);
            }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {t.label}
            <span className={`ml-2 rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/25" : "bg-slate-100 text-slate-600"}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-500">{TABS.find((t) => t.key === tab)!.hint}</p>
      <div className="mb-3 flex">
        <ListSearch
          value={q}
          onChange={setQ}
          placeholder={tab === "returns" ? "Return, invoice or customer" : tab === "intake" ? "Invoice, booking or customer" : "Invoice, barcode, position or customer"}
        />
      </div>

      <div key={tab} className={slide ? `swipe-in-${slide}` : ""}>
      {tab === "intake" && (
        <Card id="awaiting-intake" className="border-0! bg-transparent! p-0!">
          {!intake.length ? (
            <p className="text-sm text-slate-500">{awaiting.data?.length ? "No bookings match your search." : "No collected bookings waiting."}</p>
          ) : (
            <ul className="space-y-3">
              {intake.map((b) => {
                const row = (
                  <>
                    <span className="min-w-0">
                      <span className="block font-mono text-lg font-semibold">{b.invoice_no ?? b.code}</span>
                      <span className="block text-base text-slate-800">{b.sender_name}</span>
                      <span className="block text-sm text-slate-600">→ {b.receiver_name ?? "receiver not set"}</span>
                    </span>
                    {canOperate && (
                      <span className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-base font-semibold text-white">
                        Receive <ChevronRight className="h-5 w-5" />
                      </span>
                    )}
                  </>
                );
                const box = "flex min-h-20 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white p-4";
                return (
                  <li key={b.id}>
                    {canOperate ? (
                      <Link href={`/warehouse-inventory/split/${b.id}`} className={`${box} active:bg-slate-50`}>
                        {row}
                      </Link>
                    ) : (
                      <div className={box}>{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "unpacked" && renderParcels(unpacked, "No unpacked parcels in the warehouse.")}
      {tab === "packed" && renderParcels(packed, "Nothing has been repacked yet.")}

      {tab === "returns" && (
        <Card>
          {!returnList.length ? (
            <p className="text-sm text-slate-500">
              {returns.data?.length ? "No returns match your search." : "No returns yet. Tick parcels in Unpacked or Packed, then press Return selected."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {returnGroups(returnList).map((g) => {
                const isOpen = openReturns.includes(g.bookingId);
                const statuses = [...new Set(g.returns.map((x) => x.status))];
                const packages = g.returns.reduce((s, x) => s + (x.parcels?.length ?? 0), 0);
                return (
                  <li key={g.bookingId} className="py-2">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenReturns(isOpen ? openReturns.filter((x) => x !== g.bookingId) : [...openReturns, g.bookingId])}
                      className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg px-1 text-left active:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-lg font-semibold text-blue-700">{g.invoice}</span>
                        <span className="block text-base text-slate-800">{g.customer}</span>
                        <span className="block text-sm text-slate-600">
                          <span className="font-mono">{g.code}</span> · {g.returns.length} {g.returns.length === 1 ? "return" : "returns"}, {packages}{" "}
                          {packages === 1 ? "package" : "packages"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {statuses.map((s) => (
                          <StatusBadge key={s} status={s} />
                        ))}
                        {isOpen ? <ChevronDown className="h-6 w-6 text-slate-600" /> : <ChevronRight className="h-6 w-6 text-slate-600" />}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
                        {g.returns.map((x) => (
                          <li key={x.id}>
                            {(() => {
                              const inner = (
                                <>
                                  <span className="min-w-0">
                                    <span className="block font-mono text-base font-semibold">{x.code}</span>
                                    <span className="block text-xs text-slate-600">{formatDay(x.form_date)}</span>
                                    <span className="block text-slate-700">
                                      {(x.parcels ?? []).map((p) => `${p.barcode} (${kg(Number(p.weight_kg))})`).join(", ") || "no packages"}
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <StatusBadge status={x.status} />
                                    {canOperate && (
                                      <span className="flex items-center gap-1 rounded-md border border-blue-600 px-3 py-2 text-base font-semibold text-blue-700">
                                        {x.status === "open" ? "Form" : "View"} <ChevronRight className="h-5 w-5" />
                                      </span>
                                    )}
                                  </span>
                                </>
                              );
                              const box = "flex min-h-16 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white p-3";
                              return canOperate ? (
                                <Link href={`/warehouse-inventory/returns/${x.id}`} className={`${box} active:bg-slate-50`}>
                                  {inner}
                                </Link>
                              ) : (
                                <div className={box}>{inner}</div>
                              );
                            })()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
      </div>
      </div>
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
