"use client";

import Link from "next/link";
import { Award, Heart } from "lucide-react";
import { Card } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Win = { kind: "badge" | "thank_you"; person_id: string; person_name: string; title: string; message: string; created_at: string };

/** Recent celebrations for the whole team: badges earned and thank-yous. No points, no ranking. */
export default function WinsFeed({ limit = 8 }: { limit?: number }) {
  const wins = useQuery<Win[]>(() => supabase.rpc("wins_feed", { p_limit: limit }) as never, [limit]);
  if (!wins.data?.length) return null;
  return (
    <Card title="Team wins">
      <ul className="space-y-3">
        {wins.data.map((w, i) => (
          <li key={`${w.created_at}-${i}`} className="flex items-start gap-3">
            {w.kind === "badge" ? <Award className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" /> : <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />}
            <div className="min-w-0 text-base text-slate-800">
              <p>
                <Link href={`/people/${w.person_id}`} className="font-medium underline">
                  {w.person_name}
                </Link>{" "}
                {w.kind === "badge" ? `earned ${w.title}` : w.title.toLowerCase()}
              </p>
              {w.message && <p className="text-sm text-slate-600">“{w.message}”</p>}
              <p className="text-sm text-slate-500">{formatDate(w.created_at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
