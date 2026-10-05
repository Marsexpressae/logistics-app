"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import CustomerForm from "@/components/customers/CustomerForm";
import ListSearch from "@/components/ui/ListSearch";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import type { BookingWithoutCustomer, CustomerHit } from "@/lib/customers";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

const PAGE = 50;

export default function CustomersPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const canEdit = can("customers.edit");
  const [tab, setTab] = useState<"all" | "todo">("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState(""); // the text once typing pauses
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const searching = q.replace(/\s/g, "").length >= 2;
  const list = useQuery<{ customers: CustomerHit[]; total: number }>(
    () => (searching ? supabase.rpc("search_customers", { p_query: q, p_limit: PAGE }) : supabase.rpc("list_customers", { p_limit: PAGE, p_offset: 0 })) as never,
    [q, searching]
  );
  const todo = useQuery<{ bookings: BookingWithoutCustomer[]; total: number }>(() => supabase.rpc("bookings_without_customer", { p_limit: 100 }) as never, []);

  const customers = list.data?.customers ?? [];
  const waiting = todo.data?.total ?? 0;

  async function createFor(bookingId: string) {
    setBusy(bookingId);
    setError(null);
    const { data, error } = await supabase.rpc("create_customer_from_booking", { p_booking_id: bookingId });
    setBusy(null);
    if (error) return setError(error.message);
    router.push(`/customers/${data as string}`);
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Customers" description="Everyone you do business with, with their history. Search by name, mobile, Emirates ID or invoice number." />
        {canEdit && !creating && (
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" /> New customer
          </Button>
        )}
      </div>

      {creating && (
        <Card title="New customer">
          <CustomerForm onSaved={(id) => router.push(`/customers/${id}`)} onCancel={() => setCreating(false)} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "all" as const, label: "All customers" },
          { key: "todo" as const, label: `Bookings without a customer (${waiting})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
        {tab === "all" && <ListSearch value={text} onChange={setText} placeholder="Name, mobile, Emirates ID or invoice" className="ml-auto" />}
      </div>

      <ErrorMessage message={list.error ?? todo.error ?? error} />

      {tab === "all" &&
        (list.loading && !list.data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !customers.length ? (
          <EmptyState message={searching ? "No customer found." : "No customers yet."} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Address</th>
                    <th className="px-4 py-3 text-right">Invoices</th>
                    <th className="px-4 py-3">Last invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${c.id}`} className="font-medium text-blue-700">
                          {c.full_name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{formatPhone(c.phone)}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-600">{c.address ?? "—"}</td>
                      <td className="px-4 py-3 text-right">{c.invoices}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.last_invoice ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {customers.length} of {list.data?.total ?? customers.length}
              {(list.data?.total ?? 0) > customers.length ? ". Search to find the others." : ""}
            </p>
          </>
        ))}

      {tab === "todo" &&
        (todo.loading && !todo.data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !todo.data?.bookings.length ? (
          <EmptyState message="Every booking has a customer. Nothing to do." />
        ) : (
          <Card>
            <p className="mb-3 text-sm text-slate-600">
              These bookings are not linked to a customer yet. Open one to find the customer, or create the customer from the booking.
            </p>
            <ul className="divide-y divide-slate-100 text-sm">
              {todo.data.bookings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-mono font-medium">{b.invoice_no ?? b.code}</span>
                    {b.invoice_no && <span className="ml-2 font-mono text-xs text-slate-500">{b.code}</span>}
                    <span className="block text-slate-700">
                      {b.sender_name} · {formatPhone(b.sender_phone)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    {can("bookings.view") && (
                      <Link href={`/bookings/${b.id}`} className="font-medium text-blue-700">
                        Open
                      </Link>
                    )}
                    {canEdit && (
                      <Button variant="secondary" onClick={() => createFor(b.id)} disabled={busy === b.id}>
                        Create customer
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
