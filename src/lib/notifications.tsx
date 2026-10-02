"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isMock, supabase } from "./supabase";
import type { NotificationRow } from "./types";

export type NotificationsState = {
  items: NotificationRow[];
  unread: number;
  loading: boolean;
  /** The newest notification that just arrived while the app was open (shown briefly as a toast). */
  toast: NotificationRow | null;
  dismissToast: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const empty: NotificationsState = {
  items: [],
  unread: 0,
  loading: false,
  toast: null,
  dismissToast: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
};

const NotificationContext = createContext<NotificationsState>(empty);
export const NotificationProvider = NotificationContext.Provider;
export const useNotifications = () => useContext(NotificationContext);

/**
 * Loads the signed-in user's notifications and keeps them current:
 *   - instantly, through Supabase Realtime (a new row for this user arrives over a socket)
 *   - and with a refresh every minute / when the app is brought back to the foreground, as a safety net
 * Rows are created only by the database (when the other party reschedules or cancels).
 */
export function useNotificationsState(userId: string | undefined, enabled: boolean): NotificationsState {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<NotificationRow | null>(null);

  const load = useCallback(async () => {
    const [list, count] = await Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("notifications").select("*", { count: "exact", head: true }).is("read_at", null),
    ]);
    setItems((list.data ?? []) as NotificationRow[]);
    setUnread(count.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled || !userId) return;
    // `load` only sets state after awaiting the network, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);

    const channel = isMock
      ? null
      : supabase
          .channel(`notifications:${userId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
            (payload) => {
              const row = payload.new as NotificationRow;
              setItems((prev) => [row, ...prev.filter((n) => n.id !== row.id)].slice(0, 50));
              setUnread((n) => n + 1);
              setToast(row);
            }
          )
          .subscribe();

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled, userId, load]);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)));
    setUnread((n) => Math.max(0, n - 1));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }, []);

  return {
    items,
    unread,
    loading,
    toast,
    dismissToast: () => setToast(null),
    markRead,
    markAllRead,
  };
}
