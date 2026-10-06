"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Warehouse } from "@/lib/types";

/**
 * Settings > Organization > Warehouses: the names people choose when receiving cargo ("Warehouse A", "Tarpal 2", "East Shed").
 * The short code is printed on labels. A warehouse that has had parcels cannot be deleted (that history stays); deactivate it instead.
 */
export default function WarehousesCard() {
  const canChange = usePermissions().can("settings.manage");
  const list = useQuery<Warehouse[]>(() => supabase.from("warehouses").select("*").order("name"));
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", code: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = list.data ?? [];

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action;
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    list.reload();
    return true;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(supabase.rpc("add_warehouse", { p_name: String(f.get("name") ?? ""), p_code: String(f.get("code") ?? "") || null }));
    if (ok) form.reset();
  }

  async function saveEdit(w: Warehouse) {
    const ok = await run(supabase.rpc("update_warehouse", { p_id: w.id, p_name: draft.name, p_code: draft.code, p_active: w.active !== false }));
    if (ok) setEditing(null);
  }

  const setActive = (w: Warehouse, active: boolean) =>
    run(supabase.rpc("update_warehouse", { p_id: w.id, p_name: w.name, p_code: w.code, p_active: active }));

  function remove(w: Warehouse) {
    if (confirm(`Delete "${w.name}"?\n\nThis only works if it never had any parcels.`)) run(supabase.rpc("delete_warehouse", { p_id: w.id }));
  }

  return (
    <Card title="Warehouses">
      <p className="mb-3 text-sm text-slate-500">
        The places cargo is kept: a warehouse, a tarpal, a shed or a rack position. The short code is printed on parcel labels. A place that has had parcels can be deactivated but not deleted.
      </p>
      <ErrorMessage message={list.error ?? error} />

      {list.loading && !list.data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((w) =>
            editing === w.id ? (
              <li key={w.id} className="grid grid-cols-[1fr_6rem_auto_auto] items-center gap-2 py-2">
                <input className={inputClass} value={draft.name} maxLength={40} aria-label="Warehouse name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input
                  className={`${inputClass} font-mono uppercase`}
                  value={draft.code}
                  maxLength={6}
                  aria-label="Short code"
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
                <button aria-label="Save changes" disabled={busy} onClick={() => saveEdit(w)} className="flex h-11 w-11 items-center justify-center text-green-700">
                  <Check className="h-5 w-5" />
                </button>
                <button aria-label="Cancel" onClick={() => setEditing(null)} className="flex h-11 w-11 items-center justify-center text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </li>
            ) : (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className={w.active === false ? "text-slate-500" : ""}>
                  <span className="font-medium">{w.name}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{w.code}</span>
                  {w.active === false && <span className="ml-2 text-xs">Inactive</span>}
                </span>
                {canChange && (
                  <span className="flex items-center gap-1">
                    <button
                      aria-label={`Edit ${w.name}`}
                      onClick={() => {
                        setEditing(w.id);
                        setDraft({ name: w.name, code: w.code });
                        setError(null);
                      }}
                      className="flex h-11 w-11 items-center justify-center text-slate-600 hover:text-slate-900"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setActive(w, w.active === false)} disabled={busy} className="min-h-11 px-3 text-sm font-medium text-slate-700 hover:text-slate-900">
                      {w.active === false ? "Activate" : "Deactivate"}
                    </button>
                    <button aria-label={`Delete ${w.name}`} onClick={() => remove(w)} className="flex h-11 w-11 items-center justify-center text-slate-600 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                )}
              </li>
            )
          )}
        </ul>
      )}

      {canChange ? (
        <form onSubmit={add} className="mt-4 grid grid-cols-[1fr_6rem] items-end gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <Field label="New warehouse name">
            <input name="name" required maxLength={40} placeholder="e.g. Tarpal A, East Shed, Rack A3" className={inputClass} />
          </Field>
          <Field label="Short code">
            <input name="code" maxLength={6} placeholder="Automatic" className={`${inputClass} font-mono uppercase`} />
          </Field>
          <div className="col-span-2 sm:col-span-1">
            <Button type="submit" disabled={busy} className="w-full">
              Add warehouse
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Only people with &quot;Change app settings&quot; can change this.</p>
      )}
    </Card>
  );
}
