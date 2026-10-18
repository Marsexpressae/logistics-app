"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Award, X } from "lucide-react";
import { recordFeature } from "@/lib/feature-use";
import { useCurrentProfile } from "@/lib/profile-context";
import { featureKeyFor, newBadges, type BadgeView } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";
import { usePathname } from "next/navigation";

const seenKey = (id: string) => `rewards-seen-badges:${id}`;

/**
 * Mounted once in the app shell. When a page that counts as a feature opens, it tells the database (once per feature),
 * then looks for badges earned since the last visit and shows a short pop-up for each. Nothing here can block the work:
 * every call and every use of browser storage is allowed to fail quietly.
 */
export default function FeatureUseTracker() {
  const pathname = usePathname();
  const { id } = useCurrentProfile();
  const [fresh, setFresh] = useState<BadgeView[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = featureKeyFor(pathname);
      if (key) await recordFeature(key);
      try {
        const { data } = await supabase.rpc("my_badges");
        if (cancelled || !Array.isArray(data)) return;
        let seen: string[] | null = null;
        try {
          const raw = localStorage.getItem(seenKey(id));
          seen = raw ? (JSON.parse(raw) as string[]) : null;
        } catch {}
        const result = newBadges(seen, data as BadgeView[]);
        try {
          localStorage.setItem(seenKey(id), JSON.stringify(result.seenKeys));
        } catch {}
        if (result.fresh.length) setFresh((old) => [...old, ...result.fresh]);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, id]);

  const badge = fresh[0];
  if (!badge) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-24 z-(--z-toast) mx-auto max-w-md rounded-lg border border-green-200 bg-green-50 p-3 shadow-lg print:hidden md:left-auto md:right-4 md:mx-0 md:w-96"
    >
      <div className="flex items-start gap-3">
        <Award className="mt-0.5 h-5 w-5 shrink-0 text-green-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-green-900">You earned {badge.name}</p>
          <p className="text-sm text-green-900">{badge.message || badge.description}</p>
          <Link href="/account" onClick={() => setFresh((f) => f.slice(1))} className="inline-flex min-h-11 items-center text-sm font-medium text-green-900 underline">
            See my badges
          </Link>
        </div>
        <button type="button" aria-label="Close" className="flex min-h-11 w-11 shrink-0 items-center justify-center text-green-900" onClick={() => setFresh((f) => f.slice(1))}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
