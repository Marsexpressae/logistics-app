"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@/lib/hooks";
import { isMock, supabase } from "@/lib/supabase";
import type { ReturnRequest } from "@/lib/types";

/**
 * The open return requests waiting for the warehouse. A request that is raised, cancelled or prepared by someone else shows up
 * without leaving the page (the table is in the realtime publication); `onChange` also lets the page refresh what depends on it.
 */
export function useReturnRequests(onChange: () => void) {
  const requests = useQuery<ReturnRequest[]>(() =>
    supabase.from("return_requests").select("*, booking:bookings(code, invoice_no, sender_name)").eq("status", "open").order("needed_by").order("requested_at")
  );
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    refresh.current = () => {
      requests.reload();
      onChange();
    };
  });
  useEffect(() => {
    if (isMock) return;
    const channel = supabase
      .channel("return_requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "return_requests" }, () => refresh.current())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  return requests;
}
