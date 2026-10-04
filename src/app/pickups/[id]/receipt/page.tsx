"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, ErrorMessage } from "@/components/ui/form";
import { site } from "@/config/site";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDate, kg, methodLabel, money, round2, totalPaid } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { Booking, BookingItem } from "@/lib/types";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const booking = useQuery<Booking>(() =>
    supabase.from("bookings").select("*, driver:drivers(name), payments(*)").eq("id", id).single()
  );
  const items = useQuery<BookingItem[]>(() =>
    supabase.from("booking_items").select("*").eq("booking_id", id).order("id")
  );

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const paid = totalPaid(b.payments);
  const invoiced = b.invoice_amount !== null;
  const totalWeight = (items.data ?? []).reduce((s, i) => s + Number(i.weight_kg) * i.quantity, 0);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex justify-between print:hidden">
        <Link href={`/pickups/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm print:border-0 print:p-0">
        <div className="border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">{site.name}</p>
          <h1 className="text-sm font-medium uppercase text-slate-600">Cargo Pickup Receipt</h1>
          <p className="font-mono text-lg">{b.invoice_no ?? b.code}</p>
          <p className="font-mono text-xs text-slate-500">
            {b.invoice_no ? `Invoice ${b.invoice_no} · Booking ${b.code}` : `Booking ${b.code} · invoice number is issued when collected`}
          </p>
          <p className="text-slate-500">{formatDate(b.collected_at ?? b.created_at)}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 py-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Sender</p>
            <p className="font-medium">{b.sender_name}</p>
            <p>{formatPhone(b.sender_phone)}</p>
            <p>{b.pickup_address}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Receiver</p>
            <p className="font-medium">{b.receiver_name ?? "To be confirmed"}</p>
            <p>{formatPhone(b.receiver_phone)}</p>
            <p>{b.receiver_address}</p>
          </div>
        </div>

        <table className="w-full border-t border-slate-300 text-left">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="py-1.5">{i.description}</td>
                <td className="py-1.5 text-right">{i.quantity}</td>
                <td className="py-1.5 text-right">{kg(Number(i.weight_kg) * i.quantity)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-medium">
              <td className="py-2" colSpan={2}>
                Total weight
              </td>
              <td className="py-2 text-right">{kg(totalWeight)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2 border-t border-slate-300 pt-3">
          <div className="flex justify-between">
            <span>{invoiced ? "Invoice amount" : "Estimated bill (approx.)"}</span>
            <span>
              {invoiced ? money(b.invoice_amount!) : b.estimated_bill !== null ? `~${money(b.estimated_bill)}` : "—"}
            </span>
          </div>
          {b.payments?.map((p) => (
            <div key={p.id} className="flex justify-between text-slate-600">
              <span>
                Paid – {methodLabel(p.method)} ({formatDate(p.created_at)})
              </span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between font-semibold">
            <span>Total received</span>
            <span>{money(paid)}</span>
          </div>
          {invoiced ? (
            <div className="flex justify-between">
              <span>Balance</span>
              <span>{money(Math.max(round2(Number(b.invoice_amount) - paid), 0))}</span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Final bill will be confirmed on the invoice.</p>
          )}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">Driver{b.driver ? `: ${b.driver.name}` : ""}</div>
          <div className="border-t border-slate-400 pt-1">Customer signature</div>
        </div>
      </div>
    </div>
  );
}
