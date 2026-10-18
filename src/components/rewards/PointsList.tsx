"use client";

import { SortableTh } from "@/components/ui/Sortable";
import { formatDate } from "@/lib/format";
import type { SortColumn } from "@/lib/sort";
import { useSort } from "@/lib/use-sort";
import type { Rewards } from "@/lib/rewards";

type Line = NonNullable<Rewards["recent"]>[number];

const COLUMNS: SortColumn<Line>[] = [
  { key: "when", label: "When", kind: "date", value: (l) => l.created_at },
  { key: "why", label: "Why", value: (l) => l.reason },
  { key: "points", label: "Points", kind: "number", value: (l) => l.points },
];

/** The latest points and why they were given. Must sit inside a Suspense boundary (the sort lives in the address). */
export default function PointsList({ lines }: { lines: Line[] }) {
  const sort = useSort<Line>(COLUMNS, { prefix: "p" });
  if (!lines.length) return <p className="text-sm text-slate-600">No points yet. Do some work in the app and they will show here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs">
          <tr>
            <SortableTh column={COLUMNS[0]} sort={sort} />
            <SortableTh column={COLUMNS[1]} sort={sort} />
            <SortableTh column={COLUMNS[2]} sort={sort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sort.sorted(lines).map((l, i) => (
            <tr key={`${l.created_at}-${i}`} className="border-t border-slate-100">
              <td className="whitespace-nowrap px-2 py-2 text-slate-600">{formatDate(l.created_at)}</td>
              <td className="px-2 py-2 text-slate-900">{l.reason}</td>
              <td className="px-2 py-2 text-right font-medium text-green-800">+{l.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
