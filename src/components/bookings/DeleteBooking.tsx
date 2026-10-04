"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Card, ErrorMessage, inputClass } from "@/components/ui/form";
import { money, round2 } from "@/lib/format";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

type Counts = { items: number; packages: number; shipped: number; payments: number; paid: number; returns: number; notes: number };

/**
 * Delete a booking. A booking, its pickup and its invoice are one job, so this removes all three, with its packages,
 * notes and history. It shows exactly what will go, asks for a reason, and for the booking code to be typed.
 * Everything deleted stays in the Activity log.
 */
export default function DeleteBooking({ booking }: { booking: Booking }) {
  const router = useRouter();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [withPayments, setWithPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!can("bookings.delete")) return null;

  async function start() {
    setOpen(true);
    setError(null);
    const [items, parcels, payments, returns, notes] = await Promise.all([
      supabase.from("booking_items").select("id").eq("booking_id", booking.id),
      supabase.from("parcels").select("id, status").eq("booking_id", booking.id),
      supabase.from("payments").select("amount").eq("booking_id", booking.id),
      supabase.from("returns").select("id").eq("booking_id", booking.id),
      supabase.from("booking_notes").select("id").eq("booking_id", booking.id),
    ]);
    const ps = (parcels.data ?? []) as { status: string }[];
    const pay = (payments.data ?? []) as { amount: number }[];
    setCounts({
      items: items.data?.length ?? 0,
      packages: ps.filter((p) => p.status !== "repacked").length,
      shipped: ps.filter((p) => ["loaded", "in_transit", "arrived", "delivered"].includes(p.status)).length,
      payments: pay.length,
      paid: round2(pay.reduce((s, p) => s + Number(p.amount), 0)),
      returns: returns.data?.length ?? 0,
      notes: notes.data?.length ?? 0,
    });
  }

  const name = booking.invoice_no ?? booking.code;
  const needsPaymentsOk = (counts?.payments ?? 0) > 0;
  const mayDeletePayments = can("payments.manage");
  const ready =
    !!counts && !counts.shipped && reason.trim().length > 0 && typed.trim().toUpperCase() === booking.code && (!needsPaymentsOk || (withPayments && mayDeletePayments));

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("delete_booking", { p_booking_id: booking.id, p_reason: reason, p_with_payments: withPayments });
    setBusy(false);
    if (error) return setError(error.message.replace(/^PAYMENTS_EXIST : /, ""));
    router.push("/bookings");
  }

  if (!open) {
    return (
      <div className="max-w-3xl">
        <Button variant="secondary" onClick={start} className="text-red-700">
          <Trash2 className="h-4 w-4" /> Delete this booking…
        </Button>
      </div>
    );
  }

  return (
    <Card title={`Delete ${name}`} className="max-w-3xl border-red-200">
      {!counts ? (
        <p className="text-sm text-slate-500">Checking what is attached…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-700">
            This permanently deletes the booking, its pickup and its invoice <span className="font-mono font-medium">{name}</span>, together with:
          </p>
          <ul className="list-inside list-disc text-slate-700">
            <li>{counts.items} {counts.items === 1 ? "item" : "items"}</li>
            <li>{counts.packages} {counts.packages === 1 ? "package" : "packages"} in the warehouse</li>
            {counts.returns > 0 && <li>{counts.returns} return {counts.returns === 1 ? "form" : "forms"}</li>}
            {counts.notes > 0 && <li>{counts.notes} {counts.notes === 1 ? "note" : "notes"}</li>}
            <li>its history</li>
            {counts.payments > 0 && (
              <li className="font-medium text-red-700">
                {counts.payments} {counts.payments === 1 ? "payment" : "payments"}, {money(counts.paid)} in total (only if you tick the box below)
              </li>
            )}
          </ul>

          {counts.shipped > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
              {counts.shipped} {counts.shipped === 1 ? "package has" : "packages have"} shipped (in a container, in transit or delivered). That history must stay, so this
              cannot be deleted. Cancel the booking instead, or unload the packages from the container first.
            </p>
          )}

          {needsPaymentsOk && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={withPayments} onChange={(e) => setWithPayments(e.target.checked)} disabled={!mayDeletePayments} />
              <span>
                Also delete the recorded payments ({money(counts.paid)}).
                {!mayDeletePayments && <span className="block text-xs text-slate-500">You need the permission &quot;Edit or delete payments&quot; for this.</span>}
              </span>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Reason (required)</span>
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test entry, duplicate booking" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">
              Type the booking number <span className="font-mono">{booking.code}</span> to confirm
            </span>
            <input className={`${inputClass} font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
          </label>

          <p className="text-xs text-slate-500">A copy of everything deleted stays in the Activity log, with your name and the reason.</p>
          <ErrorMessage message={error} />
          <div className="flex gap-2">
            <Button variant="danger" onClick={remove} disabled={busy || !ready}>
              <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
