"use client";

import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { invoiceStatus, money, round2, totalPaid } from "@/lib/format";
import type { Booking, Driver } from "@/lib/types";

export default function AccountsPage() {
  const { data, error, loading } = useQuery<Booking[]>(() =>
    supabase.from("bookings").select("*, payments(*)").order("created_at", { ascending: false })
  );
  const drivers = useQuery<Driver[]>(() => supabase.from("drivers").select("*"));

  const all = (data ?? []).map((b) => ({ b, paid: totalPaid(b.payments) }));
  // Money received counts even if the booking was cancelled later; cancelled bookings are not billed or owed.
  const live = all.filter((r) => r.b.status !== "cancelled");

  // The invoice is the main record: one row per invoice number, newest first.
  const invoices = all
    .filter((r) => r.b.invoice_no)
    .sort((x, y) => y.b.invoice_no!.localeCompare(x.b.invoice_no!, undefined, { numeric: true }));

  const billed = round2(live.filter((r) => r.b.invoice_amount !== null).reduce((s, r) => s + Number(r.b.invoice_amount), 0));
  const collected = round2(all.reduce((s, r) => s + r.paid, 0));
  const outstandingTotal = round2(
    live
      .filter((r) => r.b.invoice_amount !== null && round2(Number(r.b.invoice_amount) - r.paid) > 0)
      .reduce((s, r) => s + Number(r.b.invoice_amount) - r.paid, 0)
  );
  const noAmount = invoices.filter((r) => r.b.status !== "cancelled" && r.b.invoice_amount === null);
  const estimatedPending = round2(noAmount.reduce((s, r) => s + Number(r.b.estimated_bill ?? 0), 0));

  // Money received, by who collected it and how. Every payment counts, including on cancelled bookings.
  const collections = (() => {
    const byWho = new Map<string, { name: string; cash: number; bank: number }>();
    for (const b of data ?? []) {
      for (const p of b.payments ?? []) {
        const key = p.received_by_driver ?? "office";
        const name = p.received_by_driver ? (drivers.data?.find((d) => d.id === key)?.name ?? "Driver") : "Office / not recorded";
        const row = byWho.get(key) ?? { name, cash: 0, bank: 0 };
        if (p.method === "cash") row.cash = round2(row.cash + Number(p.amount));
        else row.bank = round2(row.bank + Number(p.amount));
        byWho.set(key, row);
      }
    }
    return [...byWho.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

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
          <p className="text-sm text-slate-500">Outstanding</p>
          <p className="text-2xl font-semibold">{money(outstandingTotal)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Amount not set yet</p>
          <p className="text-2xl font-semibold">{noAmount.length}</p>
          <p className="text-xs text-slate-500">~{money(estimatedPending)} estimated</p>
        </Card>
      </div>

      <h2 className="mb-2 text-base font-semibold">Invoices</h2>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !invoices.length ? (
        <EmptyState message="No invoices yet. An invoice number is issued when a pickup is collected." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map(({ b, paid }) => {
                const amount = b.invoice_amount === null ? null : Number(b.invoice_amount);
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-3">
                      <Link href={`/bookings/${b.id}`} className="font-mono font-medium text-blue-700">
                        {b.invoice_no}
                      </Link>
                      <span className="block font-mono text-xs text-slate-500">{b.code}</span>
                    </td>
                    <td className="px-4 py-3">{b.sender_name}</td>
                    <td className="px-4 py-3 text-right">{amount === null ? "—" : money(amount)}</td>
                    <td className="px-4 py-3 text-right">{money(paid)}</td>
                    <td className="px-4 py-3 text-right font-medium">{amount === null ? "—" : money(Math.max(round2(amount - paid), 0))}</td>
                    <td className="space-x-1 whitespace-nowrap px-4 py-3">
                      <StatusBadge status={invoiceStatus(amount, paid)} />
                      {b.status === "cancelled" && <StatusBadge status="cancelled" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-base font-semibold">Collected, by who and how</h2>
      {!collections.length ? (
        <EmptyState message="No payments recorded yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Collected by</th>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3 text-right">Bank transfer</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {collections.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-right">{money(c.cash)}</td>
                  <td className="px-4 py-3 text-right">{money(c.bank)}</td>
                  <td className="px-4 py-3 text-right font-medium">{money(round2(c.cash + c.bank))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-4 py-3">All</td>
                <td className="px-4 py-3 text-right">{money(round2(collections.reduce((s, c) => s + c.cash, 0)))}</td>
                <td className="px-4 py-3 text-right">{money(round2(collections.reduce((s, c) => s + c.bank, 0)))}</td>
                <td className="px-4 py-3 text-right">{money(collected)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
