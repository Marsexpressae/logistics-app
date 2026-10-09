"use client";

import { Card, Field, inputClass } from "@/components/ui/form";
import type { Booking } from "@/lib/types";
import type { BookingNumbers } from "./useBookingNumbers";

/** The fixed prefix from Settings, then a box for the digits only. An old number with a different prefix is shown but kept as it is. */
function NumberPart({ prefix, current, value, onChange, placeholder }: { prefix: string; current: string | null; value: string; onChange: (v: string) => void; placeholder: string }) {
  const legacy = !!current && !!prefix && !current.toUpperCase().startsWith(prefix.toUpperCase());
  if (legacy) return <input value={current ?? ""} readOnly className={`${inputClass} cursor-not-allowed bg-slate-100 font-mono text-slate-600`} />;
  return (
    <div className="flex">
      <span className="flex min-h-11 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-100 px-3 font-mono text-sm text-slate-700 sm:min-h-10 coarse:min-h-11">{prefix || "…"}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        placeholder={placeholder}
        className={`${inputClass} rounded-l-none font-mono`}
      />
    </div>
  );
}

export default function NumbersCard({ booking, numbers: n }: { booking?: Booking; numbers: BookingNumbers }) {
  return (
    <Card title="Numbers" id="numbers-editor">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Booking number">
          <NumberPart
            prefix={n.bookingPrefix}
            current={booking?.code ?? null}
            value={n.bookingValue}
            onChange={n.setBookingDigits}
            placeholder={n.nextBooking ? `Automatic, next is ${n.nextBooking}` : "Automatic"}
          />
        </Field>
        {booking?.invoice_no && (
          <Field label="Invoice number">
            <NumberPart
              prefix={n.invoicePrefix}
              current={booking.invoice_no}
              value={n.invoiceValue}
              onChange={n.setInvoiceDigits}
              placeholder={n.nextInvoice ? `Automatic, next is ${n.nextInvoice}` : "Automatic when collected"}
            />
          </Field>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Leave empty for the automatic number. The prefix is set in Settings and cannot be changed here. A typed number must be unique.
        {booking?.invoice_no
          ? " The booking number cannot change once parcels exist, and an invoice number can be changed but not removed."
          : " The booking number cannot change once parcels exist. The invoice number is issued when the cargo is collected."}
      </p>
    </Card>
  );
}
