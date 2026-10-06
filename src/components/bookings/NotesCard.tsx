"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Card, Button, ErrorMessage, inputClass, Loading } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { BookingNote } from "@/lib/types";

type Person = { id: string; full_name: string; role_label: string };

/**
 * Notes on a job (shared by the booking, pickup and warehouse screens). They stay with the booking and its invoice,
 * so the next person sees what was said. Type @ to mention a colleague: they get an alert on the bell.
 * Notes cannot be edited or deleted; a mistake is fixed with a new note.
 */
export default function NotesCard({ bookingId }: { bookingId: string }) {
  const { can } = usePermissions();
  const canWrite = can("notes.write");
  const notes = useQuery<BookingNote[]>(
    () => supabase.from("booking_notes").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    [bookingId]
  );
  const people = useQuery<Person[]>(
    () => (canWrite ? (supabase.rpc("mentionable_users", { p_booking_id: bookingId }) as never) : Promise.resolve({ data: [], error: null })),
    [bookingId, canWrite]
  );

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const everyone = people.data ?? [];
  // Suggestions appear while the last word being typed starts with @.
  const typing = text.match(/(^|\s)@([^\s@]*)$/);
  const suggestions = typing ? everyone.filter((p) => p.full_name.toLowerCase().replace(/\s+/g, "").startsWith(typing[2].toLowerCase())).slice(0, 5) : [];

  const pick = (p: Person) => setText(text.replace(/@([^\s@]*)$/, `@${p.full_name} `));
  // A person counts as mentioned when "@Their Name" is still in the text when the note is added.
  const mentioned = (body: string) => everyone.filter((p) => body.includes(`@${p.full_name}`)).map((p) => p.id);

  async function add(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("booking_notes").insert({ booking_id: bookingId, body, mentions: mentioned(body) });
    setBusy(false);
    if (error) return setError(error.message);
    setText("");
    notes.reload();
  }

  const submitWithKeyboard = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(e);
  };

  // Show "@Name" in bold in a saved note.
  const names = [...everyone.map((p) => p.full_name), ...(notes.data ?? []).map((n) => n.author_name)].filter(Boolean);
  const renderBody = (body: string) => {
    const pattern = names.length ? new RegExp(`(@(?:${[...new Set(names)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g") : null;
    return (pattern ? body.split(pattern) : [body]).map((part, i) =>
      part.startsWith("@") && names.includes(part.slice(1)) ? (
        <strong key={i} className="font-semibold text-brand-700">
          {part}
        </strong>
      ) : (
        part
      )
    );
  };

  return (
    <Card title="Notes">
      {canWrite && (
        <form onSubmit={add} className="mb-4 space-y-2">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={submitWithKeyboard}
              maxLength={2000}
              rows={3}
              placeholder="Write a note about this job. Type @ to mention a colleague."
              aria-label="New note"
              className={inputClass}
            />
            {suggestions.length > 0 && (
              <ul role="listbox" className="absolute left-0 right-0 z-10 mt-1 rounded-md border border-slate-200 bg-white shadow-lg">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => pick(p)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span>{p.full_name}</span>
                      <span className="text-xs text-slate-500">{p.role_label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ErrorMessage message={error} />
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? "Adding…" : "Add note"}
          </Button>
        </form>
      )}

      {notes.loading && !notes.data ? (
        <Loading />
      ) : !notes.data?.length ? (
        <p className="text-sm text-slate-500">No notes yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {notes.data.map((n) => (
            <li key={n.id} className="py-3">
              <p className="whitespace-pre-wrap text-slate-800">{renderBody(n.body)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {n.author_name} · {formatDate(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage message={notes.error} />
    </Card>
  );
}
