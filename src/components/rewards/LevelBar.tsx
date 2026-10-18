import { progressPercent, type Rewards } from "@/lib/rewards";

/** The level name and a bar showing how far along to the next level. */
export default function LevelBar({ rewards }: { rewards: Rewards }) {
  const percent = progressPercent(rewards);
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-x-3 text-sm text-slate-700">
        <span className="font-medium">
          Level {rewards.level_number} · {rewards.level_name}
        </span>
        <span>{rewards.next_min == null ? "Top level" : `${rewards.next_min - rewards.total} points to ${rewards.next_level_name}`}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Progress to the next level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full bg-brand-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
