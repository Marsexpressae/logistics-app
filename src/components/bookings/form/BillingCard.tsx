"use client";

import { Card, Field, inputClass } from "@/components/ui/form";
import type { Booking } from "@/lib/types";

/** Money and anything else worth noting. The final invoice amount only exists on a booking that is already saved. */
export default function BillingCard({ booking }: { booking?: Booking }) {
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
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Notes">
          <input name="notes" defaultValue={booking?.notes ?? ""} className={inputClass} />
        </Field>
      </div>
    </Card>
  );
}
