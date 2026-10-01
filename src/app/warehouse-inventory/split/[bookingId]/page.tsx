"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Printer, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import ParcelLabel from "@/components/ui/ParcelLabel";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking, BookingItem, Parcel, Warehouse } from "@/lib/types";

type Row = { description: string; weight_kg: string };

export default function SplitPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const booking = useQuery<Booking>(() => supabase.from("bookings").select("*").eq("id", bookingId).single());
  const items = useQuery<BookingItem[]>(() => supabase.from("booking_items").select("*").eq("booking_id", bookingId));
  const warehouses = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("code"));
  const parcels = useQuery<(Parcel & { warehouse: { code: string } | null })[]>(() =>
    supabase.from("parcels").select("*, warehouse:warehouses(code)").eq("booking_id", bookingId).order("seq")
  );

  const [rows, setRows] = useState<Row[]>([{ description: "", weight_kg: "" }]);
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const totalWeight = (items.data ?? []).reduce((s, i) => s + Number(i.weight_kg) * i.quantity, 0);
  const splitWeight = rows.reduce((s, r) => s + Number(r.weight_kg || 0), 0);
  const warehouse = warehouseId || warehouses.data?.[0]?.id || "";

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("split_booking", {
      p_booking_id: bookingId,
      p_warehouse_id: warehouse,
      p_parcels: rows.map((r) => ({ description: r.description.trim(), weight_kg: Number(r.weight_kg || 0) })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    booking.reload();
    parcels.reload();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/warehouse-inventory" className="inline-flex items-center gap-1 text-sm text-slate-600 print:hidden">
        <ArrowLeft className="h-4 w-4" /> Warehouse
      </Link>
      <PageHeader
        title={`Receive & split ${b.code}`}
        description={`Collected weight: ${totalWeight} kg · ${items.data?.length ?? 0} item lines`}
      />

      <div className="space-y-4 print:hidden">
        <Card title="Repack into parcels">
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

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
                  {b.code}-P{i + 1}
                </span>
                <input
                  className={inputClass}
                  placeholder="Contents"
                  value={r.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
                <input
                  className={`${inputClass} w-28`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="kg"
                  value={r.weight_kg}
                  onChange={(e) => update(i, { weight_kg: e.target.value })}
                />
                <button
                  aria-label="Remove parcel"
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setRows([...rows, { description: "", weight_kg: "" }])}>
              <Plus className="h-4 w-4" /> Add parcel
            </Button>
            <span className="text-sm text-slate-500">
              Split weight {splitWeight} kg of {totalWeight} kg
            </span>
          </div>
          <ErrorMessage message={error} />
          <Button className="mt-3" onClick={save} disabled={busy || !warehouse}>
            {busy ? "Saving…" : parcels.data?.length ? "Replace parcels" : "Save parcels"}
          </Button>
        </Card>
      </div>

      {!!parcels.data?.length && (
        <Card title="Parcel labels">
          <div className="grid gap-3 sm:grid-cols-2">
            {parcels.data.map((p) => (
              <ParcelLabel
                key={p.id}
                barcode={p.barcode}
                description={p.description}
                weightKg={p.weight_kg}
                warehouse={p.warehouse?.code}
              />
            ))}
          </div>
          <Button className="mt-3 print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print labels
          </Button>
        </Card>
      )}
    </div>
  );
}
