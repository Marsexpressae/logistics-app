"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, Printer } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import BookingForm from "@/components/bookings/BookingForm";
import { Button, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const booking = useQuery<Booking>(() => supabase.from("bookings").select("*").eq("id", id).single());
  const [error, setError] = useState<string | null>(null);

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const cancellable = b.status === "booked" || b.status === "collected";

  async function cancel() {
    if (!confirm(`Cancel booking ${b!.code}? This cannot be undone.`)) return;
    const { error } = await supabase.rpc("cancel_booking", { p_booking_id: id });
    if (error) return setError(error.message);
    booking.reload();
  }

  return (
    <>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Bookings
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={`Edit ${b.code}`} description="Update details, reassign the driver, or cancel." />
        <div className="flex items-center gap-3">
          <StatusBadge status={b.status} />
          <Link
            href={`/pickups/${id}/receipt`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700"
          >
            <Printer className="h-4 w-4" /> Receipt
          </Link>
        </div>
      </div>

      <BookingForm booking={b} submitLabel="Save changes" onSaved={() => router.push("/bookings")} />

      <div className="mt-6 max-w-3xl space-y-2">
        <ErrorMessage message={error} />
        {cancellable && (
          <Button variant="danger" onClick={cancel}>
            <Ban className="h-4 w-4" /> Cancel booking
          </Button>
        )}
      </div>
    </>
  );
}
