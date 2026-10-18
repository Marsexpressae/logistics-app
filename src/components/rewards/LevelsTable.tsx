"use client";

import { useState } from "react";
import { Button, ErrorMessage } from "@/components/ui/form";
import { SortableTh } from "@/components/ui/Sortable";
import type { Level } from "@/lib/rewards";
import type { SortColumn } from "@/lib/sort";
import { supabase } from "@/lib/supabase";
import { useSort } from "@/lib/use-sort";

const COLUMNS: SortColumn<Level>[] = [
  { key: "number", label: "Level", kind: "number", firstDir: "asc", value: (l) => l.number },
  { key: "name", label: "Name", value: (l) => l.name },
  { key: "points", label: "Points needed", kind: "number", firstDir: "asc", value: (l) => l.min_points },
];

function LevelRow({ level, onSaved }: { level: Level; onSaved: () => void }) {
  const [name, setName] = useState(level.name);
  const [min, setMin] = useState(String(level.min_points));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const { error } = await supabase.rpc("save_level", { p_number: level.number, p_name: name, p_min_points: Number(min) });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    onSaved();
  }

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-2 text-slate-900">{level.number}</td>
      <td className="px-2 py-2">
        <input aria-label={`Name of level ${level.number}`} value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 w-40 rounded-md border border-slate-500 bg-white px-2 text-sm" />
      </td>
      <td className="px-2 py-2">
        <input aria-label={`Points needed for level ${level.number}`} value={min} onChange={(e) => setMin(e.target.value)} type="number" min={0} className="min-h-11 w-28 rounded-md border border-slate-500 bg-white px-2 text-sm" />
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

/** The levels and the points each needs. Levels only ever go up for a person, so raising a threshold never takes a level away. */
export default function LevelsTable({ levels, onSaved }: { levels: Level[]; onSaved: () => void }) {
  const sort = useSort<Level>(COLUMNS, { prefix: "l" });
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
          {sort.sorted(levels).map((l) => (
            <LevelRow key={`${l.number}-${l.name}-${l.min_points}`} level={l} onSaved={onSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
