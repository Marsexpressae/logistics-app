"use client";

import { useEffect, useState } from "react";
import Celebration from "@/components/rewards/Celebration";
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
  return <Celebration badge={badge} onClose={() => setFresh((f) => f.slice(1))} />;
}
