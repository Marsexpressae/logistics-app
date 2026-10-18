"use client";

import { useState, type FormEvent } from "react";
import { BADGE_ICONS } from "@/components/rewards/Medal";
import { Button, ErrorMessage, Field, Notice, inputClass } from "@/components/ui/form";
import { FAMILY_LABEL, medalColors } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

type Rule = { key: string; label: string };

/** Make a new badge: what it is called, its icon and medal tier, and what earns it. The database checks every choice. */
export default function AddBadgeForm({ rules, families, onAdded }: { rules: Rule[]; families: string[]; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("star");
  const [family, setFamily] = useState("");
  const [tier, setTier] = useState("1");
  const [kind, setKind] = useState("count");
  const [rule, setRule] = useState("");
  const [goal, setGoal] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone(null);
    setError(null);
    setBusy(true);
    const { error } = await supabase.rpc("create_badge", {
      p_name: name,
      p_description: description,
      p_icon: icon,
      p_family: family || null,
      p_tier: family ? Number(tier) : null,
      p_kind: kind,
      p_rule_key: kind === "count" ? rule : null,
      p_threshold: kind === "manual" ? null : Number(goal),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(`Added ${name.trim()}`);
    setName("");
    setDescription("");
    onAdded();
  }

  const colors = medalColors(family ? Number(tier) : null);
  return (
    <form onSubmit={add} className="space-y-4" noValidate>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} placeholder="Seven payments" />
      </Field>
      <Field label="What it means (staff see this)">
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} className={inputClass} placeholder="Recorded 7 payments" />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Icon</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(BADGE_ICONS).map(([key, Icon]) => (
            <label
              key={key}
              className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-700 ${icon === key ? "ring-2 ring-brand-700 ring-offset-2" : "opacity-50"}`}
              style={{ borderColor: colors.ring, background: colors.fill, color: colors.ink }}
            >
              <input type="radio" name="icon" value={key} checked={icon === key} onChange={() => setIcon(key)} className="sr-only" />
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">{key.replace("-", " ")}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Family (a set of medals)">
          <input value={family} onChange={(e) => setFamily(e.target.value)} list="badge-families" className={inputClass} placeholder="None (one-off)" />
          <datalist id="badge-families">
            {families.map((f) => (
              <option key={f} value={f}>
                {FAMILY_LABEL[f] ?? f}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Tier (1 bronze to 5 purple)">
          <select value={tier} onChange={(e) => setTier(e.target.value)} disabled={!family} className={inputClass}>
            {[1, 2, 3, 4, 5].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="How it is earned">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
          <option value="count">By doing something a number of times</option>
          <option value="streak">By working a number of days in a row</option>
          <option value="manual">Given by hand by a manager</option>
        </select>
      </Field>
      {kind === "count" && (
        <Field label="What is counted">
          <select value={rule} onChange={(e) => setRule(e.target.value)} className={inputClass}>
            <option value="">Choose</option>
            {rules.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
            <option value="thank_you">Thank-yous received</option>
          </select>
        </Field>
      )}
      {kind !== "manual" && (
        <Field label="Goal (how many)">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} type="number" min={1} className={inputClass} />
        </Field>
      )}
      <ErrorMessage message={error} />
      {done && <Notice>{done}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add badge"}
      </Button>
    </form>
  );
}
