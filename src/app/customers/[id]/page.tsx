"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MapPin } from "lucide-react";
import ContactButtons from "@/components/contact/ContactButtons";
import CustomerForm from "@/components/customers/CustomerForm";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { customerMapsUrl, ROLE_LABEL, type ContactRole, type Customer, type TimelineRow } from "@/lib/customers";
import { formatDate, formatDay } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type LinkedBooking = {
  role: ContactRole;
  booking: { id: string; code: string; invoice_no: string | null; status: string; pickup_date: string } | null;
};

const KIND_LABEL: Record<TimelineRow["r_kind"], string> = {
  booking: "Booking",
  event: "Job",
  package: "Package",
  payment: "Payment",
  item: "Items",
  invoice: "Invoice",
  note: "Note",
  link: "Link",
  customer: "Customer",
};

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const canEdit = can("customers.edit");
  const canNote = can("notes.write");

  const customer = useQuery<Customer | null>(() => supabase.from("customers").select("*").eq("id", id).maybeSingle() as never, [id]);
  const linked = useQuery<LinkedBooking[]>(
    () => supabase.from("booking_contacts").select("role, booking:bookings(id, code, invoice_no, status, pickup_date)").eq("customer_id", id) as never,
    [id]
  );
  const timeline = useQuery<TimelineRow[]>(() => supabase.rpc("customer_timeline", { p_customer_id: id, p_limit: 100, p_offset: 0 }) as never, [id]);

  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = customer.data;

  async function addNote(e: FormEvent) {
    e.preventDefault();
    const body = note.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("customer_notes").insert({ customer_id: id, body });
    setBusy(false);
    if (error) return setError(error.message);
    setNote("");
    timeline.reload();
  }

  if (customer.loading && !c) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!c) return <p className="text-sm text-slate-600">{customer.error ?? "This customer was not found, or you may not open it."}</p>;

  const maps = customerMapsUrl(c);
  const bookings = (linked.data ?? []).filter((l) => l.booking);

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/customers" className="text-sm text-blue-700">
        ← All customers
      </Link>
      <PageHeader title={c.full_name} description={`Customer since ${formatDay(c.created_at.slice(0, 10))}${c.created_by_name ? ` · added by ${c.created_by_name}` : ""}`} />

      <Card title="Details">
        {canEdit && !editing && (
          <div className="mb-3">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          </div>
        )}
        {editing ? (
          <CustomerForm
            customer={c}
            onSaved={() => {
              setEditing(false);
              customer.reload();
              timeline.reload();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-slate-500">Phone</dt>
              <dd>{formatPhone(c.phone) || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">WhatsApp</dt>
              <dd>{c.whatsapp ? formatPhone(c.whatsapp) : c.phone ? "Same as phone" : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Emirates ID</dt>
              <dd className="font-mono">{c.emirates_id ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Address</dt>
              <dd>{c.address ?? "—"}</dd>
            </div>
            {(c.phone || c.whatsapp) && (
              <div className="sm:col-span-2">
                <ContactButtons phone={c.phone} whatsapp={c.whatsapp} name={c.full_name} />
              </div>
            )}
            {maps && (
              <div className="sm:col-span-2">
                <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-700">
                  <MapPin className="h-4 w-4" /> Open in Google Maps
                </a>
              </div>
            )}
          </dl>
        )}
      </Card>

      <Card title={`Invoices (${bookings.length})`}>
        {linked.loading && !linked.data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !bookings.length ? (
          <p className="text-sm text-slate-500">No invoices linked yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {bookings.map(({ role, booking: b }) => (
              <li key={`${b!.id}-${role}`} className="flex items-center justify-between gap-3 py-3">
                <span>
                  {can("bookings.view") ? (
                    <Link href={`/bookings/${b!.id}`} className="font-mono font-medium text-blue-700">
                      {b!.invoice_no ?? b!.code}
                    </Link>
                  ) : (
                    <span className="font-mono font-medium">{b!.invoice_no ?? b!.code}</span>
                  )}
                  {b!.invoice_no && <span className="ml-2 font-mono text-xs text-slate-500">{b!.code}</span>}
                  <span className="block text-xs text-slate-500">
                    {ROLE_LABEL[role]} · {formatDay(b!.pickup_date)}
                  </span>
                </span>
                <StatusBadge status={b!.status} />
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage message={linked.error} />
      </Card>

      <Card title="History">
        {canNote && (
          <form onSubmit={addNote} className="mb-4 space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Add a note about this customer, for example how they like to be contacted."
              aria-label="New customer note"
              className={inputClass}
            />
            <ErrorMessage message={error} />
            <Button type="submit" disabled={busy || !note.trim()}>
              {busy ? "Adding…" : "Add note"}
            </Button>
          </form>
        )}
        {timeline.loading && !timeline.data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !timeline.data?.length ? (
          <p className="text-sm text-slate-500">Nothing has happened yet.</p>
        ) : (
          <ol className="divide-y divide-slate-100 text-sm">
            {timeline.data.map((t, i) => (
              <li key={i} className="py-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{KIND_LABEL[t.r_kind] ?? t.r_kind}</span>
                  <span className="font-medium text-slate-900">{t.r_title}</span>
                  {t.r_invoice && (
                    <span className="font-mono text-xs text-slate-500">
                      {t.r_booking_id && can("bookings.view") ? (
                        <Link href={`/bookings/${t.r_booking_id}`} className="text-blue-700">
                          {t.r_invoice}
                        </Link>
                      ) : (
                        t.r_invoice
                      )}
                    </span>
                  )}
                </p>
                {t.r_detail && <p className="mt-1 whitespace-pre-wrap text-slate-700">{t.r_detail}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(t.r_at)}
                  {t.r_actor ? ` · ${t.r_actor}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
        <ErrorMessage message={timeline.error} />
      </Card>
    </div>
  );
}
