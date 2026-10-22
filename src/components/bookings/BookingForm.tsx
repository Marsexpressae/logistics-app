"use client";

import { useState, type FormEvent } from "react";
import { celebrate } from "@/lib/celebrate";
import { invoiceJustRaised } from "@/lib/celebrations";
import { Button, Card, ErrorMessage } from "@/components/ui/form";
import type { CustomerHit, ReceiverEntry } from "@/lib/customers";
import { formatGeo, parseGeo } from "@/lib/geo";
import { useQuery } from "@/lib/hooks";
import { formatPhone, parsePhone } from "@/lib/phone";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";
import SalesRepSelect, { useSalesRepChoices } from "@/components/people/SalesRepSelect";
import { supabase } from "@/lib/supabase";
import type { Booking, Driver } from "@/lib/types";
import BillingCard from "./form/BillingCard";
import CustomerFields from "./form/CustomerFields";
import NumbersCard from "./form/NumbersCard";
import PickupSection from "./form/PickupSection";
import ReceiverCard from "./form/ReceiverCard";
import { useBookingNumbers } from "./form/useBookingNumbers";

type BookingFormProps = {
  booking?: Booking; // present = edit mode
  submitLabel: string;
  numbersOpen?: boolean; // editing: the numbers show on top of the page and only open here when asked
  onSaved: (code: string) => void;
};

/**
 * Creates a booking, or edits one. The cards live in ./form; this component holds what they share (the sender, the picked
 * customer, the location) and does the saving.
 */
