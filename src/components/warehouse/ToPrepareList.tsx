"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import { Button, Card, ErrorMessage } from "@/components/ui/form";
import { confirmAction } from "@/lib/ask";
import { formatDate, formatDay, kg } from "@/lib/format";
import { changedCount, pickList, requestLine } from "@/lib/return-requests";
import { supabase } from "@/lib/supabase";
import type { ReturnRequest } from "@/lib/types";
import type { StockParcel } from "./types";

/**
 * Return requests from the office, waiting for the warehouse. Each one opens into a pick list of the parcels still in the warehouse,
 * with where they sit. Prepare return makes the return form for exactly those parcels (and closes the request).
 */
export default function ToPrepareList({ requests, parcels, canPrepare, canCancel, onChanged }: {
  requests: ReturnRequest[];
  parcels: StockParcel[];
  canPrepare: boolean;
  canCancel: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!requests.length) return null;

  async function prepare(r: ReturnRequest, ids: string[]) {
    setBusy(r.id);
    setError(null);
    const { data, error } = await supabase.rpc("prepare_return", { p_booking_id: r.booking_id, p_parcel_ids: ids });
    setBusy(null);
    if (error) {
      setError(error.message);
      return onChanged();
    }
    router.push(`/warehouse-inventory/returns/${data}`);
  }

  async function cancel(r: ReturnRequest) {
    if (!(await confirmAction({ title: "Cancel this return request?", message: "The request is closed. The parcels stay in normal stock.", confirmLabel: "Cancel request", danger: true }))) return;
    setBusy(r.id);
    setError(null);
    const { error } = await supabase.rpc("cancel_return_request", { p_request_id: r.id });
    setBusy(null);
    if (error) setError(error.message);
    onChanged();
  }

  return (
    <Card title="To prepare" id="to-prepare" className="mb-4">
      <p className="mb-3 text-sm text-slate-600">The office asked for these parcels back. Open one to see which parcels to pull and where they are.</p>
      <ErrorMessage message={error} />
      <ul className="space-y-3">
        {requests.map((r) => {
          const mine = parcels.filter((p) => p.booking_id === r.booking_id);
          const list = pickList(r, mine);
          const changed = changedCount(r, mine);
          const expanded = open.includes(r.id);
          return (
            <li key={r.id} className="rounded-lg border border-slate-300 bg-white">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? open.filter((x) => x !== r.id) : [...open, r.id])}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg p-3 text-left active:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-base font-semibold">{requestLine(r)}</span>
                  <span className="block text-sm text-slate-700">
                    {r.needed_by ? `Needed by ${formatDay(r.needed_by)} · ` : ""}
                    Asked by {r.requested_by_name ?? "a colleague"}, {formatDate(r.requested_at)}
                  </span>
                  {r.note && <span className="block text-base text-slate-800">{r.note}</span>}
                </span>
                {expanded ? <ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />}
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-slate-200 p-3">
                  {changed > 0 && (
                    <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Some requested parcels have changed (moved, merged, split or returned). Check the stock list.
                    </p>
                  )}
                  {list.length === 0 ? (
                    <p className="text-sm text-slate-700">Nothing left to return.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {list.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                          <span className="min-w-0">
                            <span className="block font-mono text-base font-semibold">{p.barcode}</span>
                            <span className="block text-sm text-slate-600">
                              {p.description || "No description"} · {kg(Number(p.weight_kg))}
                            </span>
                          </span>
                          <span className="text-base font-semibold text-slate-900">{p.position ? `Place ${p.position}` : "No place set"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {canPrepare && list.length > 0 && (
                      <Button onClick={() => prepare(r, list.map((p) => p.id))} disabled={busy === r.id}>
                        <Undo2 className="h-5 w-5" aria-hidden="true" /> Prepare return
                      </Button>
                    )}
                    {canCancel && (
                      <Button variant="secondary" onClick={() => cancel(r)} disabled={busy === r.id}>
                        Cancel request
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
