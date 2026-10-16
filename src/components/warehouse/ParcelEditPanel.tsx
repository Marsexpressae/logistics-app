"use client";

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { confirmAction } from "@/lib/ask";
import { kg, round2 } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Warehouse } from "@/lib/types";
import type { StockParcel } from "@/components/warehouse/types";

export type EditMode = "add" | "merge" | "split";
type Row = { description: string; weight: string };

/**
 * Add one parcel, merge parcels into one, or split one parcel into several. One database function (edit_parcels) does all three:
 * it retires the chosen parcels and makes the new ones with new labels; parcels that are not touched keep their label.
 * For "add" `parcels` is empty; for "merge" it holds two or more; for "split" exactly one.
 */
export default function ParcelEditPanel({ mode, booking, parcels, warehouses, onDone }: {
  mode: EditMode;
  booking: { id: string; code: string };
  parcels: StockParcel[];
  warehouses: Warehouse[];
  onDone: () => void;
}) {
  const retiredWeight = round2(parcels.reduce((t, p) => t + Number(p.weight_kg), 0));
  const active = warehouses.filter((w) => w.active !== false);
  const [rows, setRows] = useState<Row[]>(
    mode === "split"
      ? [{ description: "", weight: "" }, { description: "", weight: "" }]
      : [{ description: mode === "merge" ? [...new Set(parcels.map((p) => p.description).filter(Boolean))].join(" + ") : "", weight: mode === "merge" ? String(retiredWeight) : "" }]
  );
  const [warehouseId, setWarehouseId] = useState(active[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = (barcode: string) => barcode.slice(booking.code.length + 1);
  const retiredLabels = parcels.map((p) => short(p.barcode)).join(", ");
  const newWeight = round2(rows.reduce((t, r) => t + (Number(r.weight) || 0), 0));
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const title = mode === "add" ? "Add a parcel" : mode === "merge" ? `Merge ${parcels.length} parcels into one` : `Split parcel ${retiredLabels}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rows.some((r) => r.weight === "" || Number(r.weight) < 0)) return setError("Enter a weight (0 or more) for each new parcel.");
    if (mode === "add" && !warehouseId) return setError("Choose where the new parcel goes.");
    const made = rows.length === 1 ? "1 new parcel" : `${rows.length} new parcels`;
    const ok = await confirmAction({
      title: mode === "add" ? "Add this parcel?" : `Retire ${retiredLabels} and create ${made}?`,
      message: mode === "add" ? "A new label is made for it. The other parcels keep their labels." : "The retired parcels stay in the history, marked repacked. The other parcels keep their labels.",
      confirmLabel: mode === "add" ? "Add the parcel" : mode === "merge" ? "Merge" : "Split",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("edit_parcels", {
      p_booking_id: booking.id,
      p_retire_ids: parcels.map((p) => p.id),
      p_new: rows.map((r) => ({ description: r.description.trim() || null, weight_kg: Number(r.weight) })),
      p_warehouse_id: mode === "add" ? warehouseId : null,
      p_date: null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <Card title={`${title} · ${booking.code}`} className="mb-3">
      <form onSubmit={submit} className="space-y-3">
        {mode !== "add" && <p className="text-sm text-slate-600">Retiring {retiredLabels} ({kg(retiredWeight)} in total).</p>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
            <Field label={mode === "split" ? `New parcel ${i + 1}` : "Description"}>
              <input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} className={inputClass} placeholder="What is in it (optional)" />
            </Field>
            <Field label="Weight (kg)">
              <input type="number" inputMode="decimal" min="0" step="0.01" required value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} className={inputClass} />
            </Field>
            {mode === "split" && rows.length > 2 ? (
              <button type="button" aria-label="Remove this parcel" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="p-3 text-slate-600 hover:text-red-700">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {mode === "split" && (
          <Button type="button" variant="secondary" onClick={() => setRows([...rows, { description: "", weight: "" }])}>
            <Plus className="h-4 w-4" /> Add another new parcel
          </Button>
        )}
        {mode === "add" && (
          <Field label="Warehouse">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputClass}>
              {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
        {mode !== "add" && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Original {kg(retiredWeight)}, new total {kg(newWeight)}
            {newWeight !== retiredWeight && rows.every((r) => r.weight !== "") ? ` (difference ${kg(round2(newWeight - retiredWeight))})` : ""}
          </p>
        )}
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{mode === "add" ? "Add parcel" : mode === "merge" ? "Merge" : "Split"}</Button>
          <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
