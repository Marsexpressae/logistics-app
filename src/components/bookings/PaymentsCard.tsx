"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { formatDate, methodLabel, money, totalPaid } from "@/lib/format";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Payment } from "@/lib/types";

type PaymentsCardProps = {
  booking: Booking;
  payments: Payment[];
  onChanged: () => void;
};

/**
 * Money recorded against a booking. Shared by the pickup page and the booking page.
 *   - recording a payment: the pickup team and the office
 *   - correcting or removing one: the same people; the Activity log records every change
 * Every change is saved straight away and recorded in the Activity log.
 */
export default function PaymentsCard({ booking, payments, onChanged }: PaymentsCardProps) {
  const { can } = usePermissions();
  const canRecord = can("pickups.collect") || can("payments.manage") || can("bookings.edit");
  const canCorrect = canRecord; // the whole team can correct; the Activity log keeps every change

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: "", method: "cash", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...payments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const paid = totalPaid(sorted);
  const invoiced = booking.invoice_amount !== null;

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action;
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    onChanged();
    return true;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const amount = Number(f.get("amount"));
    const method = String(f.get("method"));

    // The classic slip: tapping "Log payment" twice. Ask before recording an identical one a moment later.
    const recent = sorted.find(
      (p) => Number(p.amount) === amount && p.method === method && Date.now() - new Date(p.created_at).getTime() < 15 * 60_000
    );
    if (recent && !confirm(`A payment of ${money(amount)} (${methodLabel(method)}) was already recorded a few minutes ago.\n\nRecord another one?`)) {
      return;
    }

    const ok = await run(
      supabase.from("payments").insert({
        booking_id: booking.id,
        amount,
        method,
        received_by_driver: booking.driver_id,
      })
    );
    if (ok) form.reset();
  }

  function startEdit(p: Payment) {
    setEditingId(p.id);
    setDraft({ amount: String(Number(p.amount)), method: p.method, note: p.note ?? "" });
    setError(null);
  }

  async function saveEdit() {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return setError("Enter an amount above zero.");
    const ok = await run(
      supabase
        .from("payments")
        .update({ amount, method: draft.method, note: draft.note.trim() || null })
        .eq("id", editingId!)
    );
    if (ok) setEditingId(null);
  }

  function remove(p: Payment) {
    const sure = confirm(
      `Delete the ${methodLabel(p.method)} payment of ${money(p.amount)}?\n\nThis is saved straight away and recorded in the Activity log.`
    );
    if (sure) run(supabase.from("payments").delete().eq("id", p.id));
  }

  return (
    <Card title="Payment">
      <div className="mb-3 grid grid-cols-3 text-center text-sm">
        <div>
          <p className="text-slate-500">{invoiced ? "Invoice" : "Est. bill"}</p>
          <p className="font-semibold">
            {invoiced ? money(booking.invoice_amount!) : booking.estimated_bill !== null ? `~${money(booking.estimated_bill)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Paid</p>
          <p className="font-semibold">{money(paid)}</p>
        </div>
        <div>
          <p className="text-slate-500">Balance</p>
          <p className="font-semibold">{invoiced ? money(Math.max(Number(booking.invoice_amount) - paid, 0)) : "—"}</p>
        </div>
      </div>

      {sorted.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {sorted.map((p) =>
            editingId === p.id ? (
              <li key={p.id} className="space-y-2 py-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    aria-label="Amount"
                    className={inputClass}
                  />
                  <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })} aria-label="Method" className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </div>
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="Why is it being corrected? (optional)"
                  aria-label="Note"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <Button onClick={saveEdit} disabled={busy}>
                    <Check className="h-4 w-4" /> Save
                  </Button>
                  <Button variant="secondary" onClick={() => setEditingId(null)}>
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{methodLabel(p.method)}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(p.created_at)}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-medium">{money(p.amount)}</span>
                  {canCorrect && (
                    <>
                      <button aria-label={`Edit payment of ${money(p.amount)}`} onClick={() => startEdit(p)} className="p-2 text-slate-400 hover:text-slate-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button aria-label={`Delete payment of ${money(p.amount)}`} onClick={() => remove(p)} className="p-2 text-slate-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          )}
        </ul>
      )}

      {canRecord && (
        <form onSubmit={add} className="grid grid-cols-2 gap-2">
          <Field label="Amount collected">
            <input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} />
          </Field>
          <Field label="Method">
            <select name="method" defaultValue="cash" className={inputClass}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </Field>
          <div className="col-span-2">
            <Button type="submit" className="w-full" disabled={busy}>
              Log payment
            </Button>
          </div>
        </form>
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}
