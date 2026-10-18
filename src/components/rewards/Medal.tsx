import { Compass, FilePlus, Flame, Heart, Package, Receipt, ScanLine, Star, Trophy, Truck, type LucideIcon } from "lucide-react";
import { FAMILY_LABEL, medalColors, type BadgeView } from "@/lib/rewards";

export const BADGE_ICONS: Record<string, LucideIcon> = {
  star: Star,
  "file-plus": FilePlus,
  package: Package,
  truck: Truck,
  receipt: Receipt,
  scan: ScanLine,
  flame: Flame,
  compass: Compass,
  heart: Heart,
  trophy: Trophy,
};

/**
 * A round medal in the colour of its tier, with ribbon tails when earned. A medal still to earn is dimmed, with a ring that fills
 * as the person gets closer (for example 61 of 100). Flat colours only.
 */
export default function Medal({ badge, state }: { badge: BadgeView; state: "earned" | "next" | "locked" }) {
  const colors = medalColors(badge.tier);
  const Icon = BADGE_ICONS[badge.icon] ?? Star;
  const earned = state === "earned";
  const pct = !earned && badge.progress != null && badge.goal ? Math.min(100, Math.round((badge.progress / badge.goal) * 100)) : 0;
  const family = badge.family ? `${FAMILY_LABEL[badge.family] ?? badge.family}, ` : "";
  const label = `${family}${badge.name}, ${earned ? "earned" : badge.progress != null && badge.goal ? `${badge.progress} of ${badge.goal}` : "not earned yet"}`;
  return (
    <div role="img" aria-label={label} className="relative mx-auto mb-5 h-[72px] w-[72px]" style={earned ? undefined : { filter: "grayscale(1)", opacity: 0.6 }}>
      {!earned && (
        <svg className="absolute -inset-[6px]" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="39" fill="none" stroke="#B4B2A9" strokeWidth="3" opacity="0.4" />
          <circle cx="42" cy="42" r="39" fill="none" stroke="#378ADD" strokeWidth="3" strokeDasharray={`${(pct / 100) * 245} 245`} transform="rotate(-90 42 42)" />
        </svg>
      )}
      <div className="flex h-full w-full items-center justify-center rounded-full border-[5px]" style={{ borderColor: colors.ring, background: colors.fill, color: colors.ink }}>
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      {earned && (
        <>
          <span aria-hidden="true" className="absolute -bottom-4 left-3.5 h-0 w-0 -rotate-12 border-x-[9px] border-t-[18px] border-x-transparent" style={{ borderTopColor: colors.ring }} />
          <span aria-hidden="true" className="absolute -bottom-4 right-3.5 h-0 w-0 rotate-12 border-x-[9px] border-t-[18px] border-x-transparent" style={{ borderTopColor: colors.ink }} />
        </>
      )}
    </div>
  );
}
