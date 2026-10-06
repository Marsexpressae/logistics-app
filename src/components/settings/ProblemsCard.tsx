"use client";

import { useState } from "react";
import { Button, Card, ErrorMessage, Loading } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { confirmAction } from "@/lib/ask";

type Problem = { id: number; last_seen: string; count: number; user_name: string | null; path: string | null; message: string; stack: string | null };

/** Settings > Problems: the errors the app has reported from people's browsers (newest first). Only for the settings administrator. */
export default function ProblemsCard() {
  const allowed = usePermissions().can("settings.manage");
  const list = useQuery<Problem[]>(() => supabase.from("client_errors").select("*").order("last_seen", { ascending: false }).limit(30));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) return null;
  const rows = list.data ?? [];

  async function clear() {
    if (!(await confirmAction({ title: "Clear the whole problem list?", message: "Do this after you have looked at them.", confirmLabel: "Clear list", danger: true }))) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("clear_client_errors");
    setBusy(false);
    if (error) return setError(error.message);
    list.reload();
  }

  return (
    <Card title="Problems">
      <p className="mb-3 text-sm text-slate-500">
        Errors the app found in people&apos;s browsers. An empty list is good news. The same error from the same person is counted, not repeated.
      </p>
      <ErrorMessage message={list.error ?? error} />
      {list.loading && !list.data ? (
        <Loading />
      ) : !rows.length ? (
        <p className="text-sm text-green-700">No problems reported.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((p) => (
              <li key={p.id} className="py-2.5">
                <p className="font-medium text-slate-900">{p.message}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(p.last_seen)}
                  {p.count > 1 ? ` · ${p.count} times` : ""}
                  {p.user_name ? ` · ${p.user_name}` : ""}
                  {p.path ? ` · ${p.path}` : ""}
                </p>
                {p.stack && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-blue-700">Details for the developer</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">{p.stack}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button variant="secondary" onClick={clear} disabled={busy}>
              Clear the list
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
