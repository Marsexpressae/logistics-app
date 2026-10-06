"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Chip from "@/components/ui/Chip";
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
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input name="code" placeholder="Number (optional, e.g. 38)" aria-label="Container number" className={`${inputClass} max-w-[11rem] font-mono`} />
          <input name="destination" placeholder="Destination (optional)" className={`${inputClass} max-w-xs`} />
          <Button type="submit">New container</Button>
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
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
