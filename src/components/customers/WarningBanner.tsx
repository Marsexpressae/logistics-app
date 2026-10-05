"use client";

import { TriangleAlert } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

/** The warning note of the booking's customer ("collect payment first"), for everyone who can open the booking, drivers included. */
export default function WarningBanner({ bookingId }: { bookingId: string }) {
  const warning = useQuery<string | null>(() => supabase.rpc("booking_warning", { p_booking_id: bookingId }) as never, [bookingId]);
  if (!warning.data) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {warning.data}
    </p>
  );
}
