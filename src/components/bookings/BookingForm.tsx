"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { AREAS } from "@/config/areas";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { Booking, Driver } from "@/lib/types";

type BookingFormProps = {
  booking?: Booking; // present = edit mode
  submitLabel: string;
  onSaved: (code: string) => void;
};

export default function BookingForm({ booking, submitLabel, onSaved }: BookingFormProps) {
  const drivers = useQuery<Driver[]>(() =>
    supabase.from("drivers").select("*").eq("active", true).order("name")
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || null;

    const fields = {
      sender_name: text("sender_name"),
      sender_phone: text("sender_phone"),
      receiver_name: text("receiver_name"),
      receiver_phone: text("receiver_phone"),
      receiver_address: text("receiver_address"),
      pickup_area: text("pickup_area"),
      pickup_address: text("pickup_address"),
      driver_id: text("driver_id"),
      estimated_bill: f.get("estimated_bill") ? Number(f.get("estimated_bill")) : null,
      // Only editable after the booking exists (set once the invoice is raised).
      ...(booking ? { invoice_amount: f.get("invoice_amount") ? Number(f.get("invoice_amount")) : null } : {}),
      notes: text("notes"),
    };

    setBusy(true);
    setError(null);
    // New bookings get their code (BK-1001, ...) from the database.
    const { data, error } = booking
      ? await supabase.from("bookings").update(fields).eq("id", booking.id).select("code").single()
      : await supabase.from("bookings").insert(fields).select("code").single();
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(data.code);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      <Card title="Sender">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input name="sender_name" required defaultValue={booking?.sender_name} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="sender_phone" type="tel" defaultValue={booking?.sender_phone ?? ""} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title="Receiver">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input name="receiver_name" required defaultValue={booking?.receiver_name} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="receiver_phone" type="tel" defaultValue={booking?.receiver_phone ?? ""} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Delivery address">
              <textarea name="receiver_address" rows={2} defaultValue={booking?.receiver_address ?? ""} className={inputClass} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Pickup & billing">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pickup area">
            <select name="pickup_area" required defaultValue={booking?.pickup_area ?? ""} className={inputClass}>
              <option value="" disabled>
                Select area…
              </option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Pickup address">
              <textarea name="pickup_address" required rows={2} defaultValue={booking?.pickup_address} className={inputClass} />
            </Field>
          </div>
          <Field label="Assigned driver">
            {/* key remounts the select once drivers load so the saved value is selected */}
            <select
              key={drivers.data ? "loaded" : "loading"}
              name="driver_id"
              className={inputClass}
              defaultValue={booking?.driver_id ?? ""}
            >
              <option value="">Unassigned</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approx. bill (estimate)">
            <input
              name="estimated_bill"
              type="number"
              min="0"
              step="0.01"
              placeholder="Rough idea, optional"
              defaultValue={booking?.estimated_bill ?? ""}
              className={inputClass}
            />
          </Field>
          {booking && (
            <Field label="Invoice amount (once billed)">
              <input
                name="invoice_amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="Final bill after invoice"
                defaultValue={booking.invoice_amount ?? ""}
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Notes">
            <input name="notes" defaultValue={booking?.notes ?? ""} className={inputClass} />
          </Field>
        </div>
      </Card>

      <ErrorMessage message={error} />
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
