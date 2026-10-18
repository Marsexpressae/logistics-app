"use client";

import { Award, Heart } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Win = { kind: "badge" | "thank_you"; title: string; message: string; created_at: string };

/** A person's recent achievements: badges earned and thank-yous received. No point reasons (they name bookings). */
export default function AchievementsList({ personId }: { personId: string }) {
  const wins = useQuery<Win[]>(() => supabase.rpc("person_wins", { p_person: personId, p_limit: 12 }) as never, [personId]);
  if (!wins.data?.length) return <p className="text-sm text-slate-600">Nothing yet. Badges and thank-yous show here.</p>;
  return (
    <ul className="space-y-3">
      {wins.data.map((w, i) => (
        <li key={`${w.created_at}-${i}`} className="flex items-start gap-3">
          {w.kind === "badge" ? <Award className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" /> : <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />}
          <div className="min-w-0 text-base text-slate-800">
            <p>{w.kind === "badge" ? `Earned ${w.title}` : w.title}</p>
            {w.message && <p className="text-sm text-slate-600">“{w.message}”</p>}
            <p className="text-sm text-slate-500">{formatDate(w.created_at)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
