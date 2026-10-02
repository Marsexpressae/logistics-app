"use client";

import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Card, ErrorMessage } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { money, round2, totalPaid } from "@/lib/format";
import type { Booking } from "@/lib/types";

export default function AccountsPage() {
  const { data, error, loading } = useQuery<Booking[]>(() =>
    supabase.from("bookings").select("*, payments(*)").order("created_at", { ascending: false })
  );

  const all = (data ?? []).map((b) => ({ b, paid: totalPaid(b.payments) }));
  // Money received counts even if the booking was cancelled later; cancelled bookings are not billed or owed.
  const rows = all.filter((r) => r.b.status !== "cancelled");
  const invoiced = rows.filter((r) => r.b.invoice_amount !== null);
  const notInvoiced = rows.filter((r) => r.b.invoice_amount === null);

  const billed = round2(invoiced.reduce((s, r) => s + Number(r.b.invoice_amount), 0));
  const collected = round2(all.reduce((s, r) => s + r.paid, 0));
  const outstanding = invoiced.filter((r) => round2(Number(r.b.invoice_amount) - r.paid) > 0);
  const outstandingTotal = round2(outstanding.reduce((s, r) => s + Number(r.b.invoice_amount) - r.paid, 0));
  const estimatedPending = round2(notInvoiced.reduce((s, r) => s + Number(r.b.estimated_bill ?? 0), 0));

  return (
    <>
      <PageHeader title="Accounts" description="Invoices, payments received and outstanding balances." />
      <ErrorMessage message={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">Invoiced</p>
          <p className="text-2xl font-semibold">{money(billed)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Collected</p>
          <p className="text-2xl font-semibold">{money(collected)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding (invoiced)</p>
          <p className="text-2xl font-semibold">{money(outstandingTotal)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Not yet invoiced</p>
          <p className="text-2xl font-semibold">{notInvoiced.length}</p>
          <p className="text-xs text-slate-500">~{money(estimatedPending)} estimated</p>
        </Card>
      </div>

      <h2 className="mb-2 text-base font-semibold">Outstanding balances</h2>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !outstanding.length ? (
        <EmptyState message="Nothing outstanding." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Sender</th>
                <th className="px-4 py-3 text-right">Invoice</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outstanding.map(({ b, paid }) => (
                <tr key={b.id}>
                  <td className="px-4 py-3">
                    <Link href={`/bookings/${b.id}`} className="font-mono font-medium text-blue-700">
                      {b.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{b.sender_name}</td>
                  <td className="px-4 py-3 text-right">{money(b.invoice_amount!)}</td>
                  <td className="px-4 py-3 text-right">{money(paid)}</td>
                  <td className="px-4 py-3 text-right font-medium">{money(round2(Number(b.invoice_amount) - paid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
