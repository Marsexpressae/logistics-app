"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorMessage, Field, Notice, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile } from "@/lib/profile-context";
import type { DirectoryPerson } from "@/lib/rewards";
import { supabase } from "@/lib/supabase";

/** A thank-you with points, or a badge given by hand. Both go to a colleague (not yourself) with a short message. */
export default function GiveForm({ manualBadges, onGiven }: { manualBadges: { key: string; name: string }[]; onGiven: () => void }) {
  const me = useCurrentProfile();
  const people = useQuery<DirectoryPerson[]>(() => supabase.rpc("people_directory") as never);
  const [person, setPerson] = useState("");
  const [what, setWhat] = useState("thanks");
  const [points, setPoints] = useState("10");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = (people.data ?? []).filter((p) => p.id !== me.id);

  async function give(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone(null);
    setError(null);
    if (!person) return setError("Choose who it is for.");
    setBusy(true);
    const name = others.find((p) => p.id === person)?.full_name ?? "them";
    const { error } =
      what === "thanks"
        ? await supabase.rpc("give_thank_you", { p_person: person, p_points: Number(points), p_message: message })
        : await supabase.rpc("give_badge", { p_person: person, p_badge: what, p_message: message });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(what === "thanks" ? `Thank-you sent to ${name}` : `Badge given to ${name}`);
    setMessage("");
    onGiven();
  }

  return (
    <form onSubmit={give} className="space-y-4" noValidate>
      <Field label="For">
        <select value={person} onChange={(e) => setPerson(e.target.value)} className={inputClass}>
          <option value="">Choose a colleague</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Give">
        <select value={what} onChange={(e) => setWhat(e.target.value)} className={inputClass}>
          <option value="thanks">A thank-you with points</option>
          {manualBadges.map((b) => (
            <option key={b.key} value={b.key}>
              Badge: {b.name}
            </option>
          ))}
        </select>
      </Field>
      {what === "thanks" && (
        <Field label="Points (1 to 100)">
          <input value={points} onChange={(e) => setPoints(e.target.value)} type="number" min={1} max={100} className={inputClass} />
        </Field>
      )}
      <Field label="Message (they will see it)">
        <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} className={inputClass} placeholder="Great job on the late rush" />
      </Field>
      <ErrorMessage message={error} />
      {done && <Notice>{done}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : what === "thanks" ? "Send thank-you" : "Give badge"}
      </Button>
    </form>
  );
}
