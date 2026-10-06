"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FileText, MapPin, TriangleAlert } from "lucide-react";
import ContactButtons from "@/components/contact/ContactButtons";
import CustomerForm from "@/components/customers/CustomerForm";
import { IdPhoto } from "@/components/customers/IdCard";
import ReceiversCard from "@/components/customers/ReceiversCard";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, StatusBadge, inputClass, Loading } from "@/components/ui/form";
import { customerMapsUrl, ROLE_LABEL, type ContactRole, type Customer, type IdDocument, type TimelineRow } from "@/lib/customers";
import { formatDate, formatDay } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { confirmAction } from "@/lib/ask";
import BackLink from "@/components/ui/BackLink";
import { textLink } from "@/components/ui/links";

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
  const router = useRouter();
  const { can } = usePermissions();
  const canEdit = can("customers.edit");
  const canNote = can("notes.write");

  const customer = useQuery<Customer | null>(() => supabase.from("customers").select("*").eq("id", id).maybeSingle() as never, [id]);
  const linked = useQuery<LinkedBooking[]>(
    () => supabase.from("booking_contacts").select("role, booking:bookings(id, code, invoice_no, status, pickup_date)").eq("customer_id", id) as never,
    [id]
  );
  const timeline = useQuery<TimelineRow[]>(() => supabase.rpc("customer_timeline", { p_customer_id: id, p_limit: 100, p_offset: 0 }) as never, [id]);

  const bookingIds = (linked.data ?? []).flatMap((l) => (l.booking ? [l.booking.id] : []));
  const ids = useQuery<IdDocument[]>(
    () =>
      can("customers.id_photo") && bookingIds.length
        ? (supabase.from("id_documents").select("*").in("booking_id", bookingIds).order("created_at", { ascending: false }) as never)
        : Promise.resolve({ data: [], error: null }),
    [bookingIds.join(","), can("customers.id_photo")]
  );

  const [editing, setEditing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null); // null = not editing
  const [warnError, setWarnError] = useState<string | null>(null);
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

  async function saveWarning() {
    setWarnError(null);
    const { error } = await supabase.rpc("set_customer_warning", { p_id: id, p_note: warning });
    if (error) return setWarnError(error.message);
    setWarning(null);
    customer.reload();
    timeline.reload();
  }

  async function removeCustomer() {
    if (!(await confirmAction({ title: "Delete this customer?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await supabase.rpc("delete_customer", { p_id: id });
    if (error) return setError(error.message);
    router.push("/customers");
  }

  if (customer.loading && !c) return <Loading />;
  if (!c) return <p className="text-sm text-slate-600">{customer.error ?? "This customer was not found, or you may not open it."}</p>;

  const maps = customerMapsUrl(c);
  const bookings = (linked.data ?? []).filter((l) => l.booking);

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href="/customers">All customers</BackLink>
      <PageHeader title={c.full_name} description={`Customer since ${formatDay(c.created_at.slice(0, 10))}${c.created_by_name ? ` · added by ${c.created_by_name}` : ""}`} />

      {c.warning_note && warning === null && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {c.warning_note}
        </p>
      )}

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
                <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-brand-700">
                  <MapPin className="h-4 w-4" /> Open in Google Maps
                </a>
              </div>
            )}
          </dl>
        )}
      </Card>

      {canEdit && (
        <Card title="Warning">
          {warning === null ? (
            <>
              <p className="mb-2 text-sm text-slate-600">
                {c.warning_note ? "A warning is showing on this customer and on all of their invoices." : "A warning note shows on this customer and on every one of their invoices, for example \u201ccollect payment first\u201d."}
              </p>
              <Button variant="secondary" onClick={() => setWarning(c.warning_note ?? "")}>
                {c.warning_note ? "Change or remove the warning" : "Add a warning"}
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <textarea value={warning} onChange={(e) => setWarning(e.target.value)} maxLength={300} rows={2} aria-label="Warning note" className={inputClass} placeholder="Leave empty to remove the warning" />
              <ErrorMessage message={warnError} />
              <div className="flex gap-2">
                <Button onClick={saveWarning}>Save</Button>
                <Button variant="secondary" onClick={() => setWarning(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ReceiversCard customerId={id} />

      {(ids.data?.length ?? 0) > 0 && (
        <Card title="Emirates ID">
          <ul className="space-y-3 text-sm">
            {ids.data!.map((d) => (
              <li key={d.id} className="space-y-2">
                <p className="font-mono">{d.emirates_id ?? "Photo only"}</p>
                {d.photo_path && <IdPhoto path={d.photo_path} />}
                <p className="text-xs text-slate-500">
                  Added by {d.uploaded_by_name} · {formatDate(d.created_at)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">To delete an ID photo, open the invoice it was taken for.</p>
        </Card>
      )}

      <Card title={`Invoices (${bookings.length})`}>
        {can("accounts.view") && bookings.length > 0 && (
          <Link href={`/customers/${id}/statement`} className={textLink}>
            <FileText className="h-4 w-4" /> Statement of account
          </Link>
        )}
        {linked.loading && !linked.data ? (
          <Loading />
        ) : !bookings.length ? (
          <p className="text-sm text-slate-500">No invoices linked yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {bookings.map(({ role, booking: b }) => (
              <li key={`${b!.id}-${role}`} className="flex items-center justify-between gap-3 py-3">
                <span>
                  {can("bookings.view") ? (
                    <Link href={`/bookings/${b!.id}`} className="inline-flex min-h-11 items-center font-mono font-medium text-brand-700">
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

      {can("customers.manage") && !bookings.length && (
        <Button variant="secondary" onClick={removeCustomer}>
          Delete this customer
        </Button>
      )}

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
          <Loading />
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
                        <Link href={`/bookings/${t.r_booking_id}`} className="inline-flex min-h-11 items-center px-1 text-brand-700">
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
