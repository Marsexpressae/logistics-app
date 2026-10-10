"use client";

import BookingLink from "@/components/bookings/BookingLink";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, CheckCircle2, FileText, MapPin, Navigation, Printer } from "lucide-react";
import BookingChangePanel from "@/components/bookings/BookingChangePanel";
import DeleteBooking from "@/components/bookings/DeleteBooking";
import WarningBanner from "@/components/customers/WarningBanner";
import IdCard from "@/components/customers/IdCard";
import CustomerCard from "@/components/customers/CustomerCard";
import NotesCard from "@/components/bookings/NotesCard";
import TrackingLink from "@/components/bookings/TrackingLink";
import ItemsCard from "@/components/bookings/ItemsCard";
import PaymentsCard from "@/components/bookings/PaymentsCard";
import ContactCard from "@/components/contact/ContactCard";
import ScheduleHistory from "@/components/bookings/ScheduleHistory";
import { Button, Card, ErrorMessage, StatusBadge, Loading } from "@/components/ui/form";
import { useDay, useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { dateStamp, formatDay } from "@/lib/format";
import { bookingStage } from "@/lib/booking-stage";
import DateField from "@/components/ui/DateField";
import { mapsUrl } from "@/lib/geo";
import type { Booking, BookingItem } from "@/lib/types";
import BackLink from "@/components/ui/BackLink";

export default function PickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canPrint = usePermissions().can("documents.print");
  const booking = useQuery<Booking>(() =>
    supabase.from("bookings").select("*, payments(*), parcels(status)").eq("id", id).single()
  );
  const items = useQuery<BookingItem[]>(() =>
    supabase.from("booking_items").select("*").eq("booking_id", id).order("id")
  );
  // Settings can require the sender's Emirates ID before a pickup is marked collected.
  const needId = useQuery<boolean>(async () => {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "require_id_before_collected").maybeSingle();
    return { data: data?.value === true, error };
  });
  const hasId = useQuery<boolean>(async () => {
    const { count, error } = await supabase.from("id_documents").select("id", { count: "exact", head: true }).eq("booking_id", id).not("emirates_id", "is", null);
    return { data: (count ?? 0) > 0, error };
  }, [id]);
  const [error, setError] = useState<string | null>(null);
  const [collectedOn, setCollectedOn] = useDay(id);
  const [changes, setChanges] = useState(0); // bumps after a reschedule/cancel so the history refreshes

  const b = booking.data;
  if (booking.loading) return <Loading />;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  // Run a write, surface errors, refresh both queries.
  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await action;
    setError(error?.message ?? null);
    booking.reload();
    items.reload();
  }

  // Left as today it is collected now. Pick an earlier day when entering an old pickup: the invoice and receipt show that day.
  const markCollected = () =>
    run(supabase.from("bookings").update({ status: "collected", collected_at: dateStamp(collectedOn) }).eq("id", id));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackLink href="/pickups">Pickups</BackLink>

      <WarningBanner bookingId={id} />

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold">{b.invoice_no ?? b.code}</h1>
            {b.invoice_no && <p className="text-xs text-slate-500">Booking <BookingLink id={b.id} className="text-xs">{b.code}</BookingLink></p>}
          </div>
          <StatusBadge status={bookingStage(b.status, b.parcels)} />
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
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white"
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

      <CustomerCard bookingId={id} />
      <IdCard bookingId={id} onChanged={() => hasId.reload()} />
      <NotesCard bookingId={id} />

      {b.invoice_no && <TrackingLink booking={b} />}

      <ItemsCard bookingId={id} status={b.status} items={items.data ?? []} onChanged={() => items.reload()} />

      <PaymentsCard booking={b} payments={b.payments ?? []} onChanged={() => booking.reload()} />

      <ErrorMessage message={error} />

      {b.status === "booked" && needId.data === true && hasId.data !== true && (
        <p className="text-sm text-amber-800">Enter the customer&apos;s Emirates ID above before marking this pickup collected.</p>
      )}

      {b.status === "booked" && (
        <DateField label="Collected on" value={collectedOn} onChange={setCollectedOn} pastNote="The invoice and receipt will show that day." />
      )}

      <div className="grid gap-2 pb-6 sm:grid-cols-2">
        {b.status === "booked" && (
          <Button onClick={markCollected} disabled={!items.data?.length || (needId.data === true && hasId.data !== true)} className="py-3">
            <CheckCircle2 className="h-4 w-4" /> Mark collected
          </Button>
        )}
        {canPrint && <Link
          href={`/pickups/${id}/receipt`}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
        >
          <Printer className="h-4 w-4" /> Receipt
        </Link>}
        {canPrint && <Link
          href={`/pickups/${id}/invoice`}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
        >
          <FileText className="h-4 w-4" /> Invoice
        </Link>}
      </div>

      {/* Reschedule or cancel this pickup, with a reason. The office is notified automatically. */}
      <BookingChangePanel
        booking={b}
        onChanged={() => {
          booking.reload();
          setChanges((n) => n + 1);
        }}
      />
      <div className="space-y-4 pb-6">
        <ScheduleHistory bookingId={id} reloadKey={changes} />
        <DeleteBooking booking={b} />
      </div>
    </div>
  );
}
