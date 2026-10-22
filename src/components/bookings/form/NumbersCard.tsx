"use client";

import { Card, Field, inputClass } from "@/components/ui/form";
import BookingLink from "@/components/bookings/BookingLink";
import type { NumberCheck } from "@/lib/number-check";
import type { Booking } from "@/lib/types";
import type { BookingNumbers } from "./useBookingNumbers";

/** The fixed prefix from Settings, then a box for the digits only. An old number with a different prefix is shown but kept as it is. */
function NumberPart({ prefix, current, value, onChange, placeholder, invalid }: { prefix: string; current: string | null; value: string; onChange: (v: string) => void; placeholder: string; invalid?: boolean }) {
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
        aria-invalid={invalid || undefined}
        className={`${inputClass} rounded-l-none font-mono ${invalid ? "border-red-600 focus:border-red-600 focus:ring-red-600" : ""}`}
      />
    </div>
  );
}

/** The live answer under a number box. It is announced to screen readers when it changes. */
function CheckNote({ check, message }: { check: NumberCheck; message: string | null }) {
  return (
    <p role="status" className={`mt-1 min-h-5 text-sm ${check.state === "taken" ? "font-medium text-red-700" : "text-green-700"}`}>
      {check.state === "taken" && check.by ? (
        <>
          {message} <BookingLink id={check.by.id}>Open booking</BookingLink>
        </>
      ) : check.state === "free" ? (
        "Free"
      ) : null}
    </p>
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
            invalid={n.bookingCheck.state === "taken"}
          />
          <CheckNote check={n.bookingCheck} message={n.bookingTaken} />
        </Field>
        {booking?.invoice_no && (
          <Field label="Invoice number">
            <NumberPart
              prefix={n.invoicePrefix}
              current={booking.invoice_no}
              value={n.invoiceValue}
              onChange={n.setInvoiceDigits}
              placeholder={n.nextInvoice ? `Automatic, next is ${n.nextInvoice}` : "Automatic when collected"}
              invalid={n.invoiceCheck.state === "taken"}
            />
            <CheckNote check={n.invoiceCheck} message={n.invoiceTaken} />
          </Field>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Leave empty for the automatic number. The prefix is set in Settings and cannot be changed here. A typed number must be unique.
        {booking?.invoice_no
          ? " The booking number cannot change once parcels exist, and an invoice number can be changed but not removed."
          : " The booking number cannot change once parcels exist. The invoice number is issued when the cargo is collected."}
      </p>
    </Card>
  );
}
