"use client";

import { useState } from "react";
import TeamCard from "@/components/rewards/TeamCard";
import PageHeader from "@/components/ui/PageHeader";
import { ErrorMessage, Loading, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import type { TeamMember } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

/** Everyone on the team, sorted by name. One team, all equal: there is no ranking here. Tap a colleague to see their medals. */
export default function TeamPage() {
  const team = useQuery<TeamMember[]>(() => supabase.rpc("team_overview") as never);
  const [search, setSearch] = useState("");
  const all = team.data ?? [];
  const shown = search.trim() ? all.filter((m) => m.full_name.toLowerCase().includes(search.trim().toLowerCase())) : all;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Team" description="Everyone on the team. Tap a colleague to see their level, streak and medals." />
      <ErrorMessage message={team.error} />
      {all.length > 12 && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a colleague" aria-label="Find a colleague" className={inputClass} />}
      {team.loading ? (
        <Loading />
      ) : shown.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => (
            <li key={m.id}>
              <TeamCard member={m} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No one found.</p>
      )}
    </div>
  );
}
