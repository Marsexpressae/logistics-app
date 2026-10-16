"use client";

import { Card, Field, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

/** Money and anything else worth noting. The final invoice amount only exists on a booking that is already saved. */
export default function BillingCard({ booking }: { booking?: Booking }) {
  // Once a credit note or a refund exists the invoice amount is fixed (the database refuses a change); a wrong amount is fixed with another credit note.
  const locked = useQuery<boolean>(async () => {
    if (!booking) return { data: false, error: null };
    const [notes, refunds] = await Promise.all([
      supabase.from("credit_notes").select("id").eq("booking_id", booking.id).eq("status", "active").limit(1),
      supabase.from("refunds").select("id").eq("booking_id", booking.id).eq("status", "active").limit(1),
    ]);
    return { data: !!notes.data?.length || !!refunds.data?.length, error: null };
  }, [booking?.id]).data;
  return (
    <Card title="Billing & notes">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Approx. bill (estimate)">
          <input
            name="estimated_bill"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Rough idea, optional"
            defaultValue={booking?.estimated_bill ?? ""}
            className={inputClass}
          />
        </Field>
        {booking && (
          <Field label="Invoice amount (once billed)">
            <input
              name="invoice_amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Final bill after invoice"
              defaultValue={booking.invoice_amount ?? ""}
              readOnly={!!locked}
              className={`${inputClass} ${locked ? "bg-slate-50 text-slate-600" : ""}`}
            />
            {locked && <span className="mt-1 block text-xs text-slate-500">This invoice has a credit note or a refund, so its amount cannot be changed. Issue a credit note instead.</span>}
          </Field>
        )}
        <Field label="Notes">
          <input name="notes" defaultValue={booking?.notes ?? ""} className={inputClass} />
        </Field>
      </div>
    </Card>
  );
}
