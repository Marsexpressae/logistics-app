"use client";

import { useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import PhoneInput from "@/components/ui/PhoneInput";
import { Button, ErrorMessage } from "@/components/ui/form";
import { formatPhone, parsePhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import ContactButtons from "./ContactButtons";

type ContactCardProps = {
  bookingId: string;
  party: "sender" | "receiver";
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  onChanged: () => void;
};

/**
 * A person's numbers with Call / WhatsApp buttons, and a small Edit for the pickup team and the office.
 * Shows the WhatsApp number separately only when it differs from the call number.
 */
export default function ContactCard({ bookingId, party, name, phone, whatsapp, onChanged }: ContactCardProps) {
  const { can } = usePermissions();
  const canEdit = can("bookings.edit") || can("pickups.edit_contact");

  const [editing, setEditing] = useState(false);
  const [callText, setCallText] = useState("");
  const [sameWa, setSameWa] = useState(true);
  const [waText, setWaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  function startEditing() {
    setCallText(formatPhone(phone));
    setSameWa(!whatsapp);
    setWaText(formatPhone(whatsapp));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const call = parsePhone(callText);
    if (callText.trim() && !call) return setError("The call number is not valid.");
    if (party === "sender" && !call) return setError("Please enter the call number.");
    const wa = sameWa ? null : parsePhone(waText);
    if (!sameWa && !wa) return setError("The WhatsApp number is not valid.");

    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("update_contact", {
      p_booking_id: bookingId,
      p_party: party,
      p_phone: call?.e164 ?? null,
      p_whatsapp: wa?.e164 ?? null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
    onChanged();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatPhone(phone));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  }

  if (editing) {
    return (
      <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Call number</span>
          <PhoneInput value={callText} onChange={setCallText} ariaLabel="Call number" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={sameWa} onChange={(e) => setSameWa(e.target.checked)} className="h-4 w-4" />
          WhatsApp is the same number
        </label>
        {!sameWa && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">WhatsApp number</span>
            <PhoneInput value={waText} onChange={setWaText} ariaLabel="WhatsApp number" />
          </label>
        )}
        <ErrorMessage message={error} />
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!phone && !canEdit) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {phone ? (
          <span className="font-medium text-slate-900">{formatPhone(phone)}</span>
        ) : (
          <span className="text-slate-500">No number yet</span>
        )}
        {whatsapp && <span className="text-slate-600">WhatsApp: {formatPhone(whatsapp)}</span>}
        {phone && (
          <button onClick={copy} className="hidden items-center gap-1 text-xs text-slate-500 hover:text-slate-800 md:inline-flex" aria-label="Copy number">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {canEdit && (
          <button onClick={startEditing} className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-brand-700" aria-label={`Edit ${party === "sender" ? "customer" : party} numbers`}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>
      <ContactButtons phone={phone} whatsapp={whatsapp} name={name ?? undefined} className="mt-2" />
    </div>
  );
}
