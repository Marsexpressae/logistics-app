import { Compass, FilePlus, Flame, Heart, Lock, Package, ScanLine, Star, Truck, type LucideIcon } from "lucide-react";
import type { BadgeView } from "@/lib/rewards";

const ICONS: Record<string, LucideIcon> = {
  "file-plus": FilePlus,
  package: Package,
  truck: Truck,
  scan: ScanLine,
  flame: Flame,
  compass: Compass,
  heart: Heart,
};

/** Badges earned (green) and badges still to earn (dashed, with how far along). */
export default function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  if (!badges.length) return <p className="text-sm text-slate-600">No badges yet. They appear here as they are earned.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {badges.map((b) => {
        const earned = !!b.earned_at;
        const Icon = earned ? (ICONS[b.icon] ?? Star) : Lock;
        return (
          <li
            key={b.key}
            className={`rounded-lg p-3 text-center text-sm ${earned ? "bg-green-50 text-green-900" : "border border-dashed border-slate-300 bg-slate-50 text-slate-700"}`}
          >
            <Icon className="mx-auto h-6 w-6" aria-hidden="true" />
            <p className="mt-1 font-medium">{b.name}</p>
            <p>{earned ? b.message || b.description : b.progress != null && b.goal != null ? `${b.progress} of ${b.goal}` : b.description}</p>
            <span className="sr-only">{earned ? "Earned" : "Not earned yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}
