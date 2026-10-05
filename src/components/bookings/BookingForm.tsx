"use client";

import { useState, type FormEvent } from "react";
import { LocateFixed } from "lucide-react";
import CustomerPicker from "@/components/customers/CustomerPicker";
import PhoneInput from "@/components/ui/PhoneInput";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import type { CustomerHit, ReceiverEntry } from "@/lib/customers";
import { AREAS } from "@/config/areas";
import { formatGeo, mapsUrl, parseGeo } from "@/lib/geo";
import { todayISO } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { formatPhone, parsePhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Booking, Driver } from "@/lib/types";

type BookingFormProps = {
  booking?: Booking; // present = edit mode
  submitLabel: string;
  onSaved: (code: string) => void;
};

export default function BookingForm({ booking, submitLabel, onSaved }: BookingFormProps) {
  const { can } = usePermissions();
  const canSetNumbers = can("numbers.edit");
  const canPickCustomer = !booking && can("customers.view");
  // A returning customer picked from the list: their details fill the form, and the booking is linked to them when saved.
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  // The picked customer's address book, and the receiver chosen from it.
  const [book, setBook] = useState<ReceiverEntry[]>([]);
  const [receiverPick, setReceiverPick] = useState<ReceiverEntry | null>(null);
  const [receiverName, setReceiverName] = useState({ value: booking?.receiver_name ?? "", n: 0 });
  const [fill, setFill] = useState({ name: booking?.sender_name ?? "", address: booking?.pickup_address ?? "", n: 0 });
  const drivers = useQuery<Driver[]>(() =>
    supabase.from("drivers").select("*").eq("active", true).order("name")
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [geoText, setGeoText] = useState(booking ? formatGeo(booking.geo_lat, booking.geo_lng) : "");
  const [locating, setLocating] = useState(false);
  // Sender numbers: a call number, and a WhatsApp number only when it is a different one.
  const [senderPhone, setSenderPhone] = useState(formatPhone(booking?.sender_phone));
  const [sameWhatsapp, setSameWhatsapp] = useState(!booking?.sender_whatsapp);
  const [whatsappPhone, setWhatsappPhone] = useState(formatPhone(booking?.sender_whatsapp));

  async function pickCustomer(c: CustomerHit) {
    setPicked(c);
    setReceiverPick(null);
    const { data } = await supabase.rpc("customer_receivers_of", { p_sender: c.id });
    setBook((data as ReceiverEntry[] | null) ?? []);
    setFill((f) => ({ name: c.full_name, address: c.address ?? f.address, n: f.n + 1 }));
    setSenderPhone(formatPhone(c.phone));
    setSameWhatsapp(!c.whatsapp);
    setWhatsappPhone(formatPhone(c.whatsapp));
    if (c.geo_lat != null && c.geo_lng != null) setGeoText(formatGeo(c.geo_lat, c.geo_lng));
  }

  const geo = parseGeo(geoText);
  const geoInvalid = geoText.trim() !== "" && !geo;

  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser cannot share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoText(formatGeo(pos.coords.latitude, pos.coords.longitude));
        setLocating(false);
      },
      () => {
        setError("Could not get your location. Allow location access, or paste coordinates instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Typed numbers. On a new booking, anything typed is sent. On an existing one, only what changed.
  function customNumbers(f: FormData) {
    const typed = (k: string) => String(f.get(k) ?? "").trim().toUpperCase();
    const code = typed("booking_number");
    const invoice = typed("invoice_number");
    const out: { code?: string; invoice_no?: string } = {};
    if (code && code !== booking?.code) out.code = code;
    if (invoice && invoice !== (booking?.invoice_no ?? "")) out.invoice_no = invoice;
    return out;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || null;

    if (geoInvalid) {
      return setError("Geo location: paste coordinates like 25.2048, 55.2708 or a full Google Maps link.");
    }

    const call = parsePhone(senderPhone);
    if (!call) return setError("Please enter a valid sender phone number, e.g. 050 123 4567.");
    const whatsapp = sameWhatsapp ? null : parsePhone(whatsappPhone);
    if (!sameWhatsapp && !whatsapp) return setError("The WhatsApp number is not valid.");

    const fields = {
      sender_name: text("sender_name"),
      sender_phone: call.e164,
      sender_whatsapp: whatsapp && whatsapp.e164 !== call.e164 ? whatsapp.e164 : null,
      // Receiver: only the name at booking time. Phone and address are added later with the invoice/shipment details.
      receiver_name: text("receiver_name"),
      // From the address book: the invoice keeps its own copy of the receiver's phone and address.
      ...(receiverPick && !booking && text("receiver_name") === receiverPick.name ? { receiver_phone: receiverPick.phone, receiver_address: receiverPick.address } : {}),
      pickup_area: text("pickup_area"),
      pickup_address: text("pickup_address"),
      // When editing, the date can only change through Reschedule (reason + notification), so it is not sent.
      ...(booking ? {} : { pickup_date: text("pickup_date") }),
      geo_lat: geo?.lat ?? null,
      geo_lng: geo?.lng ?? null,
      driver_id: text("driver_id"),
      estimated_bill: f.get("estimated_bill") ? Number(f.get("estimated_bill")) : null,
      // Only editable after the booking exists (set once the invoice is raised).
      ...(booking ? { invoice_amount: f.get("invoice_amount") ? Number(f.get("invoice_amount")) : null } : {}),
      notes: text("notes"),
      // Custom numbers: only people with the permission see these fields. Empty = automatic.
      ...(canSetNumbers ? customNumbers(f) : {}),
    };

    setBusy(true);
    setError(null);
    setConflict(false);
    // New bookings get their code (BK-1001, ...) from the database.
    const { data, error } = booking
      ? // Only saves if nobody changed the booking since it was opened (version stamp must still match).
        await supabase
          .from("bookings")
          .update(fields)
          .eq("id", booking.id)
          .eq("updated_at", booking.updated_at)
          .select("id, code")
          .single()
      : await supabase.from("bookings").insert(fields).select("id, code").single();
    setBusy(false);
    if (error) {
      // A number that is already used by another booking
      if (error.code === "23505") {
        return setError(
          error.message.includes("invoice_no") ? "That invoice number is already used by another booking." : "That booking number is already used by another booking."
        );
      }
      // PGRST116 = the update matched no row: someone saved first (or the booking was removed).
      if (booking && error.code === "PGRST116") return setConflict(true);
      return setError(error.message);
    }
    // Link the picked customer. If this fails the booking still exists; the customer can be linked from the booking page.
    if (!booking && picked) {
      await supabase.rpc("link_booking_customer", { p_booking_id: data.id, p_customer_id: picked.id, p_role: "customer" });
      if (receiverPick && f.get("receiver_name") === receiverPick.name) {
        await supabase.rpc("link_booking_customer", { p_booking_id: data.id, p_customer_id: receiverPick.receiver_id, p_role: "receiver" });
      }
    }
    onSaved(data.code);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      {/* 1. Who is sending, and everything about collecting from them */}
      <Card title="Sender &amp; pickup">
        <div className="grid gap-4 sm:grid-cols-2">
          {canPickCustomer && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              {picked ? (
                <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    Returning customer: <strong>{picked.full_name}</strong> ({picked.invoices} {picked.invoices === 1 ? "invoice" : "invoices"})
                  </span>
                  <button type="button" onClick={() => setPicked(null)} className="font-medium text-blue-700">
                    Not this customer
                  </button>
                </p>
              ) : (
                <>
                  <p className="mb-2 text-sm font-medium text-slate-700">Returning customer? Find them and the details fill in.</p>
                  <CustomerPicker onPick={pickCustomer} />
                </>
              )}
            </div>
          )}
          <Field label="Name">
            <input key={`n${fill.n}`} name="sender_name" required defaultValue={fill.name} className={inputClass} />
          </Field>
          <Field label="Phone">
            <PhoneInput value={senderPhone} onChange={setSenderPhone} required />
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sameWhatsapp}
                onChange={(e) => setSameWhatsapp(e.target.checked)}
                className="h-4 w-4"
              />
              WhatsApp is the same number
            </label>
            {!sameWhatsapp && (
              <div className="mt-3 max-w-sm">
                <Field label="WhatsApp number">
                  <PhoneInput value={whatsappPhone} onChange={setWhatsappPhone} />
                </Field>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4 sm:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900">Pickup</h3>
            <p className="text-xs text-slate-500">Where, when and by whom the sender&apos;s cargo is collected.</p>
          </div>
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
          <Field label="Pickup date">
            <input
              name="pickup_date"
              type="date"
              required
              readOnly={!!booking}
              defaultValue={booking?.pickup_date ?? todayISO()}
              className={`${inputClass} ${booking ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
            />
            {booking && (
              <span className="mt-1 block text-xs text-slate-500">
                To move the pickup, use <strong>Reschedule</strong> above. A reason is required and the other team is told.
              </span>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Pickup address">
              <textarea key={`a${fill.n}`} name="pickup_address" required rows={2} defaultValue={fill.address} className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Geo location (optional)">
              <div className="flex gap-2">
                <input
                  value={geoText}
                  onChange={(e) => setGeoText(e.target.value)}
                  placeholder="25.2048, 55.2708 or a Google Maps link"
                  className={`${inputClass} font-mono`}
                />
                <Button type="button" variant="secondary" onClick={useMyLocation} disabled={locating} className="shrink-0">
                  <LocateFixed className="h-4 w-4" />
                  <span className="hidden sm:inline">{locating ? "Locating…" : "Use my location"}</span>
                </Button>
              </div>
            </Field>
            {geoInvalid && (
              <p className="mt-1 text-xs text-red-600">
                Could not read coordinates. Short links (maps.app.goo.gl) do not contain them. Open the link, then copy the
                full address or coordinates.
              </p>
            )}
            {geo && (
              <a
                href={mapsUrl({ geo_lat: geo.lat, geo_lng: geo.lng, pickup_address: "" })}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-blue-700"
              >
                Check pin on map ({formatGeo(geo.lat, geo.lng)})
              </a>
            )}
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
        </div>
      </Card>

      {/* 2. Where it is going (optional, can be filled in later) */}
      <Card title="Receiver (optional)">
        <div className="max-w-sm">
          <Field label="Name">
            <input key={`r${receiverName.n}`} name="receiver_name" defaultValue={receiverName.value} className={inputClass} />
          </Field>
        </div>
        {picked && book.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-slate-600">{picked.full_name}&apos;s receivers. Tap one to fill the name, phone and address.</p>
            <div className="flex flex-wrap gap-2">
              {book.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setReceiverPick(r);
                    setReceiverName((x) => ({ value: r.name, n: x.n + 1 }));
                  }}
                  className={`rounded-md border px-3 py-1.5 text-left text-sm ${receiverPick?.id === r.id ? "border-blue-600 bg-blue-50" : "border-slate-300 bg-white"}`}
                >
                  <span className="font-medium">{r.name}</span>
                  {r.address && <span className="block max-w-56 truncate text-xs text-slate-500">{r.address}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Phone and address are added later with the invoice and shipment details.</p>
      </Card>

      {/* Custom numbers, like in an accounting system. Leave empty for automatic numbers. */}
      {canSetNumbers && (
        <Card title="Numbers">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Booking number">
              <input
                name="booking_number"
                defaultValue={booking?.code ?? ""}
                placeholder="Automatic"
                className={`${inputClass} font-mono`}
                autoCapitalize="characters"
              />
            </Field>
            <Field label="Invoice number">
              <input
                name="invoice_number"
                defaultValue={booking?.invoice_no ?? ""}
                placeholder={booking ? "Automatic when collected" : "Automatic when collected, or type one"}
                className={`${inputClass} font-mono`}
                autoCapitalize="characters"
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Leave empty for automatic numbers. A typed number must be unique. The booking number cannot change once parcels exist,
            and an invoice number can be changed but not removed.
          </p>
        </Card>
      )}

      {/* 3. Money and anything else worth noting */}
      <Card title="Billing &amp; notes">
        <div className="grid gap-4 sm:grid-cols-2">
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
      {conflict && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Someone else changed this booking while you were editing.</p>
          <p>Your changes were not saved, so nothing was overwritten. Reload to see the latest version, then re-apply your edits.</p>
          <button type="button" className="mt-1 font-medium underline" onClick={() => window.location.reload()}>
            Reload now
          </button>
        </div>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
