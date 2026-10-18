"use client";

import { useEffect, useState } from "react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import { Button, ErrorMessage, Notice } from "@/components/ui/form";
import { CELEBRATIONS_CHANGED, previewCelebration } from "@/lib/celebrate";
import { DEFAULT_CELEBRATIONS, EVENT_KEYS, EVENT_LABEL, STYLES, normalizeCelebrations, type Celebrations } from "@/lib/celebrations";
import { supabase } from "@/lib/supabase";

/**
 * Settings card for managers: whether celebrations play, which style, and which jobs celebrate. A Preview button plays each style
 * (even when celebrations are off or on a quiet timer). Saved only through the checked database function.
 */
export default function CelebrationsCard() {
  const [draft, setDraft] = useState<Celebrations>(DEFAULT_CELEBRATIONS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only a saved value that really loaded can be edited and saved: never save defaults the manager did not see.
      try {
        const { data, error } = await supabase.from("app_settings").select("value").eq("key", "celebrations").maybeSingle();
        if (cancelled) return;
        if (error) return setLoadError(error.message);
        setDraft(normalizeCelebrations((data as { value?: unknown } | null)?.value));
        setLoaded(true);
      } catch {
        if (!cancelled) setLoadError("Could not load the saved choice.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (next: Celebrations) => {
    setDraft(next);
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error } = await supabase.rpc("save_celebrations", { p_enabled: draft.enabled, p_style: draft.style, p_events: draft.events });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    try {
      window.dispatchEvent(new Event(CELEBRATIONS_CHANGED));
    } catch {}
  }

  return (
    <CollapsibleCard title="Celebrations">
      <p className="mb-3 text-sm text-slate-600">A short firework and a friendly message when the team finishes good work. People can also turn it off on their own device from My profile.</p>
      <ErrorMessage message={loadError} />
      <fieldset disabled={!loaded} className="min-w-0">
      <label className="flex min-h-11 items-center gap-3 text-base text-slate-800">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => change({ ...draft, enabled: e.target.checked })} className="h-6 w-6" />
        Celebrate good work
      </label>

      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-medium text-slate-700">Style</legend>
        <ul className="divide-y divide-slate-100">
          {STYLES.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-2">
              <label className="flex min-h-11 min-w-48 flex-1 items-start gap-3">
                <input type="radio" name="celebration-style" checked={draft.style === s.key} onChange={() => change({ ...draft, style: s.key })} className="mt-1 h-5 w-5" />
                <span>
                  <span className="block text-base font-medium text-slate-900">{s.label}</span>
                  <span className="block text-sm text-slate-600">{s.description}</span>
                </span>
              </label>
              <Button type="button" variant="secondary" onClick={() => previewCelebration(s.key)}>
                Preview
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-600">On slower phones the app plays the confetti pop instead of the bigger styles, so it never feels slow.</p>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-medium text-slate-700">Celebrate when</legend>
        {EVENT_KEYS.map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-3 text-base text-slate-800">
            <input type="checkbox" checked={draft.events[k]} onChange={(e) => change({ ...draft, events: { ...draft.events, [k]: e.target.checked } })} className="h-6 w-6" />
            {EVENT_LABEL[k]}
          </label>
        ))}
      </fieldset>
      </fieldset>

      <ErrorMessage message={error} />
      {saved && <Notice className="mt-3">Saved. It applies straight away.</Notice>}
      <div className="mt-4">
        <Button onClick={save} disabled={busy || !loaded}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </CollapsibleCard>
  );
}
