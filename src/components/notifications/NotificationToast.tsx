"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { usePermissions } from "@/lib/profile-context";
import { useNotifications } from "@/lib/notifications";

/** A short-lived pop-up for a notification that arrives while the app is open. */
export default function NotificationToast() {
  const { toast, dismissToast, markRead } = useNotifications();
  const { can } = usePermissions();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 9000);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  // Office staff open the booking; the pickup team opens the pickup.
  const href = toast.booking_id ? (can("bookings.view") ? `/bookings/${toast.booking_id}` : `/pickups/${toast.booking_id}`) : "/notifications";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[60] mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-3 shadow-lg print:hidden md:left-auto md:right-4 md:mx-0 md:w-96"
      style={{ marginTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{toast.title}</p>
          <p className="text-sm text-slate-600">{toast.body}</p>
          {toast.actor_name && <p className="mt-0.5 text-xs text-slate-500">by {toast.actor_name}</p>}
          <Link
            href={href}
            onClick={() => {
              markRead(toast.id);
              dismissToast();
            }}
            className="mt-2 inline-block text-sm font-medium text-blue-700"
          >
            View
          </Link>
        </div>
        <button aria-label="Dismiss" onClick={dismissToast} className="text-slate-400 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
