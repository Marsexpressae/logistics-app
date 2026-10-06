"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Navigation, User } from "lucide-react";
import Chip from "@/components/ui/Chip";
import ShowMore from "@/components/ui/ShowMore";
import { useWindow } from "@/lib/window";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import ListSearch from "@/components/ui/ListSearch";
import SwipeHint from "@/components/ui/SwipeHint";
import { matchesSearch } from "@/lib/search";
import { neighbour } from "@/lib/swipe";
import { useSwipe } from "@/lib/use-swipe";
import ContactButtons from "@/components/contact/ContactButtons";
import { ErrorMessage, StatusBadge, inputClass, Loading } from "@/components/ui/form";
import { AREAS } from "@/config/areas";
import { dayState, formatDay } from "@/lib/format";
import { useQuery, useSession } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Driver } from "@/lib/types";

function PickupsContent() {
  const session = useSession();
  const seesAll = usePermissions().can("pickups.view_all");
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
  const [status, setStatus] = useState(initialStatus === "booked" || initialStatus === "collected" || initialStatus === "all" ? initialStatus : "booked");
  const [area, setArea] = useState("all");
  const [search, setSearch] = useState("");
  const [slide, setSlide] = useState<"next" | "previous" | null>(null); // which way the list slides in after a swipe
  const areas = ["all", ...AREAS];
  const swipeRef = useSwipe((direction) => {
    const to = neighbour(areas, area, direction);
    if (to) {
      setSlide(direction);
      setArea(to);
    }
  });
  // keep the chosen area's chip in view in the row of chips
  useEffect(() => {
    document.getElementById(`area-chip-${area}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [area]);
  const [driverChoice, setDriverChoice] = useState<string | null>(null);

  // A signed-in driver defaults to their own pickups; staff see everyone's.
  const myDriver = drivers.data?.find((d) => d.user_id === session?.user.id);
  // Without pickups.view_all you only ever see your own (the database enforces this as well).
  const driverId = seesAll ? (driverChoice ?? myDriver?.id ?? "all") : (myDriver?.id ?? "none");

  const open = (pickups.data ?? []).filter(
    (b) =>
      (driverId === "all" || b.driver_id === driverId) &&
      (status === "all" || b.status === status) &&
      matchesSearch(
        search,
        [b.code, b.invoice_no, b.sender_name, b.receiver_name, b.pickup_area, b.pickup_address, b.receiver_address, b.notes],
        [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp]
      )
  );
  const countFor = (a: string) => open.filter((b) => a === "all" || b.pickup_area === a).length;
  const visible = open.filter((b) => area === "all" || b.pickup_area === area);
  const win = useWindow(visible);

  return (
    <>
      <PageHeader title="Pickups" description="Open pickups by area. Tap one to record items and payment." />
      <SwipeHint id="pickups">Swipe left or right to change the area.</SwipeHint>
      <div ref={swipeRef} className="min-h-[70vh]">

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {areas.map((a) => (
          <Chip
            key={a}
            id={`area-chip-${a}`}
            active={area === a}
            onClick={() => {
              setSlide(null);
              setArea(a);
            }}
          >
            {a === "all" ? "All areas" : a} <span className="ml-1 opacity-80">({countFor(a)})</span>
          </Chip>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <ListSearch value={search} onChange={setSearch} placeholder="Invoice, booking, name or phone" />
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
      {seesAll && (
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
      )}
      </div>

      <ErrorMessage message={pickups.error ?? drivers.error} />
      {pickups.loading ? (
        <Loading />
      ) : !visible.length ? (
        <EmptyState message="No open pickups here." />
      ) : (
        <>
        <ul key={area} className={`space-y-3 ${slide ? `swipe-in-${slide}` : ""}`}>
          {win.shown.map((b) => (
            <li key={b.id}>
              {/* The whole card opens the pickup (stretched link), while Call / WhatsApp stay separately tappable. */}
              <div className="relative rounded-lg border border-slate-200 bg-white p-4 active:bg-slate-50">
                <div className="flex items-center justify-between">
                  <Link href={`/pickups/${b.id}`} className="font-mono text-base font-semibold after:absolute after:inset-0 after:content-['']">
                    {b.code}
                  </Link>
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
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <User className="h-4 w-4" /> {b.driver?.name ?? "Unassigned"}
                </p>
                {b.geo_lat !== null && (
                  <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
                    <Navigation className="h-4 w-4" /> Pin saved
                  </span>
                )}
                <ContactButtons
                  phone={b.sender_phone}
                  whatsapp={b.sender_whatsapp}
                  name={b.sender_name}
                  compact
                  className="relative z-10 mt-3"
                />
              </div>
            </li>
          ))}
        </ul>
        <ShowMore remaining={win.remaining} onClick={win.showMore} what="pickups" />
        </>
      )}
      </div>
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
