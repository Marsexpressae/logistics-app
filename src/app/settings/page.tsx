"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck, UserCog } from "lucide-react";
import NumberingCard from "@/components/settings/NumberingCard";
import OrganizationCard from "@/components/settings/OrganizationCard";
import ProblemsCard from "@/components/settings/ProblemsCard";
import WarehousesCard from "@/components/settings/WarehousesCard";
import PageHeader from "@/components/ui/PageHeader";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import { Button, ErrorMessage, Loading } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { NAV_SETTINGS_CHANGED } from "@/lib/nav-settings";

type Setting = { key: string; value: unknown; label: string; description: string | null };

export default function SettingsPage() {
  const { can } = usePermissions();
  const canChange = can("settings.manage");
  const settings = useQuery<Setting[]>(() => supabase.from("app_settings").select("*").order("key"));

  // Switches are only collected here; nothing is saved until Save changes is pressed.
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = (s: Setting) => draft[s.key] ?? s.value === true;
  const changed = Object.keys(draft).length;

  function toggle(s: Setting, on: boolean) {
    const next = { ...draft };
    if ((s.value === true) === on) delete next[s.key]; // back to how it was: not a change
    else next[s.key] = on;
    setDraft(next);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    for (const [key, on] of Object.entries(draft)) {
      const { error } = await supabase.from("app_settings").update({ value: on, updated_at: new Date().toISOString() }).eq("key", key);
      if (error) {
        setError(error.message);
        setBusy(false);
        settings.reload();
        return;
      }
    }
    setDraft({});
    window.dispatchEvent(new Event(NAV_SETTINGS_CHANGED)); // a menu switch takes effect straight away
    setSaved(true);
    setBusy(false);
    settings.reload();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Control how the app behaves, and who can use it." />

      <CollapsibleCard title="App controls" defaultOpen badge={changed > 0 ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">{changed} unsaved</span> : null}>
        <ErrorMessage message={settings.error ?? error} />
        {settings.loading ? (
          <Loading />
        ) : !settings.data?.length ? (
          <p className="text-sm text-slate-500">No controls available.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {settings.data.map((s) => (
              <li key={s.key} className="flex items-start justify-between gap-4 py-3">
                <label htmlFor={s.key} className="text-sm">
                  <span className="block font-medium text-slate-900">{s.label}</span>
                  {s.description && <span className="mt-0.5 block text-slate-500">{s.description}</span>}
                </label>
                <input
                  id={s.key}
                  type="checkbox"
                  role="switch"
                  className="mt-1 h-5 w-5 shrink-0 accent-brand-600"
                  checked={current(s)}
                  disabled={!canChange || busy}
                  onChange={(e) => toggle(s, e.target.checked)}
                />
              </li>
            ))}
          </ul>
        )}
        {!canChange && <p className="mt-2 text-xs text-slate-500">Only people with &quot;Change app settings&quot; can change these.</p>}
        {changed > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
            <span>
              {changed} unsaved {changed === 1 ? "change" : "changes"}
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
        {saved && changed === 0 && <p role="status" className="mt-3 text-sm text-green-700">Saved. It applies straight away.</p>}
      </CollapsibleCard>

      <OrganizationCard />

      <WarehousesCard />

      <NumberingCard />

      <ProblemsCard />

      <CollapsibleCard title="People and access" defaultOpen>
        <ul className="divide-y divide-slate-100">
          {can("users.manage") && (
            <li>
              <Link href="/settings/users" className="flex items-center gap-3 py-3 text-sm">
                <UserCog className="h-5 w-5 text-slate-500" />
                <span className="flex-1">
                  <span className="block font-medium text-slate-900">Users</span>
                  <span className="text-slate-500">Add people, change their role, name or email, reset passwords</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </li>
          )}
          {can("roles.manage") && (
            <li>
              <Link href="/settings/roles" className="flex items-center gap-3 py-3 text-sm">
                <ShieldCheck className="h-5 w-5 text-slate-500" />
                <span className="flex-1">
                  <span className="block font-medium text-slate-900">Roles &amp; Permissions</span>
                  <span className="text-slate-500">Choose what each role can do</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </li>
          )}
        </ul>
        {!can("users.manage") && !can("roles.manage") && <p className="text-sm text-slate-500">Nothing here for your role.</p>}
      </CollapsibleCard>
    </div>
  );
}
