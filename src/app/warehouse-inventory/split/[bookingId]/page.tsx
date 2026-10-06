"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { PackageCheck, Plus, Printer, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import WarningBanner from "@/components/customers/WarningBanner";
import NotesCard from "@/components/bookings/NotesCard";
import ParcelLabel from "@/components/ui/ParcelLabel";
import ParcelPosition from "@/components/warehouse/ParcelPosition";
import { Button, Card, ErrorMessage, Field, inputClass, Loading } from "@/components/ui/form";
import { kg, round2, todayISO } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, BookingItem, Parcel, Warehouse } from "@/lib/types";
import { confirmAction } from "@/lib/ask";
import BackLink from "@/components/ui/BackLink";

type Row = { description: string; weight_kg: string };

/** One parcel per physical package the driver collected: "2 x Box Clothes, 40 kg each" becomes two 40 kg parcels. */
const parcelsFromItems = (items: BookingItem[]): Row[] =>
  items.flatMap((i) =>
    Array.from({ length: i.quantity }, () => ({ description: i.description, weight_kg: String(Number(i.weight_kg)) }))
  );

export default function ReceivePage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const canPrint = usePermissions().can("documents.print");
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
  const [receivedOn, setReceivedOn] = useState(todayISO());
  const [repack, setRepack] = useState(false); // the rare case: pack the cargo differently from how it was collected
  const [custom, setCustom] = useState<Row[] | null>(null); // edited rows; null = use what was collected
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const b = booking.data;
  if (booking.loading) return <Loading />;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const collected = parcelsFromItems(items.data ?? []);
  const rows = custom ?? collected;
  const received = (parcels.data?.length ?? 0) > 0;
  const hasItems = collected.length > 0;
  const collectedWeight = round2(collected.reduce((s, r) => s + Number(r.weight_kg), 0));
  const rowsWeight = round2(rows.reduce((s, r) => s + Number(r.weight_kg || 0), 0));
  const choices = (warehouses.data ?? []).filter((w) => w.active !== false);
  const warehouse = warehouseId || choices[0]?.id || "";

  const update = (i: number, patch: Partial<Row>) =>
    setCustom(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save(list: Row[]) {
    if (received && !(await confirmAction({ title: "Replace the received parcels?", message: "This replaces the parcels already received, and their barcodes.", confirmLabel: "Replace", danger: true }))) return;
    if (list.some((r) => Number(r.weight_kg || 0) < 0)) return setError("A weight cannot be negative.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("split_booking", {
      p_booking_id: bookingId,
      p_warehouse_id: warehouse,
      p_parcels: list.map((r) => ({ description: r.description.trim(), weight_kg: Number(r.weight_kg || 0) })),
      p_date: receivedOn && receivedOn !== todayISO() ? receivedOn : null,
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
      <BackLink href="/warehouse-inventory" className="print:hidden">Warehouse</BackLink>
      <PageHeader
        title={`Receive ${b.invoice_no ?? b.code}`}
        description={
          hasItems
            ? `Collected: ${collected.length} ${collected.length === 1 ? "package" : "packages"} · ${kg(collectedWeight)}`
            : "No packages were recorded at pickup."
        }
      />

      <div className="space-y-4 print:hidden">
        <WarningBanner bookingId={bookingId} />
        {!received && (
          <Card title="Receive into the warehouse">
            <div className="mb-3 max-w-xs">
              <Field label="Arrives at">
                <select className={inputClass} value={warehouse} onChange={(e) => setWarehouseId(e.target.value)}>
                  {choices.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-xs text-slate-500">Received on</span>
              <input type="date" max={todayISO()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={`${inputClass} w-auto`} />
            </label>

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
                <Button size="large" onClick={() => save(collected)} disabled={busy || !warehouse}>
                  <PackageCheck className="h-6 w-6" />
                  {busy ? "Receiving…" : `Receive ${collected.length} ${collected.length === 1 ? "parcel" : "parcels"}`}
                </Button>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => {
                    setCustom(collected);
                    setRepack(true);
                  }}
                >
                  Pack differently
                </Button>
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
                  <Button
                    variant="secondary"
                    className="mt-3 w-full"
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
                  </Button>
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
        <Card title="Where did you put them? (optional)" className="print:hidden">
          <ul className="divide-y divide-slate-100 text-sm">
            {parcels.data!.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono">{p.barcode}</span>
                <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit onChanged={parcels.reload} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {received && (
        <Card title="Parcel labels">
          <div className="grid gap-3 sm:grid-cols-2">
            {parcels.data!.map((p) => (
              <ParcelLabel key={p.id} barcode={p.barcode} description={p.description} weightKg={p.weight_kg} warehouse={p.warehouse?.code} />
            ))}
          </div>
          {canPrint && (
            <Button size="large" className="mt-3 print:hidden" onClick={() => window.print()}>
              <Printer className="h-6 w-6" /> Print labels
            </Button>
          )}
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
      <p role="status" className={`rounded-md px-3 py-2 text-sm print:hidden ${ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>
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
            <span className="w-20 shrink-0 font-mono text-xs text-slate-600">
              {b!.code}-P{i + 1}
            </span>
            <input className={inputClass} placeholder="Contents" aria-label={`Contents of parcel ${i + 1}`} value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
            <input
              className={`${inputClass} w-28`}
              type="number"
              min="0"
              step="0.01"
              placeholder="kg"
              inputMode="decimal"
              aria-label={`Weight in kg of parcel ${i + 1}`}
              value={r.weight_kg}
              onChange={(e) => update(i, { weight_kg: e.target.value })}
            />
            <button aria-label="Remove parcel" className="p-3" disabled={rows.length === 1} onClick={() => setCustom(rows.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-6 w-6 text-slate-600" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setCustom([...rows, { description: "", weight_kg: "" }])}>
            <Plus className="h-4 w-4" /> Add parcel
          </Button>
          <span className={`text-sm ${different ? "text-amber-700" : "text-slate-500"}`}>
            {kg(rowsWeight)}{hasItems ? ` of ${kg(collectedWeight)} collected` : ""}
            {different ? ": the weights do not match" : ""}
          </span>
        </div>
        <ErrorMessage message={error} />
        <div className="flex flex-col gap-2">
          <Button size="large" onClick={() => save(rows)} disabled={busy || !warehouse}>
            {busy ? "Saving…" : "Save repacked parcels"}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
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
