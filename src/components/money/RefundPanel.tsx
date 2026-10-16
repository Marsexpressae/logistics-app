"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import DateField from "@/components/ui/DateField";
import { confirmAction } from "@/lib/ask";
import { methodLabel, money as fmt, todayISO } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Booking, Money } from "@/lib/types";

/**
 * Hands money back to the customer: the amount starts at everything owed (refund due) and can be lowered.
 * Works after a credit note (creditNoteId) or for a plain overpayment. The database refuses more than the refund due.
 */
export default function RefundPanel({ booking, money, creditNoteId, onDone }: { booking: Booking; money: Money; creditNoteId?: string; onDone: () => void }) {
  const due = Number(money.refund_due);
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return setError("Enter an amount above zero.");
    if (value > due) return setError(`The most you can refund is ${fmt(due)}.`);
    if (!(await confirmAction({ title: `Refund ${fmt(value)} by ${methodLabel(method).toLowerCase()}?`, message: "This cannot be edited or deleted. A mistake is fixed by voiding it.", confirmLabel: "Record the refund" }))) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("record_refund", {
      p_booking_id: booking.id,
      p_credit_note_id: creditNoteId ?? null,
      p_amount: value,
      p_method: method,
      p_date: date,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <Card title="Refund the customer">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-600">The customer is owed {fmt(due)}.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount refunded">
            <input type="number" inputMode="decimal" min="0.01" max={due} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </Field>
        </div>
        <DateField label="Refund date" value={date} onChange={setDate} />
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
        <ErrorMessage message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>Record refund</Button>
          <Button type="button" variant="secondary" onClick={onDone}>{creditNoteId ? "Later" : "Cancel"}</Button>
        </div>
      </form>
    </Card>
  );
}
