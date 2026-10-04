"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { Card, ErrorMessage } from "@/components/ui/form";
import { canAccess } from "@/config/navigation";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

const count = (table: string, column: string, value: string) =>
  supabase.from(table).select("*", { count: "exact", head: true }).eq(column, value);

// Each card opens the screen that lists exactly those items (filters travel in the link).
const STATS = [
  { label: "Pending pickups", table: "bookings", column: "status", value: "booked", href: "/pickups?status=booked" },
  { label: "Awaiting warehouse intake", table: "bookings", column: "status", value: "collected", href: "/warehouse-inventory?tab=intake" },
  { label: "Parcels in warehouse", table: "parcels", column: "status", value: "in_warehouse", href: "/warehouse-inventory?tab=unpacked" },
  { label: "Containers loading", table: "containers", column: "status", value: "loading", href: "/containers?status=loading" },
  { label: "Parcels in transit", table: "parcels", column: "status", value: "in_transit", href: "/containers?status=departed" },
];

function Stat({ label, value, href, linked }: { label: string; value: number | null; href: string; linked: boolean }) {
  const body = (
    <Card className={linked ? "h-full transition-colors hover:border-blue-300 hover:bg-blue-50/40" : "h-full"}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        {linked && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
      </div>
      <p className="mt-1 text-3xl font-semibold">{value ?? "—"}</p>
    </Card>
  );
  if (!linked) return body;
  return (
    <Link href={href} aria-label={`${label}: ${value ?? "unknown"}. Open list`} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      {body}
    </Link>
  );
}

export default function DashboardPage() {
  const { permissions } = usePermissions();
  const stats = useQuery<number[]>(async () => {
    const results = await Promise.all(STATS.map((s) => count(s.table, s.column, s.value)));
    const error = results.find((r) => r.error)?.error ?? null;
    return { data: error ? null : results.map((r) => r.count ?? 0), error };
  });

  return (
    <>
      <PageHeader title="Dashboard" description="Overview of today's operations. Click a card to see the list." />
      <ErrorMessage message={stats.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STATS.map((s, i) => (
          <Stat
            key={s.label}
            label={s.label}
            value={stats.data?.[i] ?? null}
            href={s.href}
            // Only link to pages this role is allowed to open.
            linked={canAccess(permissions, s.href.split(/[?#]/)[0])}
          />
        ))}
      </div>
    </>
  );
}
