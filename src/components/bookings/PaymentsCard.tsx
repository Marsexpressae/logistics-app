"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, ErrorMessage, Field, StatusBadge, inputClass } from "@/components/ui/form";
import { dateStamp, formatDate, todayISO, invoiceStatus, methodLabel, money, round2, totalPaid } from "@/lib/format";
import DateField from "@/components/ui/DateField";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Payment } from "@/lib/types";
import { confirmAction } from "@/lib/ask";

type PaymentsCardProps = {
  booking: Booking;
  payments: Payment[];
  onChanged: () => void;
};

/**
 * Money recorded against a booking. Shared by the pickup page and the booking page.
 *   - recording a payment: the pickup team and the office
 *   - correcting or removing one: only roles granted "Edit or delete payments" on the Roles page
 * Every change is saved straight away and recorded in the Activity log.
 */
export default function PaymentsCard({ booking, payments, onChanged }: PaymentsCardProps) {
  const { can } = usePermissions();
  const canRecord = can("pickups.collect") || can("payments.manage");
  const canCorrect = can("payments.manage"); // who has it is set on the Roles page

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: "", method: "cash", note: "", date: todayISO() });
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
    if (recent && !(await confirmAction({ title: "Record another payment?", message: `A payment of ${money(amount)} (${methodLabel(method)}) was already recorded a few minutes ago.`, confirmLabel: "Yes, record it" }))) {
      return;
    }

    const ok = await run(
      supabase.from("payments").insert({
        booking_id: booking.id,
        amount,
        method,
        received_by_driver: booking.driver_id,
        // the day the money was really received (today unless you pick an earlier day)
        ...(String(f.get("paid_on") || todayISO()) !== todayISO() ? { created_at: dateStamp(String(f.get("paid_on"))) } : {}),
      })
    );
    if (ok) form.reset();
  }

  function startEdit(p: Payment) {
    setEditingId(p.id);
    setDraft({ amount: String(Number(p.amount)), method: p.method, note: p.note ?? "", date: p.created_at.slice(0, 10) });
    setError(null);
  }

  async function saveEdit() {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return setError("Enter an amount above zero.");
    const ok = await run(
      supabase
        .from("payments")
        .update({ amount, method: draft.method, note: draft.note.trim() || null, ...(draft.date && draft.date !== sorted.find((x) => x.id === editingId)?.created_at.slice(0, 10) ? { created_at: dateStamp(draft.date) } : {}) })
        .eq("id", editingId!)
    );
    if (ok) setEditingId(null);
  }

  async function remove(p: Payment) {
    const sure = await confirmAction({
      title: `Delete the ${methodLabel(p.method)} payment of ${money(p.amount)}?`,
      message: "This is saved straight away and recorded in the Activity log.",
      confirmLabel: "Delete",
      danger: true,
    });
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
          <p className="font-semibold">{invoiced ? money(Math.max(round2(Number(booking.invoice_amount) - paid), 0)) : "—"}</p>
        </div>
      </div>

      {invoiced && (
        <p className="-mt-1 mb-3 flex items-center justify-center gap-2 text-sm">
          <StatusBadge status={invoiceStatus(Number(booking.invoice_amount), paid)} />
          {round2(paid - Number(booking.invoice_amount)) > 0 && (
            <span className="text-amber-700">Overpaid by {money(round2(paid - Number(booking.invoice_amount)))}</span>
          )}
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {sorted.map((p) =>
            editingId === p.id ? (
              <li key={p.id} className="space-y-2 py-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
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
                <DateField label="Payment date" value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />
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
                      <button aria-label={`Edit payment of ${money(p.amount)}`} onClick={() => startEdit(p)} className="p-3 text-slate-600 hover:text-slate-900">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button aria-label={`Delete payment of ${money(p.amount)}`} onClick={() => remove(p)} className="p-3 text-slate-600 hover:text-red-700">
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
            <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required className={inputClass} />
          </Field>
          <Field label="Method">
            <select name="method" defaultValue="cash" className={inputClass}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </Field>
          <div className="col-span-2">
            <DateField label="Payment date" name="paid_on" />
          </div>
          <div className="col-span-2">
            <Button type="submit" className="w-full" disabled={busy}>
              Log payment
            </Button>
          </div>
        </form>
      )}
      {!canCorrect && sorted.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Wrong amount? Ask the office to correct it.</p>
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}
