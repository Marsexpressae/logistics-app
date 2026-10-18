import Link from "next/link";
import { Award, Flame } from "lucide-react";
import LevelEmblem from "@/components/rewards/LevelEmblem";
import { StaffPhoto } from "@/components/rewards/ProfileHeader";
import { TEAM_LABEL, type TeamMember } from "@/lib/rewards";

/** One colleague on the Team page: photo, name, level, streak and badge count. Tapping it opens their profile. */
export default function TeamCard({ member }: { member: TeamMember }) {
  const facts = [member.job_title, member.team ? `${TEAM_LABEL[member.team] ?? member.team} team` : null].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/people/${member.id}`}
      className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300"
      aria-label={`${member.full_name}, level ${member.level_number} ${member.level_name}, ${member.streak} day streak, ${member.badge_count} badges`}
    >
      <StaffPhoto path={member.photo_path} name={member.full_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-slate-900">{member.full_name}</p>
        {facts && <p className="truncate text-sm text-slate-600">{facts}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-700">
          <span className="inline-flex items-center gap-1">
            <Flame className={`h-4 w-4 ${member.streak > 0 ? "text-amber-600" : "text-slate-400"}`} aria-hidden="true" />
            {member.streak}
          </span>
          <span className="inline-flex items-center gap-1">
            <Award className="h-4 w-4 text-green-700" aria-hidden="true" />
            {member.badge_count}
          </span>
        </p>
      </div>
      <div className="h-[56px] w-[50px] shrink-0">
        <div className="origin-top-left scale-[0.66]">
          <LevelEmblem level={member.level_number} name={member.level_name} />
        </div>
      </div>
    </Link>
  );
}
