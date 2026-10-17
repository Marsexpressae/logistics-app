"use client";

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import DateField from "@/components/ui/DateField";
import RefundPanel from "@/components/money/RefundPanel";
import { confirmAction } from "@/lib/ask";
import { money as fmt, round2, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Booking, CreditCategory, Money } from "@/lib/types";

type Line = { category: CreditCategory; amount: string; note: string };
const CATEGORIES: { value: CreditCategory; label: string }[] = [
  { value: "transport", label: "Transport" },
  { value: "packing", label: "Packing" },
  { value: "labour", label: "Labour" },
  { value: "other", label: "Other" },
];

/**
 * Lowers an invoice. Services that cannot be refunded (transport, packing, labour ...) are typed as "kept" lines:
 * the new invoice total is the sum of those lines, and the credit is the difference. No money moves here.
 * When the customer has paid more than they now owe, the next step offers the refund.
 */
export default function CreditNotePanel({ booking, money, returns, returnId: startReturn, onDone }: { booking: Booking; money: Money; returns: { id: string; code: string }[]; returnId?: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayISO());
  const [returnId, setReturnId] = useState(startReturn ?? ""); // a return page can open this with its return already chosen
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; money: Money } | null>(null);

  const oldTotal = Number(money.invoice_now);
  const newTotal = round2(lines.reduce((t, l) => t + (Number(l.amount) || 0), 0));
  const credit = round2(oldTotal - newTotal);

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError("Please enter a reason.");
    if (lines.some((l) => !(Number(l.amount) > 0))) return setError("Each kept service needs an amount above zero.");
    if (credit <= 0) return setError(`The new invoice total must be below ${fmt(oldTotal)}.`);
    if (!(await confirmAction({ title: `Credit ${fmt(credit)} on ${booking.invoice_no}?`, message: `The invoice goes from ${fmt(oldTotal)} to ${fmt(newTotal)}. This cannot be edited or deleted. A mistake is fixed by voiding it.`, confirmLabel: "Issue the credit note" }))) return;
    setBusy(true);
    setError(null);
    const made = await supabase.rpc("issue_credit_note", {
      p_booking_id: booking.id,
      p_reason: reason.trim(),
      p_lines: lines.map((l) => ({ category: l.category, amount: Number(l.amount), note: l.note.trim() || null })),
      p_date: date,
      p_return_id: returnId || null,
    });
    if (made.error) {
      setBusy(false);
      return setError(made.error.message);
    }
    const now = await supabase.rpc("booking_money", { p_booking: booking.id });
    setBusy(false);
    const m = now.data as Money | null;
    if (m && Number(m.refund_due) > 0) setSaved({ id: made.data as string, money: m });
    else onDone();
  }

  if (saved) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Credit note issued. The customer is owed {fmt(Number(saved.money.refund_due))}. Record the refund now?
        </p>
        <RefundPanel booking={booking} money={saved.money} creditNoteId={saved.id} onDone={onDone} />
      </div>
    );
  }

  return (
    <Card title="Credit note">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Reason (required)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="For example: parcels returned, customer cancelled" />
        </Field>
        <DateField label="Credit note date" value={date} onChange={setDate} />
        {returns.length > 0 && (
          <Field label="Related return (optional)">
            <select value={returnId} onChange={(e) => setReturnId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {returns.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
          </Field>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Services the customer still pays for (not refundable)</legend>
          {lines.length === 0 && <p className="text-sm text-slate-500">None. The whole invoice will be credited.</p>}
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
              <select aria-label="Service" value={l.category} onChange={(e) => setLine(i, { category: e.target.value as CreditCategory })} className={inputClass}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input aria-label="Amount kept" type="number" inputMode="decimal" min="0.01" step="0.01" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} className={inputClass} />
              <button type="button" aria-label="Remove this service" onClick={() => setLines(lines.filter((_, k) => k !== i))} className="p-3 text-slate-600 hover:text-red-700">
                <X className="h-4 w-4" />
              </button>
              <input aria-label="Note" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} placeholder="Note (optional)" className={`${inputClass} col-span-3`} />
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setLines([...lines, { category: "transport", amount: "", note: "" }])}>
            <Plus className="h-4 w-4" /> Add a kept service
          </Button>
        </fieldset>

        <dl className="space-y-1 rounded-md bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Invoice total now</dt><dd>{fmt(oldTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">New invoice total</dt><dd>{fmt(newTotal)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Credit</dt><dd>{fmt(Math.max(credit, 0))}</dd></div>
        </dl>

        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>Issue credit note</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
