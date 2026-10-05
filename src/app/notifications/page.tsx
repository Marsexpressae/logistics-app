"use client";

import Link from "next/link";
import { Bell, CalendarClock, Ban, MessageSquare } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import PhoneAlertsCard from "@/components/notifications/PhoneAlertsCard";
import { Button, Card, Loading } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useNotifications } from "@/lib/notifications";
import { usePermissions } from "@/lib/profile-context";

export default function NotificationsPage() {
  const { items, unread, loading, markRead, markAllRead } = useNotifications();
  const { can } = usePermissions();

  // Office staff open the booking; the pickup team opens the pickup; the warehouse team opens the receive screen.
  const hrefFor = (bookingId: string | null) => {
    if (!bookingId) return null;
    if (can("bookings.view")) return `/bookings/${bookingId}`;
    if (can("pickups.view_all") || can("pickups.view_own")) return `/pickups/${bookingId}`;
    return can("warehouse.manage") ? `/warehouse-inventory/split/${bookingId}` : null;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Notifications"
          description="Changes made by the other team, and notes where a colleague mentioned you."
        />
        {unread > 0 && (
          <Button variant="secondary" onClick={markAllRead}>
            Mark all as read ({unread})
          </Button>
        )}
      </div>

      <PhoneAlertsCard />

      {loading ? (
        <Loading />
      ) : !items.length ? (
        <EmptyState message="No notifications yet. You'll see changes made by the other team here." />
      ) : (
        <Card className="max-w-3xl p-0">
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
              const href = hrefFor(n.booking_id);
              const content = (
                <div className={`flex gap-3 px-4 py-3 ${n.read_at ? "" : "bg-blue-50/50"}`}>
                  {n.kind === "cancelled" ? (
                    <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  ) : n.kind === "note_mention" ? (
                    <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  ) : n.kind === "rescheduled" ? (
                    <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  ) : (
                    <Bell className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`${n.read_at ? "font-medium" : "font-semibold"} text-slate-900`}>{n.title}</p>
                    <p className="text-sm text-slate-700">{n.body}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {n.actor_name ? `${n.actor_name} · ` : ""}
                      {formatDate(n.created_at)}
                    </p>
                  </div>
                  {!n.read_at && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />}
                </div>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link href={href} onClick={() => markRead(n.id)} className="block hover:bg-slate-50">
                      {content}
                    </Link>
                  ) : (
                    <button className="block w-full text-left hover:bg-slate-50" onClick={() => markRead(n.id)}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
