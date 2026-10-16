"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/form";
import ListSearch from "@/components/ui/ListSearch";
import SwipeHint from "@/components/ui/SwipeHint";
import { matchesSearch } from "@/lib/search";
import { neighbour } from "@/lib/swipe";
import ScanParcel from "@/components/scan/ScanParcel";
import { PAGE_SIZE } from "@/lib/window";
import { nextTabIndex } from "@/lib/tab-keys";
import { useSwipe } from "@/lib/use-swipe";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, ReturnForm, Warehouse } from "@/lib/types";
import { TABS, type StockParcel, type Tab } from "@/components/warehouse/types";
import StockList from "@/components/warehouse/StockList";
import IntakeList from "@/components/warehouse/IntakeList";
import ReturnsList from "@/components/warehouse/ReturnsList";

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
  const [groupLimit, setGroupLimit] = useState(PAGE_SIZE); // invoices shown in the Unpacked and Packed lists
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

  // Arrow keys, Home and End move between the tabs, and keyboard focus follows.
  const onTabKey = (e: React.KeyboardEvent, idPrefix: string) => {
    const next = nextTabIndex(e.key, TABS.findIndex((t) => t.key === tab), TABS.length);
    if (next === null) return;
    e.preventDefault();
    setSlide(null);
    setTab(TABS[next].key);
    document.getElementById(`${idPrefix}${TABS[next].key}`)?.focus();
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

  const stockProps = {
    warehouses: warehouses.data ?? [], filter, setFilter, q, groupLimit, setGroupLimit, open, toggleOpen, picked, setPicked, toggle, toggleGroup,
    canOperate, oneBooking, busy, prepareReturn, moveTo, setMoveTo, moveSelected, moved, returnError, reload: parcels.reload,
  };

  return (
    <>
      <PageHeader title="Warehouse" description="Receive cargo, then unpack, pack and return." />
      <ScanParcel />
      <ErrorMessage message={awaiting.error ?? parcels.error ?? returns.error} />

      <SwipeHint id="warehouse">Swipe left or right to change tab: Intake, Unpacked, Packed, Returns.</SwipeHint>
      <div ref={swipeRef} className="min-h-[70vh]">
      {/* Phones: four big tiles in a 2 x 2 grid, no sideways scrolling. */}
      <div role="tablist" aria-label="Warehouse sections" onKeyDown={(e) => onTabKey(e, "warehouse-tile-")} className="mb-3 grid grid-cols-2 gap-3 md:hidden">
        {TABS.map((t) => {
          const on = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              id={`warehouse-tile-${t.key}`}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                setSlide(null);
                setTab(t.key);
              }}
              className={`flex min-h-28 flex-col items-start justify-between rounded-xl border-2 p-4 text-left ${on ? t.tileOn : t.tile}`}
            >
              <span className="flex w-full items-center justify-between">
                <Icon className="h-8 w-8" aria-hidden="true" />
                <span className="text-4xl font-bold leading-none">{counts[t.key]}</span>
              </span>
              <span className="text-xl font-semibold">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div role="tablist" aria-label="Warehouse sections" onKeyDown={(e) => onTabKey(e, "warehouse-tab-")} className="mb-2 hidden gap-2 overflow-x-auto pb-1 md:flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`warehouse-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => {
              setSlide(null);
              setTab(t.key);
            }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {t.label}
            <span className={`ml-2 rounded-full px-1.5 text-xs ${tab === t.key ? "bg-white/25" : "bg-slate-100 text-slate-600"}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-base text-slate-700 md:text-sm md:text-slate-500">{TABS.find((t) => t.key === tab)!.hint}</p>
      <div className="mb-3 flex">
        <ListSearch
          value={q}
          onChange={setQ}
          placeholder={tab === "returns" ? "Return, invoice or customer" : tab === "intake" ? "Invoice, booking or customer" : "Invoice, barcode, position or customer"}
        />
      </div>

      <div key={tab} className={slide ? `swipe-in-${slide}` : ""}>
      {tab === "intake" && <IntakeList bookings={intake} hasAny={!!awaiting.data?.length} canOperate={canOperate} />}

      {tab === "unpacked" && <StockList {...stockProps} list={unpacked} empty="No unpacked parcels in the warehouse." />}
      {tab === "packed" && <StockList {...stockProps} list={packed} empty="Nothing has been repacked yet." />}

      {tab === "returns" && (
        <ReturnsList list={returnList} hasAny={!!returns.data?.length} canOperate={canOperate} openReturns={openReturns} setOpenReturns={setOpenReturns} />
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
