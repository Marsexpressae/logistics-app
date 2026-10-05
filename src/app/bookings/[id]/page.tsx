"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuditList from "@/components/audit/AuditList";
import BookingChangePanel from "@/components/bookings/BookingChangePanel";
import BookingForm from "@/components/bookings/BookingForm";
import DeleteBooking from "@/components/bookings/DeleteBooking";
import CustomerCard from "@/components/customers/CustomerCard";
import NotesCard from "@/components/bookings/NotesCard";
import TrackingLink from "@/components/bookings/TrackingLink";
import ItemsCard from "@/components/bookings/ItemsCard";
import PaymentsCard from "@/components/bookings/PaymentsCard";
import ScheduleHistory from "@/components/bookings/ScheduleHistory";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { AuditEntry, Booking, BookingItem, Payment } from "@/lib/types";

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const booking = useQuery<Booking>(() => supabase.from("bookings").select("*").eq("id", id).single());
  const { can } = usePermissions();
  const canEdit = can("bookings.edit");
  const canSeeHistory = can("activity.view");
  // The full activity log needs the activity.view permission (the database enforces it too).
  const history = useQuery<AuditEntry[]>(() =>
    canSeeHistory
      ? supabase.from("audit_log").select("*").eq("booking_id", id).order("id", { ascending: false })
      : Promise.resolve({ data: [], error: null })
  );
  const items = useQuery<BookingItem[]>(() =>
    supabase.from("booking_items").select("*").eq("booking_id", id).order("id")
  );
  const payments = useQuery<Payment[]>(() =>
    supabase.from("payments").select("*").eq("booking_id", id).order("created_at")
  );
  const seesMoney = can("accounts.view") || can("pickups.collect") || can("payments.manage");
  const [changes, setChanges] = useState(0); // bumps after a reschedule/cancel so the history refreshes

  const b = booking.data;
  if (booking.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!b) return <ErrorMessage message={booking.error ?? "Booking not found"} />;

  return (
    <>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Bookings
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={`${canEdit ? "Edit" : "View"} ${b.code}`}
          description={`${b.invoice_no ? `Invoice ${b.invoice_no}. ` : "No invoice yet (issued when collected). "}${canEdit ? "Update details, reassign the driver, reschedule or cancel." : "You can view this booking but not change it."}`}
        />
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

      {/* Reschedule / cancel, each with a reason. The other party is notified automatically. */}
      <div className="mb-4 max-w-3xl">
        <BookingChangePanel
          booking={b}
          onChanged={() => {
            booking.reload();
            history.reload();
            setChanges((n) => n + 1);
          }}
        />
      </div>

      {/* Without bookings.edit the whole form is read-only (the database blocks the write anyway). */}
      <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
        <BookingForm key={b.updated_at} booking={b} submitLabel="Save changes" onSaved={() => router.push("/bookings")} />
      </fieldset>

      {/* The same package list and payments the driver sees on the pickup page. */}
      <div className="mt-6 max-w-3xl space-y-4">
        <CustomerCard bookingId={id} />
        <NotesCard bookingId={id} />
        <TrackingLink booking={b} />
        <ItemsCard bookingId={id} status={b.status} items={items.data ?? []} onChanged={() => { items.reload(); history.reload(); }} />
        {seesMoney && (
          <PaymentsCard
            booking={b}
            payments={payments.data ?? []}
            onChanged={() => {
              payments.reload();
              history.reload();
            }}
          />
        )}
      </div>

      <div className="mt-6 space-y-6">
        <ScheduleHistory bookingId={id} reloadKey={changes} />
        {canSeeHistory && !!history.data?.length && (
          <Card title="Activity log" className="max-w-3xl">
            <AuditList entries={history.data} />
          </Card>
        )}
        <DeleteBooking booking={b} />
      </div>
    </>
  );
}
