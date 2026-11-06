"use client";

import { useState } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import DateField from "@/components/ui/DateField";
import { Button, Card, ErrorMessage, inputClass } from "@/components/ui/form";
import { confirmAction } from "@/lib/ask";
import { formatDate, formatDay, kg } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { ReturnRequest } from "@/lib/types";

type Option = { id: string; barcode: string; description: string | null; weight_kg: number };

/**
 * Ask the warehouse to prepare parcels of this booking for return. Everything is ticked by default; a request for all of them
 * is sent without a parcel list, so it never goes out of date if the warehouse merges or splits parcels meanwhile.
 * Only people with returns.request see this card. The parcels come from a database function, so they need no warehouse access.
 */
export default function ReturnRequestCard({ bookingId, onChanged }: { bookingId: string; onChanged?: () => void }) {
  const { can } = usePermissions();
  const allowed = can("returns.request");
  const canOpenReturn = can("returns.prepare") || can("returns.complete");
  const latest = useQuery<ReturnRequest[]>(
    () =>
      allowed
        ? supabase.from("return_requests").select("*, return:returns(code)").eq("booking_id", bookingId).order("requested_at", { ascending: false }).limit(1)
        : Promise.resolve({ data: [], error: null }),
    [bookingId, allowed]
  );
  const parcels = useQuery<Option[]>(
    () => (allowed ? (supabase.rpc("parcels_for_return_request", { p_booking_id: bookingId }) as never) : Promise.resolve({ data: [], error: null })),
    [bookingId, allowed]
  );

  const [open, setOpen] = useState(false);
  const [unticked, setUnticked] = useState<string[]>([]);
  const [needed, setNeeded] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!allowed || latest.loading || parcels.loading) return null;
  const request = latest.data?.[0];
  const options = parcels.data ?? [];
  const ticked = options.filter((p) => !unticked.includes(p.id));
  const isOpen = request?.status === "open";
  if (!isOpen && request?.status !== "prepared" && !options.length) return null;

  const reload = () => {
    latest.reload();
    parcels.reload();
    onChanged?.();
  };

  async function send() {
    setBusy(true);
    setError(null);
    const all = ticked.length === options.length;
    const { error } = await supabase.rpc("request_return", {
      p_booking_id: bookingId,
      p_note: note.trim() || null,
      p_needed_by: needed || null,
      p_parcel_ids: all ? null : ticked.map((p) => p.id),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false);
    setNote("");
    setNeeded("");
    setUnticked([]);
    reload();
  }

  async function cancel() {
    if (!request) return;
    if (!(await confirmAction({ title: "Cancel this return request?", message: "The warehouse will be told.", confirmLabel: "Cancel request", danger: true }))) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("cancel_return_request", { p_request_id: request.id });
    setBusy(false);
    if (error) setError(error.message);
    reload();
  }

  return (
    <Card title="Return" id="return-request">
      <ErrorMessage message={latest.error ?? parcels.error} />
      {isOpen && request ? (
        <div className="space-y-2 text-sm text-slate-800">
          <p className="font-medium text-slate-900">
            Return requested by {request.requested_by_name ?? "a colleague"} on {formatDate(request.requested_at)}
          </p>
          {request.needed_by && <p>Needed by {formatDay(request.needed_by)}</p>}
          {request.note && <p>{request.note}</p>}
          <p className="text-slate-600">{request.parcel_ids?.length ? `${request.parcel_ids.length} parcel${request.parcel_ids.length === 1 ? "" : "s"} asked for.` : "Every parcel in the warehouse."}</p>
          <ErrorMessage message={error} />
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancel request
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-800">
          {request?.status === "prepared" && (
            <p>
              Prepared as{" "}
              {request.return_id && request.return?.code && canOpenReturn ? (
                <Link href={`/warehouse-inventory/returns/${request.return_id}`} className="font-mono font-medium text-brand-700 underline underline-offset-2">
                  {request.return.code}
                </Link>
              ) : (
                <span className="font-mono font-medium">{request?.return?.code ?? "a return form"}</span>
              )}
              .
            </p>
          )}
          {options.length > 0 && !open && (
            <Button variant="secondary" onClick={() => setOpen(true)}>
              <Undo2 className="h-5 w-5" aria-hidden="true" /> Request return
            </Button>
          )}
          {open && (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-700">Parcels to return</legend>
                <ul className="divide-y divide-slate-100">
                  {options.map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-11 items-center gap-3 py-1">
                        <input
                          type="checkbox"
                          className="h-6 w-6"
                          checked={!unticked.includes(p.id)}
                          onChange={(e) => setUnticked(e.target.checked ? unticked.filter((x) => x !== p.id) : [...unticked, p.id])}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-base font-semibold">{p.barcode}</span>
                          <span className="block text-sm text-slate-600">
                            {p.description || "No description"} · {kg(Number(p.weight_kg))}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <DateField label="Needed by (optional)" value={needed} onChange={setNeeded} future />
              <label className="block text-sm">
                <span className="mb-1 block text-sm text-slate-600">Note for the warehouse (optional)</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={inputClass} />
              </label>
              <ErrorMessage message={error} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={send} disabled={busy || ticked.length === 0}>
                  {busy ? "Sending…" : "Send request"}
                </Button>
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
