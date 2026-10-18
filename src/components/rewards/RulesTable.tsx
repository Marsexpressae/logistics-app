"use client";

import { useState } from "react";
import { Button, ErrorMessage } from "@/components/ui/form";
import { SortableTh } from "@/components/ui/Sortable";
import type { SortColumn } from "@/lib/sort";
import { supabase } from "@/lib/supabase";
import { useSort } from "@/lib/use-sort";

export type PointRule = { key: string; label: string; kind: "work" | "explore" | "daily"; points: number; daily_cap: number | null; once_per_person: boolean; active: boolean };

const KIND: Record<PointRule["kind"], string> = { work: "Real work", explore: "Trying a feature", daily: "Using the app today" };

const COLUMNS: SortColumn<PointRule>[] = [
  { key: "label", label: "What earns points", value: (r) => r.label },
  { key: "kind", label: "Kind", value: (r) => KIND[r.kind] },
  { key: "points", label: "Points", kind: "number", value: (r) => r.points },
  { key: "cap", label: "Daily limit", kind: "number", value: (r) => r.daily_cap },
  { key: "active", label: "On", value: (r) => (r.active ? "On" : "Off") },
];

function RuleRow({ rule, onSaved }: { rule: PointRule; onSaved: () => void }) {
  const [points, setPoints] = useState(String(rule.points));
  const [cap, setCap] = useState(rule.daily_cap == null ? "" : String(rule.daily_cap));
  const [active, setActive] = useState(rule.active);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const { error } = await supabase.rpc("save_point_rule", { p_key: rule.key, p_points: Number(points), p_daily_cap: cap === "" ? null : Number(cap), p_active: active });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    onSaved();
  }

  const field = "min-h-11 w-20 rounded-md border border-slate-500 bg-white px-2 text-sm";
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-2 text-slate-900">{rule.label}</td>
      <td className="px-2 py-2 text-slate-600">{KIND[rule.kind]}</td>
      <td className="px-2 py-2">
        <input aria-label={`Points for ${rule.label}`} value={points} onChange={(e) => setPoints(e.target.value)} type="number" min={0} max={1000} className={field} />
      </td>
      <td className="px-2 py-2">
        <input aria-label={`Daily limit for ${rule.label}`} value={cap} onChange={(e) => setCap(e.target.value)} type="number" min={0} placeholder="None" className={field} />
      </td>
      <td className="px-2 py-2">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-6 w-6" />
          <span className="sr-only">{rule.label} is on</span>
        </label>
      </td>
      <td className="px-2 py-2">
        <Button variant="secondary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {saved && <p role="status" className="text-sm text-green-700">Saved</p>}
        <ErrorMessage message={error} />
      </td>
    </tr>
  );
}

/** What earns points, how many, and the most one person can earn from it in a day. Needs a Suspense boundary above (the sort lives in the address). */
export default function RulesTable({ rules, onSaved }: { rules: PointRule[]; onSaved: () => void }) {
  const sort = useSort<PointRule>(COLUMNS, { prefix: "r" });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs">
          <tr>
            {COLUMNS.map((c) => (
              <SortableTh key={c.key} column={c} sort={sort} />
            ))}
            <th scope="col" className="px-2 text-xs font-semibold uppercase text-slate-500">
              <span className="sr-only">Save</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sort.sorted(rules).map((r) => (
            <RuleRow key={`${r.key}-${r.points}-${r.daily_cap}-${r.active}`} rule={r} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
