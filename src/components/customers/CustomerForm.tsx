"use client";

import { useState, type FormEvent } from "react";
import PhoneInput from "@/components/ui/PhoneInput";
import { Button, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import type { Customer } from "@/lib/customers";
import { formatGeo, parseGeo } from "@/lib/geo";
import { formatPhone, parsePhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";

/** Create a customer, or edit one. The phone is checked and saved in international format (UAE is assumed). */
export default function CustomerForm({
  customer,
  onSaved,
  onCancel,
}: {
  customer?: Customer;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState(formatPhone(customer?.phone));
  const [whatsapp, setWhatsapp] = useState(formatPhone(customer?.whatsapp));
  const [geoText, setGeoText] = useState(customer ? formatGeo(customer.geo_lat, customer.geo_lng) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();

    const call = phone.trim() ? parsePhone(phone) : null;
    if (phone.trim() && !call) return setError("Please enter a valid phone number, e.g. 050 123 4567.");
    const wa = whatsapp.trim() ? parsePhone(whatsapp) : null;
    if (whatsapp.trim() && !wa) return setError("The WhatsApp number is not valid.");
    const geo = geoText.trim() ? parseGeo(geoText) : null;
    if (geoText.trim() && !geo) return setError("Geo location: paste coordinates like 25.2048, 55.2708 or a full Google Maps link.");

    const args = {
      p_name: text("full_name"),
      p_phone: call?.e164 ?? null,
      p_whatsapp: wa && wa.e164 !== call?.e164 ? wa.e164 : null,
      p_address: text("address") || null,
      p_lat: geo?.lat ?? null,
      p_lng: geo?.lng ?? null,
      p_eid: text("emirates_id") || null,
    };
    setBusy(true);
    setError(null);
    if (customer) {
      const { error } = await supabase.rpc("update_customer", { p_id: customer.id, ...args });
      setBusy(false);
      if (error) return setError(error.message);
      onSaved(customer.id);
    } else {
      const { data, error } = await supabase.rpc("create_customer", args);
      setBusy(false);
      if (error) return setError(error.message);
      onSaved(data as string);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="full_name" required defaultValue={customer?.full_name} className={inputClass} />
        </Field>
        <Field label="Phone">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <Field label="WhatsApp (only if different)">
          <PhoneInput value={whatsapp} onChange={setWhatsapp} />
        </Field>
        <Field label="Emirates ID (optional)">
          <input name="emirates_id" defaultValue={customer?.emirates_id ?? ""} placeholder="784-1990-1234567-1" inputMode="numeric" className={`${inputClass} font-mono`} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address">
            <input name="address" defaultValue={customer?.address ?? ""} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Geo location (optional)">
            <input value={geoText} onChange={(e) => setGeoText(e.target.value)} placeholder="Coordinates or a Google Maps link" className={inputClass} />
          </Field>
        </div>
      </div>
      <ErrorMessage message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : customer ? "Save changes" : "Create customer"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
