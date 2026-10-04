"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import { supabase } from "@/lib/supabase";

/**
 * Where a parcel sits inside its warehouse ("Rack 3", "Left wall"). Free text, optional.
 * Press the pencil to type it, then the tick to save (or Enter).
 */
export default function ParcelPosition({
  parcelId,
  barcode,
  position,
  canEdit,
  onChanged,
}: {
  parcelId: string;
  barcode: string;
  position: string | null | undefined;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_parcel_position", { p_parcel_id: parcelId, p_position: text });
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={text}
            maxLength={60}
            aria-label={`Position of ${barcode}`}
            placeholder="e.g. Rack 3"
            className={`${inputClass} w-32 py-1`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button aria-label="Save position" disabled={busy} onClick={save} className="p-1 text-green-700">
            <Check className="h-4 w-4" />
          </button>
          <button aria-label="Cancel" onClick={() => setEditing(false)} className="p-1 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </span>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className={position ? "" : "text-slate-400"}>{position || "—"}</span>
      {canEdit && (
        <button
          aria-label={`Set the position of ${barcode}`}
          onClick={() => {
            setText(position ?? "");
            setError(null);
            setEditing(true);
          }}
          className="p-1 text-slate-400 hover:text-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}
