"use client";

import { useState } from "react";
import SalesRepSelect from "@/components/people/SalesRepSelect";
import { ErrorMessage } from "@/components/ui/form";
import { supabase } from "@/lib/supabase";

/**
 * Who the sales rep (owner) is, on a booking or a customer. Everyone sees the name; people who may change it (the permission
 * "Change the sales rep (owner)") get a dropdown that saves straight away. A booking is updated directly; a customer through
 * a protected function, because customers cannot be written to directly.
 */
export default function SalesRepEditor({ table, id, currentId, currentName, label, canChange, onSaved }: {
  table: "bookings" | "customers";
  id: string;
  currentId: string | null;
  currentName: string | null;
  label: string;
  canChange: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string | null>(currentId);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string | null) {
    const before = value;
    setValue(next);
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error } =
      table === "customers"
        ? await supabase.rpc("set_customer_sales_rep", { p_customer_id: id, p_sales_rep_id: next })
        : await supabase.from("bookings").update({ sales_rep_id: next }).eq("id", id);
    setBusy(false);
    if (error) {
      setValue(before);
      return setError(error.message);
    }
    setSaved(true);
    onSaved();
  }

  return (
    <div>
      <p className="mb-1 text-sm text-slate-600">{label}</p>
      {canChange ? (
        <>
          <SalesRepSelect value={value} onChange={change} disabled={busy} label={label} />
          {saved && <p role="status" className="mt-1 text-sm text-green-700">Saved</p>}
        </>
      ) : (
        <p className="text-base text-slate-900">{currentName ?? "—"}</p>
      )}
      <ErrorMessage message={error} />
    </div>
  );
}
