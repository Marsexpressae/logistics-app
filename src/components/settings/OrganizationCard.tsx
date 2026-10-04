"use client";

import { useState } from "react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { COUNTRIES, CURRENCIES, useOrganization } from "@/lib/organization";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { site } from "@/config/site";

type Draft = { legal_name: string; currency: string; country: string };

/** Settings > Organization: the legal name (different from the brand name), the currency and the country. */
export default function OrganizationCard() {
  const canChange = usePermissions().can("settings.manage");
  const { org, loading, reload, error: loadError } = useOrganization();
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const value: Draft = { legal_name: org?.legal_name ?? "", currency: org?.currency ?? "AED", country: org?.country ?? "", ...draft };
  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((k) => org && draft[k] !== org[k]).length;

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_organization", { p_legal_name: value.legal_name, p_currency: value.currency, p_country: value.country });
    setBusy(false);
    if (error) return setError(error.message);
    setDraft({});
    setSaved(true);
    reload();
  }

  return (
    <Card title="Organization">
      <ErrorMessage message={loadError ?? error} />
      {loading && !org ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Organization name">
              <input
                className={inputClass}
                value={value.legal_name}
                maxLength={120}
                disabled={!canChange || busy}
                placeholder="Registered (legal) name, as on your trade licence"
                onChange={(e) => edit({ legal_name: e.target.value })}
              />
            </Field>
            <p className="mt-1 text-xs text-slate-500">
              The legal name. It is different from the brand name, which stays &quot;{site.name}&quot;. It appears on printed documents.
            </p>
          </div>
          <Field label="Currency">
            <select className={inputClass} value={value.currency} disabled={!canChange || busy} onChange={(e) => edit({ currency: e.target.value })}>
              {!CURRENCIES.some((c) => c.code === value.currency) && <option value={value.currency}>{value.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location / country">
            <select className={inputClass} value={value.country} disabled={!canChange || busy} onChange={(e) => edit({ country: e.target.value })}>
              {!COUNTRIES.includes(value.country) && <option value={value.country}>{value.country}</option>}
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {!canChange && <p className="mt-2 text-xs text-slate-500">Only people with &quot;Change app settings&quot; can change this.</p>}
      {changed > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <span>
            {changed} unsaved {changed === 1 ? "change" : "changes"}
          </span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setDraft({})} disabled={busy}>
              Discard
            </Button>
            <Button onClick={save} disabled={busy || !value.country.trim()}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </span>
        </div>
      )}
      {saved && changed === 0 && <p className="mt-3 text-sm text-green-700">Saved.</p>}
    </Card>
  );
}
