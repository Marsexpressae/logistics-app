"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Merge, MoveRight, Plus, Split, Undo2 } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { Button, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { kg } from "@/lib/format";
import ParcelPosition from "@/components/warehouse/ParcelPosition";
import ShowMore from "@/components/ui/ShowMore";
import { matchesSearch } from "@/lib/search";
import { PAGE_SIZE } from "@/lib/window";
import type { Warehouse } from "@/lib/types";
import type { StockParcel } from "@/components/warehouse/types";

export type StockListProps = {
  list: StockParcel[];
  empty: string;
  warehouses: Warehouse[];
  filter: string;
  setFilter: (v: string) => void;
  q: string;
  groupLimit: number;
  setGroupLimit: (f: (n: number) => number) => void;
  open: string[];
  toggleOpen: (bookingId: string) => void;
  picked: string[];
  setPicked: (v: string[]) => void;
  toggle: (id: string) => void;
  toggleGroup: (list: StockParcel[]) => void;
  canOperate: boolean;
  canMerge: boolean; // two or more parcels of one invoice are ticked
  canSplit: boolean; // exactly one parcel is ticked
  onEdit: (mode: "merge" | "split") => void;
  onAdd: (bookingId: string, code: string) => void;
  oneBooking: boolean;
  busy: boolean;
  prepareReturn: () => void;
  moveTo: string;
  setMoveTo: (v: string) => void;
  moveSelected: () => void;
  moved: string | null;
  returnError: string | null;
  reload: () => void;
};

/** The parcels in stock (Unpacked and Packed tabs): one group per invoice, with the selection bar for returning and moving. */
export default function StockList({
  list, empty, warehouses, filter, setFilter, q, groupLimit, setGroupLimit, open, toggleOpen, picked, setPicked, toggle, toggleGroup,
  canOperate, canMerge, canSplit, onEdit, onAdd, oneBooking, busy, prepareReturn, moveTo, setMoveTo, moveSelected, moved, returnError, reload,
}: StockListProps) {
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

  const visible = list.filter(
    (p) =>
      (filter === "all" || p.warehouse?.code === filter) &&
      matchesSearch(q, [p.barcode, p.description, p.position, p.booking?.invoice_no, p.booking?.code, p.booking?.sender_name, p.warehouse?.name, p.warehouse?.code])
  );
  const allGroups = groups(visible);
  const shownGroups = allGroups.slice(0, groupLimit);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {[{ code: "all", name: "All" }, ...warehouses.map((w) => ({ code: w.code, name: w.name }))].map((w) => (
          <button
            key={w.code}
            onClick={() => setFilter(w.code)}
            className={`min-h-11 rounded-full px-4 py-2 text-sm ${
              filter === w.code ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700"
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
          <span className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="large" onClick={prepareReturn} disabled={busy || !oneBooking}>
              <Undo2 className="h-6 w-6" /> Return selected
            </Button>
            {canMerge && (
              <Button size="large" variant="secondary" onClick={() => onEdit("merge")} disabled={busy}>
                <Merge className="h-6 w-6" /> Merge into one
              </Button>
            )}
            {canSplit && (
              <Button size="large" variant="secondary" onClick={() => onEdit("split")} disabled={busy}>
                <Split className="h-6 w-6" /> Split in parts
              </Button>
            )}
            <select aria-label="Move to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${inputClass} sm:w-auto`} disabled={busy}>
              <option value="">Move to…</option>
              {warehouses
                .filter((w) => w.active !== false)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
            <Button variant="secondary" onClick={moveSelected} disabled={busy || !moveTo}>
              <MoveRight className="h-5 w-5" /> Move to the place above
            </Button>
            <Button variant="secondary" onClick={() => setPicked([])} disabled={busy}>
              Clear selection
            </Button>
          </span>
        </div>
      )}
      {moved && <p role="status" className="mb-3 text-sm text-green-700">{moved}</p>}
      <ErrorMessage message={returnError} />

      {!visible.length ? (
        <EmptyState message={q.trim() ? "No packages match your search." : empty} />
      ) : (
        <>
        {/* Phones: one big card per invoice, with finger-sized checkboxes and buttons (the table below is for wide screens). */}
        <ul className="space-y-3 md:hidden">
          {shownGroups.map((g) => {
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
                      <span className="block font-mono text-lg font-semibold text-brand-700">{g.invoice}</span>
                      <span className="block text-base text-slate-800">{g.customer}</span>
                      <span className="block text-base font-medium text-slate-700">
                        {g.parcels.length} {g.parcels.length === 1 ? "package" : "packages"} · {kg(g.parcels.reduce((s, p) => s + Number(p.weight_kg), 0))}
                      </span>
                      <span className="block text-base text-slate-700">
                        {places}
                        {positions ? ` · ${positions}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2">
                      {statuses.map((st) => (
                        <StatusBadge large key={st} status={st} />
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
                          <span className="block text-base text-slate-800">
                            {p.description ?? "—"} · {kg(Number(p.weight_kg))}
                          </span>
                          <span className="mt-1 block text-base text-slate-700">
                            {p.warehouse?.name ?? p.warehouse?.code}
                            <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit={canOperate} onChanged={reload} />
                          </span>
                        </span>
                        <StatusBadge large status={p.status} />
                      </div>
                    ))}
                    {canOperate && (
                      <button
                        type="button"
                        onClick={() => onAdd(g.bookingId, g.code)}
                        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-md border-2 border-slate-300 text-base font-semibold text-slate-700"
                      >
                        <Plus className="h-5 w-5" /> Add parcel
                      </button>
                    )}
                    {canOperate && (
                      <Link
                        href={`/warehouse-inventory/split/${g.bookingId}`}
                        className="flex min-h-14 items-center justify-center rounded-md border-2 border-brand-600 text-base font-semibold text-brand-700"
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
            {shownGroups.map((g) => {
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
                        className="inline-flex min-h-11 items-center gap-1 font-mono font-semibold text-brand-700"
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
                        <StatusBadge large key={s} status={s} />
                      ))}
                    </td>
                    <td className="space-x-2 whitespace-nowrap px-4 py-3">
                      {canOperate && (
                        <button
                          type="button"
                          onClick={() => onAdd(g.bookingId, g.code)}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-300 px-4 font-medium text-slate-700"
                        >
                          <Plus className="h-4 w-4" /> Add parcel
                        </button>
                      )}
                      {canOperate && (
                        <Link href={`/warehouse-inventory/split/${g.bookingId}`} className="inline-flex min-h-11 items-center rounded-md border border-brand-600 px-4 font-medium text-brand-700">
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
                          <ParcelPosition parcelId={p.id} barcode={p.barcode} position={p.position} canEdit={canOperate} onChanged={reload} />
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge large status={p.status} />
                        </td>
                        <td className="px-4 py-2.5"></td>
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
        <ShowMore remaining={Math.max(0, allGroups.length - groupLimit)} onClick={() => setGroupLimit((n) => n + PAGE_SIZE)} what="invoices" />
        </>
      )}
    </>
  );
}
