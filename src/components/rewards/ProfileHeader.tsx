"use client";

import LevelBar from "@/components/rewards/LevelBar";
import LevelEmblem from "@/components/rewards/LevelEmblem";
import StreakFlame from "@/components/rewards/StreakFlame";
import { formatDay } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { birthdayLabel, TEAM_LABEL, type DirectoryPerson, type Rewards } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

const initials = (name: string) => name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** A staff photo through a short-lived private link, or the person's initials when there is no photo. */
export function StaffPhoto({ path, name }: { path: string | null; name: string }) {
  const url = useQuery<string>(
    async () => {
      if (!path) return { data: null, error: null };
      const { data, error } = await supabase.storage.from("staff-photos").createSignedUrl(path, 600);
      return { data: data?.signedUrl ?? null, error };
    },
    [path]
  );
  if (url.data) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url.data} alt={name} className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover" />;
  }
  return (
    <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700">
      {initials(name)}
    </div>
  );
}

/** Name, team, points, streak and level: the top of a profile, for yourself or a colleague. */
export default function ProfileHeader({ person, rewards }: { person: DirectoryPerson; rewards: Rewards | null }) {
  const birthday = birthdayLabel(person.birthday_day, person.birthday_month, false);
  const facts = [
    person.job_title,
    person.team ? `${TEAM_LABEL[person.team] ?? person.team} team` : null,
    person.joined_on ? `Joined ${formatDay(person.joined_on)}` : null,
    birthday ? `Birthday ${birthday}` : null,
  ].filter(Boolean);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-4">
        <StaffPhoto path={person.photo_path} name={person.full_name} />
        <div className="min-w-48 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{person.full_name}</h2>
          {facts.length > 0 && <p className="text-sm text-slate-600">{facts.join(" · ")}</p>}
          {person.about && <p className="mt-1 text-base text-slate-800">{person.about}</p>}
        </div>
        {rewards && <LevelEmblem level={rewards.level_number} name={rewards.level_name} />}
        {rewards && <StreakFlame days={rewards.streak} />}
      </div>
      {rewards && (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-48 flex-1">
            <LevelBar rewards={rewards} />
          </div>
          <p className="text-right">
            <span className="text-2xl font-semibold text-slate-900">{rewards.total.toLocaleString()}</span> <span className="text-sm text-slate-600">points</span>
          </p>
        </div>
      )}
    </div>
  );
}
