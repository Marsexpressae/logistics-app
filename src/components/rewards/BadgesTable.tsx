"use client";

import { useState } from "react";
import { Button, ErrorMessage } from "@/components/ui/form";
import { SortableTh } from "@/components/ui/Sortable";
import { FAMILY_LABEL } from "@/lib/rewards";
import type { SortColumn } from "@/lib/sort";
import { supabase } from "@/lib/supabase";
import { useSort } from "@/lib/use-sort";

export type BadgeRow = { key: string; name: string; description: string; team: string | null; family: string | null; tier: number | null; kind: "count" | "streak" | "manual"; threshold: number | null; active: boolean };

const KIND: Record<BadgeRow["kind"], string> = { count: "Reach a number", streak: "Days in a row", manual: "Given by a manager" };

const COLUMNS: SortColumn<BadgeRow>[] = [
  { key: "name", label: "Badge", value: (b) => b.name },
  { key: "family", label: "Family", value: (b) => (b.family ? (FAMILY_LABEL[b.family] ?? b.family) : null) },
  { key: "tier", label: "Tier", kind: "number", firstDir: "asc", value: (b) => b.tier },
  { key: "kind", label: "How it is earned", value: (b) => KIND[b.kind] },
  { key: "goal", label: "Goal", kind: "number", value: (b) => b.threshold },
  { key: "active", label: "On", value: (b) => (b.active ? "On" : "Off") },
];

function BadgeLine({ badge, onSaved }: { badge: BadgeRow; onSaved: () => void }) {
  const [name, setName] = useState(badge.name);
  const [description, setDescription] = useState(badge.description);
  const [goal, setGoal] = useState(badge.threshold == null ? "" : String(badge.threshold));
  const [active, setActive] = useState(badge.active);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasGoal = badge.kind !== "manual" && badge.threshold != null;

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const { error } = await supabase.rpc("save_badge", { p_key: badge.key, p_name: name, p_description: description, p_active: active, p_threshold: hasGoal && goal !== "" ? Number(goal) : null });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    onSaved();
  }

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-2">
        <input aria-label={`Name of the ${badge.name} badge`} value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 w-40 rounded-md border border-slate-500 bg-white px-2 text-sm" />
        <input aria-label={`Description of the ${badge.name} badge`} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 min-h-11 w-56 rounded-md border border-slate-500 bg-white px-2 text-sm" />
      </td>
      <td className="px-2 py-2 text-slate-600">{badge.family ? (FAMILY_LABEL[badge.family] ?? badge.family) : "One-off"}</td>
      <td className="px-2 py-2 text-slate-600">{badge.tier ?? "—"}</td>
      <td className="px-2 py-2 text-slate-600">{KIND[badge.kind]}</td>
      <td className="px-2 py-2">
        {hasGoal ? (
          <input aria-label={`Goal for the ${badge.name} badge`} value={goal} onChange={(e) => setGoal(e.target.value)} type="number" min={1} className="min-h-11 w-24 rounded-md border border-slate-500 bg-white px-2 text-sm" />
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-6 w-6" />
          <span className="sr-only">{badge.name} is on</span>
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

/** The badges: rename them, change the goal, or turn one off. A badge already earned stays earned. */
export default function BadgesTable({ badges, onSaved }: { badges: BadgeRow[]; onSaved: () => void }) {
  const sort = useSort<BadgeRow>(COLUMNS, { prefix: "b" });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs">
          <tr>
            {COLUMNS.map((c) => (
              <SortableTh key={c.key} column={c} sort={sort} />
            ))}
            <th scope="col" className="px-2">
              <span className="sr-only">Save</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sort.sorted(badges).map((b) => (
            <BadgeLine key={b.key} badge={b} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
