"use client";

import Link from "next/link";
import { Boxes, ChevronRight, Container, Package, PackageCheck, Ship, Truck, Undo2, type LucideIcon } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/form";
import { canAccess } from "@/config/navigation";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type Result = { value: number; error: { message: string } | null };
const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<Result> => {
  const r = await q;
  return { value: r.count ?? 0, error: r.error };
};
const bookingsWith = (status: string) => count(supabase.from("bookings").select("*", { count: "exact", head: true }).eq("status", status));

// Parcels physically in the warehouse. Unpacked = as collected (first round); Packed = repacked by the warehouse (a later round).
// The same rules as the Warehouse screen, so the numbers always match.
async function warehouseParcels(): Promise<{ unpacked: Result; packed: Result }> {
  const { data, error } = await supabase.from("parcels").select("round").in("status", ["in_warehouse", "ready_for_return"]);
  const rows = (data ?? []) as { round: number | null }[];
  return {
    unpacked: { value: rows.filter((r) => (r.round ?? 1) <= 1).length, error },
    packed: { value: rows.filter((r) => (r.round ?? 1) > 1).length, error },
  };
}

// Each tile opens the screen that lists exactly those items (filters travel in the link).
// Colours and icons match the Warehouse screen, so they can be recognised without reading.
type Tile = { key: string; label: string; href: string; icon: LucideIcon; tone: string };
const TILES: Tile[] = [
  { key: "pending", label: "Pending pickups", href: "/pickups?status=booked", icon: Truck, tone: "border-amber-400 bg-amber-50 text-amber-900" },
  { key: "intake", label: "Awaiting warehouse intake", href: "/warehouse-inventory?tab=intake", icon: PackageCheck, tone: "border-orange-400 bg-orange-50 text-orange-900" },
  { key: "unpacked", label: "Unpacked", href: "/warehouse-inventory?tab=unpacked", icon: Boxes, tone: "border-blue-400 bg-blue-50 text-blue-900" },
  { key: "packed", label: "Packed", href: "/warehouse-inventory?tab=packed", icon: Package, tone: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { key: "returns", label: "Open returns", href: "/warehouse-inventory?tab=returns", icon: Undo2, tone: "border-rose-400 bg-rose-50 text-rose-900" },
  { key: "loading", label: "Containers loading", href: "/containers?status=loading", icon: Container, tone: "border-indigo-400 bg-indigo-50 text-indigo-900" },
  { key: "transit", label: "Parcels in transit", href: "/containers?status=departed", icon: Ship, tone: "border-teal-500 bg-teal-50 text-teal-900" },
];

function Stat({ label, value, href, linked, icon: Icon, tone, wide }: { label: string; value: number | null; href: string; linked: boolean; icon: LucideIcon; tone: string; wide: string }) {
  const body = (
    <div className={`flex h-full min-h-32 flex-col justify-between rounded-xl border-2 p-4 ${tone} ${linked ? "active:brightness-95" : "opacity-80"}`}>
      <span className="flex items-start justify-between">
        <Icon className="h-8 w-8" aria-hidden="true" />
        <span className="text-4xl font-bold leading-none">{value ?? "—"}</span>
      </span>
      <span className="mt-3 flex items-end justify-between gap-1">
        <span className="text-lg font-semibold leading-snug">{label}</span>
        {linked && <ChevronRight className="h-6 w-6 shrink-0" aria-hidden="true" />}
      </span>
    </div>
  );
  if (!linked) return <div className={wide}>{body}</div>;
  return (
    <Link href={href} aria-label={`${label}: ${value ?? "unknown"}. Open list`} className={`block rounded-xl ${wide}`}>
      {body}
    </Link>
  );
}

export default function DashboardPage() {
  const { permissions } = usePermissions();
  const stats = useQuery<Record<string, number>>(async () => {
    const [pending, intake, wh, returns, loading, transit] = await Promise.all([
      bookingsWith("booked"),
      bookingsWith("collected"),
      warehouseParcels(),
      count(supabase.from("returns").select("*", { count: "exact", head: true }).eq("status", "open")),
      count(supabase.from("containers").select("*", { count: "exact", head: true }).eq("status", "loading")),
      count(supabase.from("parcels").select("*", { count: "exact", head: true }).eq("status", "in_transit")),
    ]);
    const all = [pending, intake, wh.unpacked, wh.packed, returns, loading, transit];
    const error = all.find((r) => r.error)?.error ?? null;
    return {
      data: error ? null : { pending: pending.value, intake: intake.value, unpacked: wh.unpacked.value, packed: wh.packed.value, returns: returns.value, loading: loading.value, transit: transit.value },
      error,
    };
  });

  return (
    <>
      <PageHeader title="Dashboard" description="Overview of today's operations. Tap a tile to see the list." />
      <ErrorMessage message={stats.error} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TILES.map((t, i) => (
          <Stat
            key={t.key}
            label={t.label}
            value={stats.data?.[t.key] ?? null}
            href={t.href}
            icon={t.icon}
            tone={t.tone}
            wide={i === TILES.length - 1 && TILES.length % 2 === 1 ? "col-span-2 lg:col-span-1" : ""}
            // Only link to pages this role is allowed to open.
            linked={canAccess(permissions, t.href.split(/[?#]/)[0])}
          />
        ))}
      </div>
    </>
  );
}
