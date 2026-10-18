"use client";

import { inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";

type Choice = { id: string; name: string };

/** The active staff who can be a sales rep (the database lists them). */
export function useSalesRepChoices() {
  return useQuery<Choice[]>(() => supabase.rpc("sales_rep_choices") as never);
}

/** A dropdown of the active staff who can be a sales rep (the database lists them). The first option is "No sales rep". */
export default function SalesRepSelect({ value, onChange, disabled, label = "Sales rep" }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean; label?: string }) {
  const choices = useSalesRepChoices();
  const list = choices.data ?? [];
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled || choices.loading}
      aria-label={label}
      className={inputClass}
    >
      <option value="">No sales rep</option>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
