"use client";

import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

const count = (table: string, column: string, value: string) =>
  supabase.from(table).select("*", { count: "exact", head: true }).eq(column, value);

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value ?? "—"}</p>
    </Card>
  );
}

export default function DashboardPage() {
  const stats = useQuery<number[]>(async () => {
    const results = await Promise.all([
      count("bookings", "status", "booked"),
      count("bookings", "status", "collected"),
      count("parcels", "status", "in_warehouse"),
      count("containers", "status", "loading"),
      count("parcels", "status", "in_transit"),
    ]);
    const error = results.find((r) => r.error)?.error ?? null;
    return { data: error ? null : results.map((r) => r.count ?? 0), error };
  });
  const [pending, awaiting, inWarehouse, loading, inTransit] = stats.data ?? [];

  return (
    <>
      <PageHeader title="Dashboard" description="Overview of today's operations." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Pending pickups" value={pending ?? null} />
        <Stat label="Awaiting warehouse intake" value={awaiting ?? null} />
        <Stat label="Parcels in warehouse" value={inWarehouse ?? null} />
        <Stat label="Containers loading" value={loading ?? null} />
        <Stat label="Parcels in transit" value={inTransit ?? null} />
      </div>
    </>
  );
}
