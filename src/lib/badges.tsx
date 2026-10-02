"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "./supabase";

// Number badges on navigation items: how many things are waiting for attention.
//   /pickups              -> bookings still to be collected (drivers only count their own: the database filters)
//   /warehouse-inventory  -> collected bookings waiting for warehouse intake
export type BadgeCounts = Record<string, number>; // keyed by the nav item's href

const BadgeContext = createContext<BadgeCounts>({});
export const BadgeProvider = BadgeContext.Provider;
export const useBadges = () => useContext(BadgeContext);

const bookingsWithStatus = async (status: string) => {
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("status", status);
  return count ?? 0;
};

/** Loads the counts the signed-in user is allowed to see, and keeps them fresh. */
export function useBadgeCounts(permissions: string[], enabled: boolean): BadgeCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<BadgeCounts>({});
  const wantPickups = permissions.includes("pickups.view_all") || permissions.includes("pickups.view_own");
  const wantWarehouse = permissions.includes("warehouse.view");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      const [pickups, intake] = await Promise.all([
        wantPickups ? bookingsWithStatus("booked") : 0,
        wantWarehouse ? bookingsWithStatus("collected") : 0,
      ]);
      if (!cancelled) setCounts({ "/pickups": pickups, "/warehouse-inventory": intake });
    };

    load(); // also runs after every page change (pathname is a dependency), so counts update after actions
    const timer = setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pathname, wantPickups, wantWarehouse]);

  return counts;
}