export default function BookingForm({ booking, submitLabel, onSaved, numbersOpen }: BookingFormProps) {
  const { can } = usePermissions();
  const me = useCurrentProfile();
  const canSetNumbers = can("numbers.edit");
  const showNumbers = canSetNumbers && (!booking || !!numbersOpen);
  const numbers = useBookingNumbers(booking, showNumbers);
  const canPickCustomer = !booking && can("customers.view");

  // A returning customer picked from the list: their details fill the form, and the booking is linked to them when saved.
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  // The sales rep: until someone chooses, it is the picked customer's owner, or else the person making the booking.
  const [chosenRep, setChosenRep] = useState<string | null | undefined>(undefined);
  const repChoices = useSalesRepChoices();
  // an owner who has left (no longer in the list) is not preselected: the booking could not be saved with them
  const ownerStillStaff = !!picked?.sales_rep_id && !!repChoices.data?.some((p) => p.id === picked.sales_rep_id);
  const salesRepId = chosenRep !== undefined ? chosenRep : ownerStillStaff ? (picked?.sales_rep_id ?? me.id) : me.id;
  // Editing: the booking already belongs to a customer. Their name and numbers are changed on the customer page, not here.
  const linkedCustomer = useQuery<{ customer_id: string } | null>(
    () => (booking && can("customers.view") ? (supabase.from("booking_contacts").select("customer_id").eq("booking_id", booking.id).eq("role", "customer").maybeSingle() as never) : Promise.resolve({ data: null, error: null })),
    [booking?.id]
  );
  // The picked customer's address book, and the receiver chosen from it.
  const [book, setBook] = useState<ReceiverEntry[]>([]);
  const [receiverPick, setReceiverPick] = useState<ReceiverEntry | null>(null);
  const [receiverName, setReceiverName] = useState({ value: booking?.receiver_name ?? "", n: 0 });
  const [address, setAddress] = useState({ value: booking?.pickup_address ?? "", n: 0 });
  // Sender numbers: a call number, and a WhatsApp number only when it is a different one.
  const [sender, setSender] = useState({
    name: { value: booking?.sender_name ?? "", n: 0 },
    phone: formatPhone(booking?.sender_phone),
    sameWhatsapp: !booking?.sender_whatsapp,
    whatsapp: formatPhone(booking?.sender_whatsapp),
  });
  const [geoText, setGeoText] = useState(booking ? formatGeo(booking.geo_lat, booking.geo_lng) : "");
  const drivers = useQuery<Driver[]>(() => supabase.from("drivers").select("*").eq("active", true).order("name"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  async function pickCustomer(c: CustomerHit) {
    setPicked(c);
    setReceiverPick(null);
    const { data } = await supabase.rpc("customer_receivers_of", { p_sender: c.id });
    setBook((data as ReceiverEntry[] | null) ?? []);
    setSender((s) => ({ name: { value: c.full_name, n: s.name.n + 1 }, phone: formatPhone(c.phone), sameWhatsapp: !c.whatsapp, whatsapp: formatPhone(c.whatsapp) }));
    setAddress((a) => ({ value: c.address ?? a.value, n: a.n + 1 }));
    if (c.geo_lat != null && c.geo_lng != null) setGeoText(formatGeo(c.geo_lat, c.geo_lng));
  }

  // A known customer: their details are shown, not typed again, so the booking can never disagree with the customer record.
  const locked = !!picked || !!linkedCustomer.data;
  // An existing booking with a customer: the Customer card above shows them, so this form only holds the pickup.
  const onlyPickup = !!booking && !!linkedCustomer.data;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || null;

    const geo = parseGeo(geoText);
    if (geoText.trim() !== "" && !geo) {
      return setError("Geo location: paste coordinates like 25.2048, 55.2708 or a full Google Maps link.");
    }

    const call = parsePhone(sender.phone);
    if (!call) return setError("Please enter a valid customer phone number, e.g. 050 123 4567.");
    const whatsapp = sender.sameWhatsapp ? null : parsePhone(sender.whatsapp);
    if (!sender.sameWhatsapp && !whatsapp) return setError("The WhatsApp number is not valid.");

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
      // Who made this sale (a new booking only; changing it later needs the permission and is done on the booking page).
      ...(booking ? {} : { sales_rep_id: salesRepId }),
      estimated_bill: f.get("estimated_bill") ? Number(f.get("estimated_bill")) : null,
      // Only editable after the booking exists (set once the invoice is raised).
      ...(booking ? { invoice_amount: f.get("invoice_amount") ? Number(f.get("invoice_amount")) : null } : {}),
      notes: text("notes"),
      // Custom numbers: only people with the permission see these fields. Empty = automatic.
      ...(canSetNumbers ? numbers.typed() : {}),
    };

    // The numbers card already says so under the box; stop here instead of sending a booking the database will refuse.
    const taken = canSetNumbers && (numbers.bookingTaken || numbers.invoiceTaken);
    if (taken) return setError(taken);

    setBusy(true);
    setError(null);
    setConflict(false);
    // New bookings get their code (BK-1001, ...) from the database.
    const { data, error } = booking
      ? // Only saves if nobody changed the booking since it was opened (version stamp must still match).
        await supabase.from("bookings").update(fields).eq("id", booking.id).eq("updated_at", booking.updated_at).select("id, code").single()
      : await supabase.from("bookings").insert(fields).select("id, code").single();
    setBusy(false);
    if (error) {
      // A number that is already used by another booking
      if (error.code === "23505") {
        return setError(error.message.includes("invoice_no") ? "That invoice number is already used by another booking." : "That booking number is already used by another booking.");
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
    // The work saved: a new booking celebrates, and so does the first time an invoice amount is entered (never on an error above).
    if (!booking) celebrate("booking_created", data.code);
    else if (invoiceJustRaised(booking.invoice_amount, (fields as { invoice_amount?: number | null }).invoice_amount)) celebrate("invoice_raised");
    onSaved(data.code);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      {showNumbers && <NumbersCard booking={booking} numbers={numbers} />}

      {/* 1. Who is sending, and everything about collecting from them */}
      <Card title={onlyPickup ? "Pickup" : "Customer & pickup"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomerFields
            onlyPickup={onlyPickup}
            canPickCustomer={canPickCustomer}
            picked={picked}
            onPick={pickCustomer}
            onClearPicked={() => setPicked(null)}
            locked={locked}
            sender={sender}
            onPhone={(phone) => setSender((s) => ({ ...s, phone }))}
            onSameWhatsapp={(sameWhatsapp) => setSender((s) => ({ ...s, sameWhatsapp }))}
            onWhatsapp={(whatsapp) => setSender((s) => ({ ...s, whatsapp }))}
          />
          <PickupSection booking={booking} onlyPickup={onlyPickup} address={address} geoText={geoText} onGeoText={setGeoText} drivers={drivers.data} onError={setError} />
        </div>
      </Card>

      {/* The sales rep: the customer's owner if one was picked, otherwise the person making the booking. */}
      {!booking && !onlyPickup && (
        <Card title="Sales rep">
          <SalesRepSelect value={salesRepId} onChange={setChosenRep} />
          <p className="mt-2 text-sm text-slate-500">The staff member who owns this customer. A returning customer&apos;s owner is filled in for you.</p>
        </Card>
      )}

      {/* 2. Where it is going (optional, can be filled in later) */}
      <ReceiverCard
        receiverName={receiverName}
        picked={picked}
        book={book}
        receiverPick={receiverPick}
        onPickReceiver={(r) => {
          setReceiverPick(r);
          setReceiverName((x) => ({ value: r.name, n: x.n + 1 }));
        }}
      />

      {/* 3. Money and anything else worth noting */}
      <BillingCard booking={booking} />

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
