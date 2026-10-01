"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** Runs a Supabase query on mount (and whenever `deps` change); call `reload()` after writes. */
export function useQuery<T>(fetcher: () => QueryResult<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetcher().then(({ data, error }) => {
      if (cancelled) return;
      setData(data);
      setError(error?.message ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

/** undefined = still loading, null = signed out. */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}

/** Loads the profile (role) for the signed-in user. `loading` stays true until it is known. */
export function useProfile(session: Session | null | undefined) {
  const userId = session?.user.id;
  const [state, setState] = useState<{ userId: string; profile: Profile | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setState({ userId, profile: data as Profile | null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const ready = !!userId && state?.userId === userId;
  // An inactive profile is treated the same as no profile: no access.
  const profile = ready && state!.profile?.active ? state!.profile : null;
  return { profile, loading: !!userId && !ready };
}
