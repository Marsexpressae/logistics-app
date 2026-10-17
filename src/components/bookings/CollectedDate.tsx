"use client";

import { useState } from "react";
import { Button, Card, ErrorMessage } from "@/components/ui/form";
import { dateStamp, formatDay } from "@/lib/format";
import DateField from "@/components/ui/DateField";
import { supabase } from "@/lib/supabase";

/**
 * The day the cargo was really collected, which is also the invoice date. Shown once a pickup is collected, so an old record
 * entered today can be given its real day. A day in the future is refused.
 */
export default function CollectedDate({ bookingId, collectedAt, canEdit, onChanged }: { bookingId: string; collectedAt: string; canEdit: boolean; onChanged: () => void }) {
  const current = collectedAt.slice(0, 10);
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("bookings").update({ collected_at: dateStamp(day) }).eq("id", bookingId);
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
    setSaved(`Collected date changed to ${formatDay(day)}.`);
    onChanged();
  }

  return (
    <Card title="Collected (invoice date)">
      <ErrorMessage message={error} />
      {saved && !editing && <p role="status" className="mb-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{saved}</p>}
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="Collected on" value={day} onChange={setDay} />
          <Button onClick={save} disabled={busy || !day}>
            {busy ? "Saving…" : "Save date"}
          </Button>
          <Button variant="secondary" onClick={() => { setEditing(false); setDay(current); setError(null); }} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base text-slate-900">{formatDay(current)}</p>
          {canEdit && (
            <Button variant="secondary" onClick={() => { setSaved(null); setEditing(true); }}>
              Change date
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
