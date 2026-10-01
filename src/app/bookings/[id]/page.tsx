"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Ban, Printer } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuditList from "@/components/audit/AuditList";
import BookingForm from "@/components/bookings/BookingForm";
import { Button, Card, ErrorMessage, Field, StatusBadge, inputClass } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { AuditEntry, Booking } from "@/lib/types";

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const booking = useQuery<Booking>(() => supabase.from("bookings").select("*").eq("id", id).single());
  const isAdmin = useCurrentProfile().role === "admin";
  // The change history is admin-only (the database enforces it too).
  const history = useQuery<AuditEntry[]>(() =>
    isAdmin
      ? supabase.from("audit_log").select("*").eq("booking_id", id).order("id", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  );
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  const cancellable = b.status === "booked" || b.status === "collected";

  async function cancel() {
    if (!reason.trim()) return setError("Please enter a reason for cancelling.");
    if (!confirm(`Cancel booking ${b!.code}? This cannot be undone.`)) return;
    const { error } = await supabase.rpc("cancel_booking", { p_booking_id: id, p_reason: reason });
    if (error) return setError(error.message);
    setError(null);
    setCancelling(false);
    setReason("");
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

      {b.status === "cancelled" && (
        <p className="mb-4 max-w-3xl rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Cancelled{b.cancelled_at ? ` on ${formatDate(b.cancelled_at)}` : ""}.</span>{" "}
          Reason: {b.cancellation_reason}
        </p>
      )}

      <BookingForm booking={b} submitLabel="Save changes" onSaved={() => router.push("/bookings")} />

      <div className="mt-6 max-w-3xl space-y-2">
        <ErrorMessage message={error} />
        {cancellable && !cancelling && (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            <Ban className="h-4 w-4" /> Cancel booking
          </Button>
        )}
        {cancellable && cancelling && (
          <Card title="Cancel this booking">
            <Field label="Reason for cancellation (required)">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. Customer changed their mind, duplicate booking, unreachable…"
                className={inputClass}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button variant="danger" onClick={cancel} disabled={!reason.trim()}>
                Confirm cancellation
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setCancelling(false);
                  setReason("");
                  setError(null);
                }}
              >
                Keep booking
              </Button>
            </div>
          </Card>
        )}
      </div>

      {isAdmin && !!history.data?.length && (
        <Card title="History" className="mt-6 max-w-3xl">
          <AuditList entries={history.data} />
        </Card>
      )}
    </>
  );
}
