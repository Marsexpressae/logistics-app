"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { canOperateWarehouse } from "@/config/navigation";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import type { Container } from "@/lib/types";

export default function ContainersPage() {
  const router = useRouter();
  const canOperate = canOperateWarehouse(useCurrentProfile().role);
  const containers = useQuery<Container[]>(() =>
    supabase.from("containers").select("*, parcels(count)").order("created_at", { ascending: false })
  );
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const destination = String(new FormData(e.currentTarget).get("destination") ?? "").trim() || null;
    const { data, error } = await supabase.from("containers").insert({ destination }).select("id").single();
    if (error) return setError(error.message);
    router.push(`/containers/${data.id}`);
  }

  return (
    <>
      <PageHeader title="Containers" description="Open a container, load parcels, then mark it departed." />

      {canOperate && <Card className="mb-6">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input name="destination" placeholder="Destination (optional)" className={`${inputClass} max-w-xs`} />
          <Button type="submit">New container</Button>
        </form>
        <ErrorMessage message={error} />
      </Card>}

      <ErrorMessage message={containers.error} />
      {!containers.data?.length ? (
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
              {containers.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <Link href={`/containers/${c.id}`} className="font-mono font-medium text-blue-700">
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
