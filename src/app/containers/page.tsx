"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Chip from "@/components/ui/Chip";
import RowCard from "@/components/ui/RowCard";
import PageHeader from "@/components/ui/PageHeader";
import ListSearch from "@/components/ui/ListSearch";
import { matchesSearch } from "@/lib/search";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import type { Container } from "@/lib/types";

function ContainersContent() {
  const router = useRouter();
  const canOperate = usePermissions().can("containers.manage");
  const containers = useQuery<Container[]>(() =>
    supabase.from("containers").select("*, parcels(count)").order("created_at", { ascending: false })
  );
  const [error, setError] = useState<string | null>(null);
  const initial = useSearchParams().get("status") ?? "all";
  const [status, setStatus] = useState(["loading", "departed", "arrived"].includes(initial) ? initial : "all");
  const [search, setSearch] = useState("");
  const shown = (containers.data ?? []).filter((c) => (status === "all" || c.status === status) && matchesSearch(search, [c.code, c.destination]));

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const destination = String(f.get("destination") ?? "").trim() || null;
    const code = String(f.get("code") ?? "").trim().toUpperCase();
    const { data, error } = await supabase.from("containers").insert({ destination, ...(code ? { code } : {}) }).select("id").single();
    if (error) return setError(error.code === "23505" ? "That container number is already used." : error.message);
    router.push(`/containers/${data.id}`);
  }

  return (
    <>
      <PageHeader title="Containers" description="Open a container, load parcels, then mark it departed." />

      {canOperate && <Card className="mb-6">
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input name="code" placeholder="Number, e.g. 38 (optional)" aria-label="Container number" className={`${inputClass} font-mono sm:max-w-[13rem]`} />
          <input name="destination" placeholder="Destination (optional)" aria-label="Destination (optional)" className={`${inputClass} sm:max-w-xs`} />
          <Button type="submit" className="w-full sm:w-auto">New container</Button>
        </form>
        <ErrorMessage message={error} />
      </Card>}

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { value: "all", label: "All" },
          { value: "loading", label: "Loading" },
          { value: "departed", label: "Departed" },
          { value: "arrived", label: "Arrived" },
        ].map((f) => (
          <Chip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </Chip>
        ))}
        <ListSearch value={search} onChange={setSearch} placeholder="Container or destination" className="ml-auto" />
      </div>

      <ErrorMessage message={containers.error} />
      {!shown.length ? (
        <EmptyState message="No containers yet." />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {shown.map((c) => (
              <RowCard key={c.id} href={`/containers/${c.id}`}>
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block font-mono text-lg font-semibold text-blue-700">{c.code}</span>
                    <span className="block text-base text-slate-900">{c.destination ?? "No destination"}</span>
                  </span>
                  <StatusBadge large status={c.status} />
                </span>
                <span className="mt-1 block text-base text-slate-700">
                  {c.parcels?.[0]?.count ?? 0} {(c.parcels?.[0]?.count ?? 0) === 1 ? "parcel" : "parcels"}
                  {c.departed_at ? ` · departed ${formatDate(c.departed_at)}` : ""}
                </span>
              </RowCard>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Container</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Parcels</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Departed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={`/containers/${c.id}`} className="inline-flex min-h-11 items-center font-mono font-medium text-blue-700">
                      {c.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.destination ?? "—"}</td>
                  <td className="px-4 py-3">{c.parcels?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{c.departed_at ? formatDate(c.departed_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}

export default function ContainersPage() {
  return (
    <Suspense fallback={null}>
      <ContainersContent />
    </Suspense>
  );
}
