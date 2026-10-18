"use client";

import { useState } from "react";
import DateField from "@/components/ui/DateField";
import { Button, ErrorMessage } from "@/components/ui/form";
import { SortableTh } from "@/components/ui/Sortable";
import { useQuery } from "@/lib/hooks";
import { TEAM_LABEL, type DirectoryPerson } from "@/lib/rewards";
import type { SortColumn } from "@/lib/sort";
import { supabase } from "@/lib/supabase";
import { useSort } from "@/lib/use-sort";

const COLUMNS: SortColumn<DirectoryPerson>[] = [
  { key: "name", label: "Person", value: (p) => p.full_name },
  { key: "team", label: "Team", value: (p) => (p.team ? TEAM_LABEL[p.team] : null) },
  { key: "job", label: "Job title", value: (p) => p.job_title },
  { key: "joined", label: "Joined", kind: "date", value: (p) => p.joined_on },
];

function PersonRow({ person, onSaved }: { person: DirectoryPerson; onSaved: () => void }) {
  const [team, setTeam] = useState(person.team ?? "");
  const [job, setJob] = useState(person.job_title ?? "");
  const [joined, setJoined] = useState(person.joined_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const { error } = await supabase.rpc("set_staff_details", { p_person_id: person.id, p_team: team || null, p_job_title: job, p_joined_on: joined || null });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    onSaved();
  }

  const field = "min-h-11 rounded-md border border-slate-500 bg-white px-2 text-sm";
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-2 font-medium text-slate-900">{person.full_name}</td>
      <td className="px-2 py-2">
        <select aria-label={`Team of ${person.full_name}`} value={team} onChange={(e) => setTeam(e.target.value)} className={field}>
          <option value="">No team</option>
          {Object.entries(TEAM_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input aria-label={`Job title of ${person.full_name}`} value={job} onChange={(e) => setJob(e.target.value)} className={`${field} w-40`} />
      </td>
      <td className="px-2 py-2">
        <DateField label={`Joined date of ${person.full_name}`} value={joined} onChange={setJoined} />
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

/** Each person's team, job title and joined date. The team decides which badges a person can earn (sales and pickup badges). */
export default function StaffDetailsTable() {
  const people = useQuery<DirectoryPerson[]>(() => supabase.rpc("people_directory") as never);
  const sort = useSort<DirectoryPerson>(COLUMNS, { prefix: "s" });
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
          {sort.sorted(people.data ?? []).map((p) => (
            <PersonRow key={p.id} person={p} onSaved={people.reload} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
