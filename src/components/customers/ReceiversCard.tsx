"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import ContactButtons from "@/components/contact/ContactButtons";
import CustomerPicker from "@/components/customers/CustomerPicker";
import PhoneInput from "@/components/ui/PhoneInput";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import type { ReceiverEntry } from "@/lib/customers";
import { useQuery } from "@/lib/hooks";
import { formatPhone, parsePhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

/**
 * The people this customer sends to, each with the address they use. A new invoice picks from this list,
 * so the receiver is never typed twice. A receiver is a person record too: if they send cargo one day, it is the same person.
 */
export default function ReceiversCard({ customerId }: { customerId: string }) {
  const { can } = usePermissions();
  const canEdit = can("customers.edit");
  const list = useQuery<ReceiverEntry[]>(() => supabase.rpc("customer_receivers_of", { p_sender: customerId }) as never, [customerId]);
  const [adding, setAdding] = useState<"new" | "find" | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(args: { name: string | null; phone: string | null; address: string | null; receiverId: string | null }) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("add_receiver", { p_sender: customerId, p_name: args.name, p_phone: args.phone, p_address: args.address, p_receiver_id: args.receiverId });
    setBusy(false);
    if (error) return setError(error.message);
    setAdding(null);
    setPhone("");
    list.reload();
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = phone.trim() ? parsePhone(phone) : null;
    if (phone.trim() && !parsed) return setError("Please enter a valid phone number, e.g. 050 123 4567.");
    add({ name: String(f.get("name") ?? ""), phone: parsed?.e164 ?? null, address: String(f.get("address") ?? "") || null, receiverId: null });
  }

  async function remove(id: string) {
    const { error } = await supabase.rpc("remove_receiver", { p_id: id });
    if (error) return setError(error.message);
    list.reload();
  }

  return (
    <Card title="Receivers (address book)">
      {list.loading && !list.data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !list.data?.length ? (
        <p className="text-sm text-slate-500">No receivers saved yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.data.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-3">
              <span className="min-w-0">
                <Link href={`/customers/${r.receiver_id}`} className="font-medium text-blue-700">
                  {r.name}
                </Link>
                {r.phone && <span className="ml-2 text-slate-600">{formatPhone(r.phone)}</span>}
                {r.address && <span className="block text-xs text-slate-500">{r.address}</span>}
                <ContactButtons phone={r.phone} whatsapp={r.whatsapp} name={r.name} compact className="mt-2" />
              </span>
              {canEdit && (
                <button aria-label={`Remove ${r.name}`} onClick={() => remove(r.id)} className="p-1 text-slate-400 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage message={error ?? list.error} />

      {canEdit && !adding && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding("new")}>
            Add a receiver
          </Button>
          <Button variant="secondary" onClick={() => setAdding("find")}>
            Find an existing person
          </Button>
        </div>
      )}
      {adding === "find" && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <CustomerPicker autoFocus onPick={(h) => add({ name: null, phone: null, address: h.address, receiverId: h.id })} />
          <Button variant="secondary" className="mt-2" onClick={() => setAdding(null)}>
            Cancel
          </Button>
        </div>
      )}
      {adding === "new" && (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <Field label="Name">
            <input name="name" required className={inputClass} />
          </Field>
          <Field label="Phone">
            <PhoneInput value={phone} onChange={setPhone} />
          </Field>
          <Field label="Address">
            <input name="address" className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Add receiver
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
