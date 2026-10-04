"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin, Navigation, Printer } from "lucide-react";
import BookingChangePanel from "@/components/bookings/BookingChangePanel";
import TrackingLink from "@/components/bookings/TrackingLink";
import ItemsCard from "@/components/bookings/ItemsCard";
import PaymentsCard from "@/components/bookings/PaymentsCard";
import ContactCard from "@/components/contact/ContactCard";
import ScheduleHistory from "@/components/bookings/ScheduleHistory";
import { Button, Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { formatDay } from "@/lib/format";
import { mapsUrl } from "@/lib/geo";
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
  const [changes, setChanges] = useState(0); // bumps after a reschedule/cancel so the history refreshes

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  // Run a write, surface errors, refresh both queries.
  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await action;
    setError(error?.message ?? null);
    booking.reload();
    items.reload();
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
          <div>
            <h1 className="font-mono text-xl font-semibold">{b.invoice_no ?? b.code}</h1>
            {b.invoice_no && <p className="font-mono text-xs text-slate-500">Booking {b.code}</p>}
          </div>
          <StatusBadge status={b.status} />
        </div>
        <p className="mt-2 font-medium">{b.sender_name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
          <CalendarDays className="h-4 w-4" /> {formatDay(b.pickup_date)}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-700">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">{b.pickup_area}</span> · {b.pickup_address}
          </span>
        </p>
        <a
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white"
          href={mapsUrl(b)}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation className="h-4 w-4" /> {b.geo_lat !== null ? "Navigate to pin" : "Find on map"}
        </a>
        <ContactCard
          bookingId={id}
          party="sender"
          name={b.sender_name}
          phone={b.sender_phone}
          whatsapp={b.sender_whatsapp}
          onChanged={() => booking.reload()}
        />
        <p className="mt-2 text-sm text-slate-500">
          To: {b.receiver_name ?? "receiver not set yet"}
          {b.receiver_address ? `, ${b.receiver_address}` : ""}
        </p>
        {b.receiver_phone && (
          <ContactCard
            bookingId={id}
            party="receiver"
            name={b.receiver_name}
            phone={b.receiver_phone}
            whatsapp={b.receiver_whatsapp}
            onChanged={() => booking.reload()}
          />
        )}
      </Card>

      {b.invoice_no && <TrackingLink booking={b} />}

      <ItemsCard bookingId={id} status={b.status} items={items.data ?? []} onChanged={() => items.reload()} />

      <PaymentsCard booking={b} payments={b.payments ?? []} onChanged={() => booking.reload()} />

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

      {/* Reschedule or cancel this pickup, with a reason. The office is notified automatically. */}
      <BookingChangePanel
        booking={b}
        onChanged={() => {
          booking.reload();
          setChanges((n) => n + 1);
        }}
      />
      <div className="pb-6">
        <ScheduleHistory bookingId={id} reloadKey={changes} />
      </div>
    </div>
  );
}
