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
import { formatDay, methodLabel, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { Refund } from "@/lib/types";

type Receipt = Refund & {
  booking: { code: string; invoice_no: string | null; sender_name: string; sender_phone: string | null; pickup_address: string | null } | null;
  credit_note: { number: string } | null;
};

/** The receipt for money handed back to the customer, with a box for the customer to sign. */
export default function RefundReceiptPage() {
  const { id, refundId } = useParams<{ id: string; refundId: string }>();
  const canPrint = usePermissions().can("documents.print");
  const { org } = useOrganization();
  const refund = useQuery<Receipt>(() =>
    supabase
      .from("refunds")
      .select("*, booking:bookings(code, invoice_no, sender_name, sender_phone, pickup_address), credit_note:credit_notes(number)")
      .eq("id", refundId)
      .single()
  );

  const r = refund.data;
  if (refund.loading) return <Loading />;
  if (!r) return <ErrorMessage message={refund.error ?? "Refund not found"} />;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex justify-between print:hidden">
        <BackLink href={`/bookings/${id}`}>Back</BackLink>
        {canPrint && (
          <span className="flex gap-2">
            <ShareButton targetId="share-doc" filename={`Refund-${r.number}`} />
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </span>
        )}
      </div>

      <div id="share-doc" className="relative rounded-lg border border-slate-200 bg-white p-6 text-sm print:border-0 print:p-0">
        {r.status === "void" && (
          <p aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-black uppercase tracking-widest text-red-600/20 -rotate-12">VOID</p>
        )}
        <div className="border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">{site.name}</p>
          {org?.legal_name && <p className="text-xs text-slate-600">{org.legal_name}{org.country ? ` · ${org.country}` : ""}</p>}
          <h1 className="text-sm font-medium uppercase text-slate-600">Refund Receipt</h1>
          <p className="font-mono text-lg">{r.number}</p>
          <p className="font-mono text-xs text-slate-500">
            Invoice {r.booking?.invoice_no ?? "—"} · Booking {r.booking?.code}
            {r.credit_note ? ` · Credit note ${r.credit_note.number}` : ""}
          </p>
          <p className="text-slate-500">{formatDay(r.refund_date)}</p>
          {r.status === "void" && (
            <p className="mt-1 font-semibold text-red-700">
              VOID{r.voided_at ? ` on ${formatDay(r.voided_at.slice(0, 10))}` : ""}{r.void_reason ? `: ${r.void_reason}` : ""}
            </p>
          )}
        </div>

        <div className="py-3">
          <p className="text-xs uppercase text-slate-500">Customer</p>
          <p className="font-medium">{r.booking?.sender_name}</p>
          <p>{formatPhone(r.booking?.sender_phone ?? null)}</p>
          <p>{r.booking?.pickup_address}</p>
        </div>

        <div className="border-t border-slate-300 pt-3">
          <div className="flex justify-between text-base font-semibold"><span>Amount returned to the customer</span><span>{money(Number(r.amount))}</span></div>
          <div className="flex justify-between"><span>Method</span><span>{methodLabel(r.method)}</span></div>
          {r.note && <p className="mt-1 text-slate-600">Note: {r.note}</p>}
        </div>

        <p className="mt-4 text-xs text-slate-600">I confirm that I received the amount above from {site.name}.</p>
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">Handed over by{r.handed_by_name ? `: ${r.handed_by_name}` : ""}</div>
          <div className="border-t border-slate-400 pt-1">Customer signature</div>
        </div>
      </div>
    </div>
  );
}
