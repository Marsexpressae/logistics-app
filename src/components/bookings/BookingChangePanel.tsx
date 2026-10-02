"use client";

import { useState, type FormEvent } from "react";
import { Ban, CalendarClock } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { todayISO } from "@/lib/format";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

type Mode = "reschedule" | "cancel" | null;

/**
 * Reschedule or cancel a booking, always with a reason. Used by the office (booking page) and by the
 * pickup team (pickup page). The database enforces who may do what; this only shows the right buttons.
 * The other party is notified automatically: office -> assigned driver, pickup team -> the office.
 */
export default function BookingChangePanel({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const { can } = usePermissions();
  const [mode, setMode] = useState<Mode>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mayReschedule = booking.status === "booked" && (can("bookings.reschedule") || can("pickups.reschedule"));
  const mayCancel =
    (booking.status === "booked" && (can("bookings.cancel") || can("pickups.cancel"))) ||
    (booking.status === "collected" && can("bookings.cancel"));

  const isOffice = can("bookings.edit");
  const whoIsTold = isOffice
    ? booking.driver_id
      ? "The assigned driver has been notified."
      : "No driver is assigned, so nobody needed to be notified."
    : "The office team has been notified.";

  function close() {
    setMode(null);
    setDate("");
    setReason("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError("Please enter a reason.");
    if (mode === "reschedule" && !date) return setError("Please choose the new pickup date.");
    if (mode === "cancel" && !confirm(`Cancel ${booking.code}? This cannot be undone.`)) return;

    setBusy(true);
    setError(null);
    const { error } =
      mode === "reschedule"
        ? await supabase.rpc("reschedule_booking", { p_booking_id: booking.id, p_new_date: date, p_reason: reason })
        : await supabase.rpc("cancel_booking", { p_booking_id: booking.id, p_reason: reason });
    setBusy(false);
    if (error) return setError(error.message);

    setNotice(`${mode === "reschedule" ? "Pickup rescheduled" : "Booking cancelled"}. ${whoIsTold}`);
    close();
    onChanged();
  }

  if (!mayReschedule && !mayCancel && !notice) return null;

  return (
    <div className="space-y-3">
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {!mode && (mayReschedule || mayCancel) && (
        <div className="flex flex-wrap gap-2">
          {mayReschedule && (
            <Button variant="secondary" onClick={() => { setNotice(null); setMode("reschedule"); }}>
              <CalendarClock className="h-4 w-4" /> Reschedule
            </Button>
          )}
          {mayCancel && (
            <Button variant="danger" onClick={() => { setNotice(null); setMode("cancel"); }}>
              <Ban className="h-4 w-4" /> Cancel {booking.status === "booked" ? "pickup" : "booking"}
            </Button>
          )}
        </div>
      )}

      {mode && (
        <Card title={mode === "reschedule" ? "Reschedule this pickup" : "Cancel this booking"}>
          <form onSubmit={submit} className="space-y-3">
            {mode === "reschedule" && (
              <Field label={`New pickup date (currently ${booking.pickup_date})`}>
                <input
                  type="date"
                  required
                  min={todayISO()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
            <Field label={mode === "reschedule" ? "Reason for rescheduling (required)" : "Reason for cancelling (required)"}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                autoFocus
                placeholder={
                  mode === "reschedule"
                    ? "e.g. Sender not available, asked for a later date…"
                    : "e.g. Customer changed their mind, duplicate booking, unreachable…"
                }
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-slate-500">
              {isOffice ? "The assigned driver" : "The office team"} will be notified, and this is saved in the booking&apos;s history.
            </p>
            <ErrorMessage message={error} />
            <div className="flex gap-2">
              <Button type="submit" variant={mode === "cancel" ? "danger" : "primary"} disabled={busy || !reason.trim()}>
                {busy ? "Saving…" : mode === "reschedule" ? "Confirm new date" : "Confirm cancellation"}
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Keep as is
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
