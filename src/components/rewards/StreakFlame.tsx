import { Flame } from "lucide-react";

/** The streak as a flame with the day count. The flame grows at 7 and at 30 days. */
export default function StreakFlame({ days }: { days: number }) {
  const size = days >= 30 ? "h-12 w-12" : days >= 7 ? "h-10 w-10" : "h-8 w-8";
  return (
    <div className="rounded-xl bg-amber-50 px-3.5 py-2 text-center">
      <Flame className={`mx-auto ${size} ${days > 0 ? "text-amber-600" : "text-slate-400"}`} aria-hidden="true" />
      <p className="text-xl font-semibold leading-none text-amber-900">{days}</p>
      <p className="text-sm text-amber-800">{days === 1 ? "day in a row" : "days in a row"}</p>
    </div>
  );
}
