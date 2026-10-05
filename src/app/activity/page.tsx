"use client";

import { useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import AuditList, { TABLE_LABELS } from "@/components/audit/AuditList";
import { Card, ErrorMessage, inputClass, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { isMock, supabase } from "@/lib/supabase";
import type { AuditEntry } from "@/lib/types";

type ActivityData = { entries: AuditEntry[]; codes: Record<string, string> };

const LIMIT = 200;

export default function ActivityPage() {
  const [table, setTable] = useState("all");

  const log = useQuery<ActivityData>(async () => {
    let query = supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(LIMIT);
    if (table !== "all") query = query.eq("table_name", table);
    const { data, error } = await query;
    if (error) return { data: null, error };

    // Look up booking codes so each row can say which booking it belongs to.
    const entries = (data ?? []) as AuditEntry[];
    const ids = [...new Set(entries.map((e) => e.booking_id).filter((id): id is string => !!id))];
    const codes: Record<string, string> = {};
    if (ids.length) {
      const { data: bookings } = await supabase.from("bookings").select("id, code").in("id", ids);
      (bookings ?? []).forEach((b: { id: string; code: string }) => (codes[b.id] = b.code));
    }
    return { data: { entries, codes }, error: null };
  }, [table]);

  return (
    <>
      <PageHeader
        title="Activity"
        description="A permanent record of who changed what. It cannot be edited or deleted from the app."
      />

      {isMock && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The activity log is recorded by the database, so it is empty in mock data mode.
        </p>
      )}

      <select
        value={table}
        onChange={(e) => setTable(e.target.value)}
        className={`${inputClass} mb-4 w-auto`}
        aria-label="Filter by type"
      >
        <option value="all">Everything</option>
        {Object.entries(TABLE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <ErrorMessage message={log.error} />
      {log.loading ? (
        <Loading />
      ) : !log.data?.entries.length ? (
        <EmptyState message="No activity recorded yet." />
      ) : (
        <Card>
          <AuditList entries={log.data.entries} codes={log.data.codes} />
          {log.data.entries.length === LIMIT && (
            <p className="mt-3 text-xs text-slate-500">Showing the latest {LIMIT} entries.</p>
          )}
        </Card>
      )}
    </>
  );
}
