"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import ShareButton from "@/components/ui/ShareButton";
import { Button, ErrorMessage } from "@/components/ui/form";
import { site } from "@/config/site";
import type { Customer } from "@/lib/customers";
import { formatDay, money } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { useOrganization } from "@/lib/organization";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { buildStatement, type StatementBooking } from "@/lib/statement";
import { supabase } from "@/lib/supabase";

const STATE_LABEL = { not_invoiced: "No amount yet", unpaid: "Unpaid", partial: "Part paid", paid: "Paid" } as const;

/** A printable statement of account for one customer: invoices, payments and what is still owed. */
export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const { org } = useOrganization();
  const { can } = usePermissions();
  const customer = useQuery<Customer | null>(() => supabase.from("customers").select("*").eq("id", id).maybeSingle() as never, [id]);
  const links = useQuery<{ booking: StatementBooking | null }[]>(
    () =>
      supabase
        .from("booking_contacts")
        .select("booking:bookings(id, code, invoice_no, invoice_amount, pickup_date, status, payments(amount))")
        .eq("customer_id", id)
        .eq("role", "customer") as never,
    [id]
  );

  const c = customer.data;
  if (!can("accounts.view")) return <p className="text-sm text-slate-600">You do not have access to account statements.</p>;
  if ((customer.loading || links.loading) && !c) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!c) return <ErrorMessage message={customer.error ?? "Customer not found"} />;

  const st = buildStatement((links.data ?? []).flatMap((l) => (l.booking ? [l.booking] : [])));
  const cur = org?.currency ?? "AED";
  const today = new Date().toLocaleDateString(undefined, { dateStyle: "medium" });
  const summary = `${site.name}: statement for ${c.full_name} on ${today}. Invoiced ${cur} ${money(st.invoiced)}, paid ${cur} ${money(st.paid)}, ${st.outstanding > 0 ? `outstanding ${cur} ${money(st.outstanding)}` : "nothing outstanding"}.`;
  const phone = c.whatsapp ?? c.phone;
  const share = `${phone ? whatsappLink(phone) : "https://wa.me/"}?text=${encodeURIComponent(summary)}`;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap justify-between gap-2 print:hidden">
        <Link href={`/customers/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <span className="flex gap-2">
          <a href={share} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <MessageCircle className="h-4 w-4" /> Send summary on WhatsApp
          </a>
          {can("documents.print") && (
            <>
            <ShareButton targetId="share-doc" filename={`Statement-${c.full_name.replace(/\s+/g, "-")}`} />
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            </>
          )}
        </span>
      </div>

      <div id="share-doc" className="rounded-lg border border-slate-200 bg-white p-6 text-sm print:border-0 print:p-0">
        <div className="border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">{site.name}</p>
          {org?.legal_name && <p className="text-xs text-slate-600">{org.legal_name}{org.country ? ` · ${org.country}` : ""}</p>}
          <h1 className="text-sm font-medium uppercase text-slate-600">Statement of account</h1>
          <p className="text-slate-500">{today}</p>
        </div>

        <div className="py-3">
          <p className="text-xs uppercase text-slate-500">Customer</p>
          <p className="font-medium">{c.full_name}</p>
          <p>{formatPhone(c.phone)}</p>
          {c.address && <p className="text-slate-600">{c.address}</p>}
        </div>

        <table className="w-full text-left">
          <thead className="border-y border-slate-300 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Invoice</th>
              <th className="py-2">Date</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Paid</th>
              <th className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {st.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  No invoices yet.
                </td>
              </tr>
            )}
            {st.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 font-mono">{r.ref}</td>
                <td className="py-2">{formatDay(r.date)}</td>
                <td className="py-2 text-right">{r.amount === null ? <span className="text-slate-500">{STATE_LABEL.not_invoiced}</span> : money(r.amount)}</td>
                <td className="py-2 text-right">{money(r.paid)}</td>
                <td className="py-2 text-right font-medium">{r.balance === null ? "—" : money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-300 font-medium">
            <tr>
              <td colSpan={2} className="py-2">
                Total ({cur})
              </td>
              <td className="py-2 text-right">{money(st.invoiced)}</td>
              <td className="py-2 text-right">{money(st.paid)}</td>
              <td className="py-2 text-right">{money(st.outstanding)}</td>
            </tr>
          </tfoot>
        </table>

        {st.withoutAmount > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {st.withoutAmount} {st.withoutAmount === 1 ? "invoice has" : "invoices have"} no amount entered yet and {st.withoutAmount === 1 ? "is" : "are"} not in the totals.
          </p>
        )}
        <p className={`mt-4 text-center text-base font-semibold ${st.outstanding > 0 ? "text-red-700" : "text-green-700"}`}>
          {st.outstanding > 0 ? `Outstanding: ${cur} ${money(st.outstanding)}` : "Nothing outstanding"}
        </p>
      </div>
    </div>
  );
}
