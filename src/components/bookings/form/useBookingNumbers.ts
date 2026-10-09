"use client";

import { useState } from "react";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

type Kind = "booking" | "invoice";

/**
 * The booking and invoice number boxes. The prefix (BK-, INV-) is chosen in Settings only, so people type just the digits
 * after it, and the hint shows the next free automatic number (worked out by the database, which skips numbers already used).
 * `enabled` is true only while the numbers card is on screen, so a closed card costs no requests.
 */
export function useBookingNumbers(booking: Booking | undefined, enabled: boolean) {
  const series = useQuery<{ kind: Kind; prefix: string }[]>(
    () => (enabled ? (supabase.from("number_series").select("kind, prefix") as never) : Promise.resolve({ data: null, error: null })),
    [enabled]
  );
  const preview = (kind: Kind, wanted: boolean) => () =>
    wanted ? (supabase.rpc("next_number_preview", { p_kind: kind }) as never) : Promise.resolve({ data: null, error: null });
  const nextBooking = useQuery<string | null>(preview("booking", enabled), [enabled]);
  const nextInvoice = useQuery<string | null>(preview("invoice", enabled && !!booking?.invoice_no), [enabled, booking?.invoice_no]);

  const prefixOf = (kind: Kind) => series.data?.find((x) => x.kind === kind)?.prefix ?? "";
  const bookingPrefix = prefixOf("booking");
  const invoicePrefix = prefixOf("invoice");
  const digitsOf = (value: string | null | undefined, prefix: string) => (value && prefix && value.toUpperCase().startsWith(prefix.toUpperCase()) ? value.slice(prefix.length) : "");
  const hintOf = (full: string | null, prefix: string) => (full ? digitsOf(full, prefix) || full : undefined);

  const [bookingDigits, setBookingDigits] = useState<string | null>(null);
  const [invoiceDigits, setInvoiceDigits] = useState<string | null>(null);

  return {
    bookingPrefix,
    invoicePrefix,
    bookingValue: bookingDigits ?? digitsOf(booking?.code, bookingPrefix),
    invoiceValue: invoiceDigits ?? digitsOf(booking?.invoice_no, invoicePrefix),
    setBookingDigits,
    setInvoiceDigits,
    nextBooking: hintOf(nextBooking.data, bookingPrefix),
    nextInvoice: hintOf(nextInvoice.data, invoicePrefix),
    /** What to send with the booking: only numbers somebody typed, always with the prefix from Settings. */
    typed() {
      const code = bookingDigits ? `${bookingPrefix}${bookingDigits}` : "";
      const invoice = invoiceDigits ? `${invoicePrefix}${invoiceDigits}` : "";
      const out: { code?: string; invoice_no?: string } = {};
      if (code && code !== booking?.code) out.code = code;
      if (invoice && invoice !== (booking?.invoice_no ?? "")) out.invoice_no = invoice;
      return out;
    },
  };
}

export type BookingNumbers = ReturnType<typeof useBookingNumbers>;
