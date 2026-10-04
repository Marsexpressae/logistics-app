"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, ErrorMessage, inputClass } from "@/components/ui/form";
import { kg, round2 } from "@/lib/format";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { BookingItem } from "@/lib/types";

type ItemsCardProps = {
  bookingId: string;
  status: string;
  items: BookingItem[];
  onChanged: () => void;
};

/**
 * The packages recorded at pickup. Shared by the pickup page and the booking page, so both always show the
 * same list. Each row shows the weight of ONE package and the line total, so "2 x 40 kg" cannot be misread.
 *
 * Who can change it:
 *   - before collection: the pickup team (and the office)
 *   - after collection: only roles that can edit bookings (the office); who has that is set on the Roles page
 */
export default function ItemsCard({ bookingId, status, items, onChanged }: ItemsCardProps) {
  const { can } = usePermissions();
  const canChange = can("bookings.edit") || (can("pickups.collect") && status === "booked");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ description: "", quantity: "1", weight_kg: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalWeight = round2(items.reduce((s, i) => s + Number(i.weight_kg) * i.quantity, 0));
  const totalPackages = items.reduce((s, i) => s + i.quantity, 0);

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action;
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    onChanged();
    return true;
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await run(
      supabase.from("booking_items").insert({
        booking_id: bookingId,
        description: String(f.get("description")).trim(),
        quantity: Number(f.get("quantity") || 1),
        weight_kg: Number(f.get("weight_kg") || 0),
      })
    );
    if (ok) form.reset();
  }

  function startEdit(i: BookingItem) {
    setEditingId(i.id);
    setDraft({ description: i.description, quantity: String(i.quantity), weight_kg: String(Number(i.weight_kg)) });
    setError(null);
  }

  async function saveEdit() {
    if (!draft.description.trim()) return setError("Please describe the item.");
    const ok = await run(
      supabase
        .from("booking_items")
        .update({
          description: draft.description.trim(),
          quantity: Math.max(1, Number(draft.quantity) || 1),
          weight_kg: Math.max(0, Number(draft.weight_kg) || 0),
        })
        .eq("id", editingId!)
    );
    if (ok) setEditingId(null);
  }

  function remove(i: BookingItem) {
    const sure = confirm(
      `Remove "${i.description}" (${i.quantity} × ${kg(Number(i.weight_kg))})?\n\nThis is saved straight away and recorded in the Activity log.`
    );
    if (sure) run(supabase.from("booking_items").delete().eq("id", i.id));
  }

  return (
    <Card title="Package items">
      {items.length ? (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {items.map((i) =>
            editingId === i.id ? (
              <li key={i.id} className="space-y-2 py-2">
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  aria-label="Item description"
                  className={inputClass}
                />
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={draft.quantity}
                    onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                    aria-label="Quantity"
                    className={inputClass}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.weight_kg}
                    onChange={(e) => setDraft({ ...draft, weight_kg: e.target.value })}
                    aria-label="Weight in kg, each"
                    className={inputClass}
                  />
                  <button aria-label="Save changes" disabled={busy} onClick={saveEdit} className="p-2 text-green-700">
                    <Check className="h-5 w-5" />
                  </button>
                  <button aria-label="Cancel" onClick={() => setEditingId(null)} className="p-2 text-slate-500">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </li>
            ) : (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">
                    {i.quantity} × {i.description}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {kg(Number(i.weight_kg))} each · {kg(Number(i.weight_kg) * i.quantity)}
                  </span>
                </span>
                {canChange && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button aria-label={`Edit ${i.description}`} onClick={() => startEdit(i)} className="p-2 text-slate-400 hover:text-slate-700">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button aria-label={`Remove ${i.description}`} onClick={() => remove(i)} className="p-2 text-slate-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                )}
              </li>
            )
          )}
          <li className="flex justify-between py-2 font-medium">
            <span>
              Total · {totalPackages} {totalPackages === 1 ? "package" : "packages"}
            </span>
            <span>{kg(totalWeight)}</span>
          </li>
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-500">No items recorded yet.</p>
      )}

      {canChange ? (
        <form onSubmit={add} className="grid grid-cols-3 gap-2">
          <div className="col-span-3">
            <input name="description" required placeholder="Item description" className={inputClass} />
          </div>
          <input name="quantity" type="number" min="1" defaultValue="1" aria-label="Quantity" className={inputClass} />
          <input name="weight_kg" type="number" min="0" step="0.01" placeholder="kg each" aria-label="Weight in kg, each" className={inputClass} />
          <Button type="submit" disabled={busy}>
            Add
          </Button>
        </form>
      ) : (
        status !== "booked" && (
          <p className="text-xs text-slate-500">Locked after collection. The office can correct it if something is wrong.</p>
        )
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}
