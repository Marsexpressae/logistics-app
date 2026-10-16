"use client";

import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import ShareButton from "@/components/ui/ShareButton";
import BackLink from "@/components/ui/BackLink";
import { Button, ErrorMessage, Loading } from "@/components/ui/form";
import { site } from "@/config/site";
import { useOrganization } from "@/lib/organization";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { formatDay, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { CreditNote, CreditNoteLine } from "@/lib/types";

type Note = CreditNote & {
  credit_note_lines: CreditNoteLine[];
  booking: { code: string; sender_name: string; sender_phone: string | null; pickup_address: string | null } | null;
};
const CATEGORY: Record<string, string> = { transport: "Transport", packing: "Packing", labour: "Labour", other: "Other" };

/** The credit note the customer receives: what the invoice was, the services that are kept, and what is credited. */
export default function CreditNotePage() {
  const { id, noteId } = useParams<{ id: string; noteId: string }>();
  const canPrint = usePermissions().can("documents.print");
  const { org } = useOrganization();
  const note = useQuery<Note>(() =>
    supabase.from("credit_notes").select("*, credit_note_lines(*), booking:bookings(code, sender_name, sender_phone, pickup_address)").eq("id", noteId).single()
  );

  const n = note.data;
  if (note.loading) return <Loading />;
  if (!n) return <ErrorMessage message={note.error ?? "Credit note not found"} />;
  const lines = n.credit_note_lines ?? [];

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex justify-between print:hidden">
        <BackLink href={`/bookings/${id}`}>Back</BackLink>
        {canPrint && (
          <span className="flex gap-2">
            <ShareButton targetId="share-doc" filename={`Credit-note-${n.number}`} />
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </span>
        )}
      </div>

      <div id="share-doc" className="relative rounded-lg border border-slate-200 bg-white p-6 text-sm print:border-0 print:p-0">
        {n.status === "void" && (
          <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-black uppercase tracking-widest text-red-600/20 -rotate-12">VOID</p>
        )}
        <div className="border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">{site.name}</p>
          {org?.legal_name && <p className="text-xs text-slate-600">{org.legal_name}{org.country ? ` · ${org.country}` : ""}</p>}
          <h1 className="text-sm font-medium uppercase text-slate-600">Credit Note</h1>
          <p className="font-mono text-lg">{n.number}</p>
          <p className="font-mono text-xs text-slate-500">Invoice {n.invoice_no} · Booking {n.booking?.code}</p>
          <p className="text-slate-500">{formatDay(n.note_date)}</p>
          {n.status === "void" && (
            <p className="mt-1 font-semibold text-red-700">
              VOID{n.voided_at ? ` on ${formatDay(n.voided_at.slice(0, 10))}` : ""}{n.void_reason ? `: ${n.void_reason}` : ""}
            </p>
          )}
        </div>

        <div className="py-3">
          <p className="text-xs uppercase text-slate-500">Customer</p>
          <p className="font-medium">{n.booking?.sender_name}</p>
          <p>{formatPhone(n.booking?.sender_phone ?? null)}</p>
          <p>{n.booking?.pickup_address}</p>
        </div>

        <p className="border-t border-slate-300 py-3"><span className="text-xs uppercase text-slate-500">Reason</span><br />{n.reason}</p>

        <table className="w-full border-t border-slate-300 text-left">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2">Services kept (not credited)</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr className="border-t border-slate-100"><td className="py-1.5 text-slate-500" colSpan={2}>None. The whole invoice is credited.</td></tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1.5">{CATEGORY[l.category] ?? l.category}{l.note ? ` · ${l.note}` : ""}</td>
                <td className="py-1.5 text-right">{money(Number(l.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 border-t border-slate-300 pt-3">
          <div className="flex justify-between"><span>Invoice total before this credit note</span><span>{money(Number(n.old_total))}</span></div>
          <div className="flex justify-between"><span>New invoice total (services kept)</span><span>{money(Number(n.new_total))}</span></div>
          <div className="mt-1 flex justify-between font-semibold"><span>Credited</span><span>{money(Number(n.credit_amount))}</span></div>
          <p className="mt-2 text-xs text-slate-500">A credit note lowers the invoice. Any money handed back is recorded on a separate refund receipt.</p>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">Issued by{n.created_by_name ? `: ${n.created_by_name}` : ""}</div>
          <div className="border-t border-slate-400 pt-1">Customer signature</div>
        </div>
      </div>
    </div>
  );
}
