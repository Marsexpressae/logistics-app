"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, MapPin, Phone, Printer, Trash2 } from "lucide-react";
import { Button, Card, ErrorMessage, Field, StatusBadge, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { methodLabel, money, totalPaid } from "@/lib/format";
import type { Booking, BookingItem } from "@/lib/types";

export default function PickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const booking = useQuery<Booking>(() =>
    supabase.from("bookings").select("*, payments(*)").eq("id", id).single()
  );
  const items = useQuery<BookingItem[]>(() =>
    supabase.from("booking_items").select("*").eq("booking_id", id).order("id")
  );
  const [error, setError] = useState<string | null>(null);

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const paid = totalPaid(b.payments);
  const invoiced = b.invoice_amount !== null;
  const totalWeight = (items.data ?? []).reduce((s, i) => s + Number(i.weight_kg) * i.quantity, 0);

  // Run a write, surface errors, refresh both queries.
  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await action;
    setError(error?.message ?? null);
    booking.reload();
    items.reload();
  }

  function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    run(
      supabase.from("booking_items").insert({
        booking_id: id,
        description: String(f.get("description")).trim(),
        quantity: Number(f.get("quantity") || 1),
        weight_kg: Number(f.get("weight_kg") || 0),
      })
    );
    form.reset();
  }

  function addPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    run(
      supabase.from("payments").insert({
        booking_id: id,
        amount: Number(f.get("amount")),
        method: String(f.get("method")),
        received_by_driver: b!.driver_id,
        note: String(f.get("note") ?? "").trim() || null,
      })
    );
    form.reset();
  }

  const markCollected = () =>
    run(supabase.from("bookings").update({ status: "collected", collected_at: new Date().toISOString() }).eq("id", id));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/pickups" className="inline-flex items-center gap-1 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Pickups
      </Link>

      <Card>
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-xl font-semibold">{b.code}</h1>
          <StatusBadge status={b.status} />
        </div>
        <p className="mt-2 font-medium">{b.sender_name}</p>
        <a
          className="mt-1 flex items-start gap-1.5 text-sm text-blue-700"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.pickup_address)}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {b.pickup_address}
        </a>
        {b.sender_phone && (
          <a className="mt-1 flex items-center gap-1.5 text-sm text-blue-700" href={`tel:${b.sender_phone}`}>
            <Phone className="h-4 w-4" /> {b.sender_phone}
          </a>
        )}
        <p className="mt-2 text-sm text-slate-500">
          To: {b.receiver_name}
          {b.receiver_address ? `, ${b.receiver_address}` : ""}
        </p>
      </Card>

      <Card title="Package items">
        {items.data?.length ? (
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {items.data.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2">
                <span>
                  {i.quantity} × {i.description}
                </span>
                <span className="flex items-center gap-3">
                  {Number(i.weight_kg)} kg
                  <button aria-label="Remove item" onClick={() => run(supabase.from("booking_items").delete().eq("id", i.id))}>
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </button>
                </span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-medium">
              <span>Total weight</span>
              <span>{totalWeight} kg</span>
            </li>
          </ul>
        ) : (
          <p className="mb-3 text-sm text-slate-500">No items recorded yet.</p>
        )}
        <form onSubmit={addItem} className="grid grid-cols-3 gap-2">
          <div className="col-span-3">
            <input name="description" required placeholder="Item description" className={inputClass} />
          </div>
          <input name="quantity" type="number" min="1" defaultValue="1" aria-label="Quantity" className={inputClass} />
          <input name="weight_kg" type="number" min="0" step="0.01" placeholder="kg each" aria-label="Weight in kg" className={inputClass} />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card title="Payment">
        <div className="mb-3 grid grid-cols-3 text-center text-sm">
          <div>
            <p className="text-slate-500">{invoiced ? "Invoice" : "Est. bill"}</p>
            <p className="font-semibold">
              {invoiced ? money(b.invoice_amount!) : b.estimated_bill !== null ? `~${money(b.estimated_bill)}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Paid</p>
            <p className="font-semibold">{money(paid)}</p>
          </div>
          <div>
            <p className="text-slate-500">Balance</p>
            <p className="font-semibold">{invoiced ? money(Math.max(Number(b.invoice_amount) - paid, 0)) : "—"}</p>
          </div>
        </div>
        {!!b.payments?.length && (
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {b.payments.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>{methodLabel(p.method)}</span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addPayment} className="grid grid-cols-2 gap-2">
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
            <Button type="submit" className="w-full">
              Log payment
            </Button>
          </div>
        </form>
      </Card>

      <ErrorMessage message={error} />

      <div className="grid gap-2 pb-6 sm:grid-cols-2">
        {b.status === "booked" && (
          <Button onClick={markCollected} disabled={!items.data?.length} className="py-3">
            <CheckCircle2 className="h-4 w-4" /> Mark collected
          </Button>
        )}
        <Link
          href={`/pickups/${id}/receipt`}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
        >
          <Printer className="h-4 w-4" /> Receipt
        </Link>
      </div>
    </div>
  );
}
