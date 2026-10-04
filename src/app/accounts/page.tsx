"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/format";

// Totals and the invoice list are computed in the database (see ADR-0007), so they stay correct at any size.
type Summary = {
  invoiced: number;
  collected: number;
  outstanding: number;
  no_amount_count: number;
  estimated_pending: number;
  collections: { name: string; cash: number; bank: number }[];
};
type InvoiceRow = {
  r_booking_id: string;
  r_invoice_no: string;
  r_code: string;
  r_customer: string;
  r_amount: number | null;
  r_paid: number;
  r_balance: number | null;
  r_booking_status: string;
  r_pay_status: "not_invoiced" | "unpaid" | "partial" | "paid";
  r_total: number;
};

const PAGE = 25;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "not_invoiced", label: "No amount yet" },
];

export default function AccountsPage() {
  const [status, setStatus] = useState("all");
  const [text, setText] = useState("");
  const [search, setSearch] = useState(""); // the text, once typing pauses
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(text.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const summary = useQuery<Summary>(() => supabase.rpc("accounts_summary"));
  const invoices = useQuery<InvoiceRow[]>(
    () => supabase.rpc("accounts_invoices", { p_status: status, p_search: search || null, p_limit: PAGE, p_offset: page * PAGE }),
    [status, search, page]
  );

  const s = summary.data;
  const rows = invoices.data ?? [];
  const total = rows[0]?.r_total ?? 0;
  const from = total ? page * PAGE + 1 : 0;
  const to = page * PAGE + rows.length;

  return (
    <>
      <PageHeader title="Accounts" description="Invoices, payments received and outstanding balances." />
      <ErrorMessage message={summary.error ?? invoices.error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">Invoiced</p>
          <p className="text-2xl font-semibold">{money(s?.invoiced ?? 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Collected</p>
          <p className="text-2xl font-semibold">{money(s?.collected ?? 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding</p>
          <p className="text-2xl font-semibold">{money(s?.outstanding ?? 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Amount not set yet</p>
          <p className="text-2xl font-semibold">{s?.no_amount_count ?? 0}</p>
          <p className="text-xs text-slate-500">~{money(s?.estimated_pending ?? 0)} estimated</p>
        </Card>
      </div>

      <h2 className="mb-2 text-base font-semibold">Invoices</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setStatus(f.value);
              setPage(0);
            }}
            className={`rounded-full px-3 py-1 text-sm ${
              status === f.value ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Invoice, booking or customer"
            aria-label="Search invoices"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {invoices.loading && !invoices.data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !rows.length ? (
        <EmptyState message={search || status !== "all" ? "No invoices match." : "No invoices yet. An invoice number is issued when a pickup is collected."} />
      ) : (
        <>
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
                {rows.map((r) => (
                  <tr key={r.r_booking_id}>
                    <td className="px-4 py-3">
                      <Link href={`/bookings/${r.r_booking_id}`} className="font-mono font-medium text-blue-700">
                        {r.r_invoice_no}
                      </Link>
                      <span className="block font-mono text-xs text-slate-500">{r.r_code}</span>
                    </td>
                    <td className="px-4 py-3">{r.r_customer}</td>
                    <td className="px-4 py-3 text-right">{r.r_amount === null ? "—" : money(Number(r.r_amount))}</td>
                    <td className="px-4 py-3 text-right">{money(Number(r.r_paid))}</td>
                    <td className="px-4 py-3 text-right font-medium">{r.r_balance === null ? "—" : money(Number(r.r_balance))}</td>
                    <td className="space-x-1 whitespace-nowrap px-4 py-3">
                      <StatusBadge status={r.r_pay_status} />
                      {r.r_booking_status === "cancelled" && <StatusBadge status="cancelled" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              {from}–{to} of {total}
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setPage(page - 1)} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="secondary" onClick={() => setPage(page + 1)} disabled={to >= total}>
                Next
              </Button>
            </span>
          </div>
        </>
      )}

      <h2 className="mb-2 mt-6 text-base font-semibold">Collected, by who and how</h2>
      {!s?.collections.length ? (
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
              {s.collections.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-right">{money(Number(c.cash))}</td>
                  <td className="px-4 py-3 text-right">{money(Number(c.bank))}</td>
                  <td className="px-4 py-3 text-right font-medium">{money(Number(c.cash) + Number(c.bank))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-4 py-3">All</td>
                <td className="px-4 py-3 text-right">{money(s.collections.reduce((t, c) => t + Number(c.cash), 0))}</td>
                <td className="px-4 py-3 text-right">{money(s.collections.reduce((t, c) => t + Number(c.bank), 0))}</td>
                <td className="px-4 py-3 text-right">{money(s.collected)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
