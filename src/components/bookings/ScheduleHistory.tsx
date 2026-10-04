"use client";

import { Ban, CalendarClock, Container } from "lucide-react";
import { Card } from "@/components/ui/form";
import { formatDate, formatDay } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { BookingEvent } from "@/lib/types";

/** Every reschedule and cancellation of a booking, with who did it and why. Hidden when there are none. */
export default function ScheduleHistory({ bookingId, reloadKey = 0 }: { bookingId: string; reloadKey?: number }) {
  const events = useQuery<BookingEvent[]>(
    () => supabase.from("booking_events").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    [bookingId, reloadKey]
  );

  if (!events.data?.length) return null;

  return (
    <Card title="Booking history" className="max-w-3xl">
      <ul className="divide-y divide-slate-100 text-sm">
        {events.data.map((e) => (
          <li key={e.id} className="flex gap-3 py-3">
            {e.kind === "rescheduled" ? (
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            ) : e.kind === "loaded_without_payment" ? (
              <Container className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            ) : (
              <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            )}
            <div>
              <p className="font-medium text-slate-900">
                {e.kind === "rescheduled" && e.old_date && e.new_date
                  ? `Rescheduled: ${formatDay(e.old_date)} → ${formatDay(e.new_date)}`
                  : e.kind === "loaded_without_payment"
                    ? "Loaded without full payment"
                    : "Cancelled"}
              </p>
              <p className="text-slate-700">Reason: {e.reason}</p>
              <p className="text-xs text-slate-500">
                {e.actor_name || "System"} · {formatDate(e.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
