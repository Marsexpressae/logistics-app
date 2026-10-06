"use client";

import { useState } from "react";
import { Button, Card, ErrorMessage, Field, inputClass, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type Series = { kind: string; label: string; prefix: string; next_number: number };

/**
 * Settings > Numbering: the ONE place for every prefix in the app. Automatic numbers are PREFIX + NEXT NUMBER
 * (for example INV- and 3835 gives INV-3835), and the next number goes up by one each time. The list is read from the
 * database, so a new kind of number added later appears here by itself. Used numbers are skipped, so a typed number
 * never causes a clash.
 */
export default function NumberingCard() {
  const { can } = usePermissions();
  const canChange = can("settings.manage");
  const series = useQuery<Series[]>(() => supabase.from("number_series").select("kind, label, prefix, next_number").order("sort"));
  const [draft, setDraft] = useState<Record<string, { prefix: string; next: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = series.data ?? [];
  const value = (s: Series) => draft[s.kind] ?? { prefix: s.prefix, next: String(s.next_number) };
  const changed = rows.filter((s) => draft[s.kind] && (draft[s.kind].prefix !== s.prefix || draft[s.kind].next !== String(s.next_number)));

  function edit(s: Series, patch: Partial<{ prefix: string; next: string }>) {
    setDraft({ ...draft, [s.kind]: { ...value(s), ...patch } });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    for (const s of changed) {
      const v = draft[s.kind];
      const { error } = await supabase.rpc("set_number_series", { p_kind: s.kind, p_prefix: v.prefix, p_next: Number(v.next) });
      if (error) {
        setError(`${s.label}: ${error.message}`);
        setBusy(false);
        series.reload();
        return;
      }
    }
    setDraft({});
    setSaved(true);
    setBusy(false);
    series.reload();
  }

  return (
    <Card title="Numbering">
      <p className="mb-3 text-sm text-slate-500">
        Every prefix in the app is set here, and only here. Automatic numbers are the prefix plus the next number. To continue an old series, set the next number here, for example 3835.
      </p>
      <ErrorMessage message={series.error ?? error} />
      {series.loading ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {rows.map((s) => {
            const v = value(s);
            return (
              <div key={s.kind}>
                <p className="mb-1 font-medium text-slate-900">{s.label}</p>
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                  <Field label="Prefix">
                    <input
                      className={inputClass}
                      value={v.prefix}
                      maxLength={10}
                      disabled={!canChange || busy}
                      onChange={(e) => edit(s, { prefix: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Next number">
                    <input
                      className={inputClass}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={v.next}
                      disabled={!canChange || busy}
                      onChange={(e) => edit(s, { next: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  The next one will be <span className="font-mono font-medium text-slate-700">{`${v.prefix}${v.next}`}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}
      {!canChange && <p className="mt-2 text-xs text-slate-500">Only people with &quot;Change app settings&quot; can change this.</p>}
      {changed.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
          <span>
            {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setDraft({})} disabled={busy}>
              Discard
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </span>
        </div>
      )}
      {saved && changed.length === 0 && <p role="status" className="mt-3 text-sm text-green-700">Saved. New numbers use it straight away.</p>}
    </Card>
  );
}
