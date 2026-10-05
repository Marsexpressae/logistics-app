"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import ContactButtons from "@/components/contact/ContactButtons";
import CustomerPicker from "@/components/customers/CustomerPicker";
import { Button, Card, ErrorMessage } from "@/components/ui/form";
import { ROLE_LABEL, type ContactRole, type Customer } from "@/lib/customers";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type Linked = { role: ContactRole; customer: Pick<Customer, "id" | "full_name" | "phone" | "whatsapp" | "address"> | null };

/**
 * The people on a booking: the customer (who pays and signs), "booked by" if somebody else phoned it in, and the receiver.
 * Staff find an existing customer by mobile, name, Emirates ID or an old invoice number, or create one from what the
 * Every booking has a customer from the start. The invoice keeps its own copy of their details once collected.
 */
export default function CustomerCard({ bookingId }: { bookingId: string }) {
  const { can } = usePermissions();
  const canView = can("customers.view");
  const canEdit = can("customers.edit");
  const links = useQuery<Linked[]>(
    () => (canView ? (supabase.from("booking_contacts").select("role, customer:customers(id, full_name, phone, whatsapp, address)").eq("booking_id", bookingId) as never) : Promise.resolve({ data: [], error: null })),
    [bookingId, canView]
  );
  const booking = useQuery<{ receiver_name: string | null } | null>(
    () => supabase.from("bookings").select("receiver_name").eq("id", bookingId).maybeSingle() as never,
    [bookingId]
  );
  const [picking, setPicking] = useState<ContactRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canView) return null;

  const rows = links.data ?? [];
  const get = (role: ContactRole) => rows.find((r) => r.role === role)?.customer ?? null;
  const customer = get("customer");
  const booker = get("booker");
  const receiver = get("receiver");

  async function run(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action;
    setBusy(false);
    if (error) return setError(error.message);
    setPicking(null);
    links.reload();
  }

  const link = (role: ContactRole, id: string | null) => run(supabase.rpc("link_booking_customer", { p_booking_id: bookingId, p_customer_id: id, p_role: role }));
  const saveReceiver = () => run(supabase.rpc("save_booking_receiver", { p_booking_id: bookingId }));

  const person = (role: ContactRole, c: NonNullable<Linked["customer"]>) => (
    <li key={role} className="flex items-start justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase text-slate-500">{ROLE_LABEL[role]}</span>
        <Link href={`/customers/${c.id}`} className="block font-medium text-blue-700">
          {c.full_name}
        </Link>
        <span className="block text-sm text-slate-600">{formatPhone(c.phone)}</span>
        {c.address && <span className="block truncate text-xs text-slate-500">{c.address}</span>}
        <ContactButtons phone={c.phone} whatsapp={c.whatsapp} name={c.full_name} compact className="mt-2" />
      </span>
      {canEdit && (
        <button aria-label={`Unlink ${c.full_name}`} disabled={busy} onClick={() => link(role, null)} className="p-1 text-slate-400 hover:text-red-600">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );

  return (
    <Card title="Customer">
      <ErrorMessage message={links.error ?? error} />
      {links.loading && !links.data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {customer && person("customer", customer)}
            {booker && person("booker", booker)}
            {receiver && person("receiver", receiver)}
          </ul>
          {canEdit && picking === null && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {customer && !receiver && booking.data?.receiver_name && (
                <Button variant="secondary" onClick={saveReceiver} disabled={busy}>
                  Save receiver to address book
                </Button>
              )}
              {!booker && (
                <Button variant="secondary" onClick={() => setPicking("booker")}>
                  Add &quot;booked by&quot;
                </Button>
              )}
              {!receiver && (
                <Button variant="secondary" onClick={() => setPicking("receiver")}>
                  Link a receiver
                </Button>
              )}
              <button type="button" onClick={() => setPicking("customer")} className="text-xs font-medium text-slate-500 underline">
                Wrong customer? Change
              </button>
            </div>
          )}

          {picking && (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">
                {picking === "booker" ? "Who phoned the booking in?" : picking === "receiver" ? "Find the receiver" : "Find the right customer. The booking will use their details."}
              </p>
              <CustomerPicker autoFocus onPick={(h) => link(picking, h.id)} />
              <Button variant="secondary" className="mt-2" onClick={() => setPicking(null)}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
