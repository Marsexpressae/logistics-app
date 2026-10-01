"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Navigation, Phone, User } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { AREAS } from "@/config/areas";
import { dayState, formatDay } from "@/lib/format";
import { useQuery, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking, Driver } from "@/lib/types";

function PickupsContent() {
  const session = useSession();
  const drivers = useQuery<Driver[]>(() => supabase.from("drivers").select("*").order("name"));
  const pickups = useQuery<Booking[]>(() =>
    supabase
      .from("bookings")
      .select("*, driver:drivers(name)")
      .in("status", ["booked", "collected"])
      .order("status") // booked first, then collected
      .order("pickup_date") // earliest first
  );

  const initialStatus = useSearchParams().get("status");
  const [status, setStatus] = useState(initialStatus === "booked" || initialStatus === "collected" ? initialStatus : "all");
  const [area, setArea] = useState("all");
  const [driverChoice, setDriverChoice] = useState<string | null>(null);

  // A signed-in driver defaults to their own pickups; staff see everyone's.
  const myDriver = drivers.data?.find((d) => d.user_id === session?.user.id);
  const driverId = driverChoice ?? myDriver?.id ?? "all";

  const open = (pickups.data ?? []).filter(
    (b) => (driverId === "all" || b.driver_id === driverId) && (status === "all" || b.status === status)
  );
  const countFor = (a: string) => open.filter((b) => a === "all" || b.pickup_area === a).length;
  const visible = open.filter((b) => area === "all" || b.pickup_area === area);

  return (
    <>
      <PageHeader title="Pickups" description="Open pickups by area. Tap one to record items and payment." />

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {["all", ...AREAS].map((a) => (
          <button
            key={a}
            onClick={() => setArea(a)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              area === a ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {a === "all" ? "All areas" : a} <span className="opacity-70">({countFor(a)})</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={`${inputClass} w-auto`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          <option value="all">All open pickups</option>
          <option value="booked">To collect</option>
          <option value="collected">Collected</option>
        </select>
      <select
        className={`${inputClass} w-auto`}
        value={driverId}
        onChange={(e) => setDriverChoice(e.target.value)}
        aria-label="Driver"
      >
        <option value="all">All drivers</option>
        {drivers.data?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      </div>

      <ErrorMessage message={pickups.error ?? drivers.error} />
      {pickups.loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !visible.length ? (
        <EmptyState message="No open pickups here." />
      ) : (
        <ul className="space-y-3">
          {visible.map((b) => (
            <li key={b.id}>
              <Link href={`/pickups/${b.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 active:bg-slate-50">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-base font-semibold">{b.code}</span>
                  <StatusBadge status={b.status} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
                  <CalendarDays className="h-4 w-4" /> {formatDay(b.pickup_date)}
                  {b.status === "booked" && dayState(b.pickup_date) === "today" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Today</span>
                  )}
                  {b.status === "booked" && dayState(b.pickup_date) === "overdue" && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>
                  )}
                </p>
                <p className="mt-1 text-sm font-medium">{b.sender_name}</p>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-medium">{b.pickup_area}</span> · {b.pickup_address}
                  </span>
                </p>
                {b.sender_phone && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                    <Phone className="h-4 w-4" /> {b.sender_phone}
                  </p>
                )}
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <User className="h-4 w-4" /> {b.driver?.name ?? "Unassigned"}
                </p>
                {b.geo_lat !== null && (
                  <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700">
                    <Navigation className="h-4 w-4" /> Pin saved
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function PickupsPage() {
  return (
    <Suspense fallback={null}>
      <PickupsContent />
    </Suspense>
  );
}
