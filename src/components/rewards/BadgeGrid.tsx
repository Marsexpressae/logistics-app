import Medal from "@/components/rewards/Medal";
import { groupBadges, type BadgeView } from "@/lib/rewards";

/**
 * The medal wall. A family (bookings, pickups ...) shows the highest medal earned and, beside it, the next one to win with how far
 * along the person is. One-off badges show as a single medal, dimmed until earned.
 */
export default function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  if (!badges.length) return <p className="text-sm text-slate-600">No badges yet. They appear here as they are earned.</p>;
  const groups = groupBadges(badges);
  const earned = groups.reduce((n, g) => n + g.earnedCount, 0);
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        {earned} of {badges.length} badges earned
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
        {groups.map((g) => (
          <li key={g.family ?? g.label} className="text-center text-sm">
            <div className="flex items-start justify-center gap-3">
              {g.earnedTop ? <Medal badge={g.earnedTop} state="earned" /> : g.next && <Medal badge={g.next} state="locked" />}
              {g.earnedTop && g.next && (
                <div className="origin-top scale-75">
                  <Medal badge={g.next} state="next" />
                </div>
              )}
            </div>
            <p className="font-medium text-slate-900">{g.earnedTop ? g.earnedTop.name : (g.next?.name ?? g.label)}</p>
            <p className="text-slate-600">
              {g.earnedTop
                ? g.earnedTop.message || g.earnedTop.description
                : g.next?.progress != null && g.next.goal
                  ? `${g.next.progress} of ${g.next.goal}`
                  : g.next?.description}
            </p>
            {g.earnedTop && g.next && g.next.progress != null && g.next.goal ? (
              <p className="text-slate-500">
                Next: {g.next.name}, {g.next.progress} of {g.next.goal}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
