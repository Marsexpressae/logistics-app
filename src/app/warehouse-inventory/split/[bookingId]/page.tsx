"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, PackageCheck, Plus, Printer, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import NotesCard from "@/components/bookings/NotesCard";
import ParcelLabel from "@/components/ui/ParcelLabel";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { kg, round2 } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking, BookingItem, Parcel, Warehouse } from "@/lib/types";

type Row = { description: string; weight_kg: string };

/** One parcel per physical package the driver collected: "2 x Box Clothes, 40 kg each" becomes two 40 kg parcels. */
const parcelsFromItems = (items: BookingItem[]): Row[] =>
  items.flatMap((i) =>
    Array.from({ length: i.quantity }, () => ({ description: i.description, weight_kg: String(Number(i.weight_kg)) }))
  );

export default function ReceivePage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const booking = useQuery<Booking>(() => supabase.from("bookings").select("*").eq("id", bookingId).single());
  const items = useQuery<BookingItem[]>(() => supabase.from("booking_items").select("*").eq("booking_id", bookingId).order("id"));
  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  // Repacked parcels stay in the database as history, but only the live ones are shown here.
  const parcels = useQuery<(Parcel & { warehouse: { code: string } | null })[]>(() =>
    supabase.from("parcels").select("*, warehouse:warehouses(code)").eq("booking_id", bookingId).neq("status", "repacked").order("seq")
  );
  const history = useQuery<{ id: string }[]>(() =>
    supabase.from("parcels").select("id").eq("booking_id", bookingId).eq("status", "repacked")
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [repack, setRepack] = useState(false); // the rare case: pack the cargo differently from how it was collected
  const [custom, setCustom] = useState<Row[] | null>(null); // edited rows; null = use what was collected
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const collected = parcelsFromItems(items.data ?? []);
  const rows = custom ?? collected;
  const received = (parcels.data?.length ?? 0) > 0;
  const hasItems = collected.length > 0;
  const collectedWeight = round2(collected.reduce((s, r) => s + Number(r.weight_kg), 0));
  const rowsWeight = round2(rows.reduce((s, r) => s + Number(r.weight_kg || 0), 0));
  const warehouse = warehouseId || warehouses.data?.[0]?.id || "";

  const update = (i: number, patch: Partial<Row>) =>
    setCustom(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save(list: Row[]) {
    if (received && !confirm("This replaces the parcels already received, and their barcodes. Continue?")) return;
    if (list.some((r) => Number(r.weight_kg || 0) < 0)) return setError("A weight cannot be negative.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("split_booking", {
      p_booking_id: bookingId,
      p_warehouse_id: warehouse,
      p_parcels: list.map((r) => ({ description: r.description.trim(), weight_kg: Number(r.weight_kg || 0) })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setRepack(false);
    setCustom(null);
    booking.reload();
    parcels.reload();
    history.reload();
  }

  const nothingToReceive = !hasItems && !repack;

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/warehouse-inventory" className="inline-flex items-center gap-1 text-sm text-slate-600 print:hidden">
        <ArrowLeft className="h-4 w-4" /> Warehouse
      </Link>
      <PageHeader
        title={`Receive ${b.invoice_no ?? b.code}`}
        description={
          hasItems
            ? `Collected: ${collected.length} ${collected.length === 1 ? "package" : "packages"} · ${kg(collectedWeight)}`
            : "No packages were recorded at pickup."
        }
      />

      <div className="space-y-4 print:hidden">
        {!received && (
          <Card title="Receive into the warehouse">
            <div className="mb-3 max-w-xs">
              <Field label="Arrives at">
                <select className={inputClass} value={warehouse} onChange={(e) => setWarehouseId(e.target.value)}>
                  {warehouses.data?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {hasItems && !repack && (
              <>
                <ul className="mb-3 divide-y divide-slate-100 text-sm">
                  {collected.map((r, i) => (
                    <li key={i} className="flex justify-between py-1.5">
                      <span>
                        <span className="font-mono text-xs text-slate-500">
                          {b.code}-P{i + 1}
                        </span>{" "}
                        {r.description}
                      </span>
                      <span>{r.weight_kg} kg</span>
                    </li>
                  ))}
                </ul>
                <ErrorMessage message={error} />
                <Button onClick={() => save(collected)} disabled={busy || !warehouse}>
                  <PackageCheck className="h-4 w-4" />
                  {busy ? "Receiving…" : `Receive ${collected.length} ${collected.length === 1 ? "parcel" : "parcels"}`}
                </Button>
                <button
                  className="ml-4 text-sm text-slate-600 underline"
                  onClick={() => {
                    setCustom(collected);
                    setRepack(true);
                  }}
                >
                  Pack differently
                </button>
              </>
            )}

            {nothingToReceive && (
              <p className="text-sm text-slate-600">
                Add the packages on the pickup page first, or{" "}
                <button
                  className="font-medium underline"
                  onClick={() => {
                    setCustom([{ description: "", weight_kg: "" }]);
                    setRepack(true);
                  }}
                >
                  enter the parcels here
                </button>
                .
              </p>
            )}

            {repack && renderRepackEditor()}
          </Card>
        )}

        {received && (
          <Card>
            <p className="text-sm text-slate-700">
              Received into the warehouse as <span className="font-medium">{parcels.data!.length} {parcels.data!.length === 1 ? "parcel" : "parcels"}</span>.
              {!repack && (
                <>
                  {" "}
                  <button
                    className="text-slate-500 underline"
                    onClick={() => {
                      // Start from the parcels as they are, unless they are empty placeholders (no contents, 0 kg):
                      // then start from what was collected, so a bad first receive is a one-click fix.
                      const existing = parcels.data!.map((p) => ({ description: p.description ?? "", weight_kg: String(Number(p.weight_kg)) }));
                      const placeholders = existing.every((r) => !r.description && !Number(r.weight_kg));
                      setCustom(hasItems && placeholders ? collected : existing);
                      setRepack(true);
                    }}
                  >
                    Repack
                  </button>
                </>
              )}
            </p>
            {repack && renderRepackEditor()}
          </Card>
        )}
      </div>

      {received && hasItems && renderReconcile()}

      <div className="print:hidden">
        <NotesCard bookingId={bookingId} />
      </div>

      {received && (
        <Card title="Parcel labels">
          <div className="grid gap-3 sm:grid-cols-2">
            {parcels.data!.map((p) => (
              <ParcelLabel key={p.id} barcode={p.barcode} description={p.description} weightKg={p.weight_kg} warehouse={p.warehouse?.code} />
            ))}
          </div>
          <Button className="mt-3 print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print labels
          </Button>
        </Card>
      )}
    </div>
  );

  // Collected vs received: the same cargo should add up. A difference is shown, not blocked (a re-weigh can be legitimate).
  function renderReconcile() {
    const live = parcels.data ?? [];
    const liveKg = round2(live.reduce((s, p) => s + Number(p.weight_kg), 0));
    const sameCount = live.length === collected.length;
    const sameKg = Math.abs(liveKg - collectedWeight) <= 0.01;
    const ok = sameKg && sameCount;
    return (
      <p className={`rounded-md px-3 py-2 text-sm print:hidden ${ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>
        {ok
          ? `Matches the pickup: ${collected.length} ${collected.length === 1 ? "package" : "packages"}, ${kg(collectedWeight)}.`
          : `Does not match the pickup. Collected ${collected.length} ${collected.length === 1 ? "package" : "packages"}, ${kg(collectedWeight)}. Received ${live.length} ${live.length === 1 ? "parcel" : "parcels"}, ${kg(liveKg)}.`}
        {(history.data?.length ?? 0) > 0 && ` Repacked before (${history.data!.length} earlier ${history.data!.length === 1 ? "parcel" : "parcels"} kept as history).`}
      </p>
    );
  }

  // The rare case: the cargo is packed differently from how it was collected.
  // A plain function (not a component) so the text boxes keep focus while typing.
  function renderRepackEditor() {
    const different = hasItems && Math.abs(rowsWeight - collectedWeight) > 0.01;
    return (
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
              {b!.code}-P{i + 1}
            </span>
            <input className={inputClass} placeholder="Contents" value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
            <input
              className={`${inputClass} w-28`}
              type="number"
              min="0"
              step="0.01"
              placeholder="kg"
              value={r.weight_kg}
              onChange={(e) => update(i, { weight_kg: e.target.value })}
            />
            <button aria-label="Remove parcel" disabled={rows.length === 1} onClick={() => setCustom(rows.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setCustom([...rows, { description: "", weight_kg: "" }])}>
            <Plus className="h-4 w-4" /> Add parcel
          </Button>
          <span className={`text-sm ${different ? "text-amber-700" : "text-slate-500"}`}>
            {kg(rowsWeight)}{hasItems ? ` of ${kg(collectedWeight)} collected` : ""}
            {different ? ": the weights do not match" : ""}
          </span>
        </div>
        <ErrorMessage message={error} />
        <div className="flex gap-2">
          <Button onClick={() => save(rows)} disabled={busy || !warehouse}>
            {busy ? "Saving…" : "Save repacked parcels"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setRepack(false);
              setCustom(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }
}
