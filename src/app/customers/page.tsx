"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import CustomerForm from "@/components/customers/CustomerForm";
import RowCard from "@/components/ui/RowCard";
import ListSearch from "@/components/ui/ListSearch";
import Chip from "@/components/ui/Chip";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { Button, Card, ErrorMessage, Loading } from "@/components/ui/form";
import type { CustomerHit, DuplicateGroup } from "@/lib/customers";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import { confirmAction } from "@/lib/ask";
import { SortSelect, SortableTh } from "@/components/ui/Sortable";
import type { SortColumn } from "@/lib/sort";
import { useSort } from "@/lib/use-sort";

const PAGE = 50;

// The database does the sorting (the list is sent one page at a time), so these only name the columns.
const COLUMNS: Record<string, SortColumn<CustomerHit>> = {
  name: { key: "name", label: "Name" },
  phone: { key: "phone", label: "Phone" },
  address: { key: "address", label: "Address" },
  invoices: { key: "invoices", label: "Invoices", kind: "number" },
  last_invoice: { key: "last_invoice", label: "Last invoice", kind: "date", hint: "Sorts by the date of the latest invoice" },
};
const COLUMN_LIST = Object.values(COLUMNS);

function CustomersContent() {
  const router = useRouter();
  const { can } = usePermissions();
  const canEdit = can("customers.edit");
  const [tab, setTab] = useState<"all" | "dupes">("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState(""); // the text once typing pauses
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const sort = useSort(COLUMN_LIST);
  const searching = q.replace(/\s/g, "").length >= 2;
  const list = useQuery<{ customers: CustomerHit[]; total: number }>(
    () =>
      (searching
        ? supabase.rpc("search_customers", { p_query: q, p_limit: PAGE, p_sort: sort.activeKey, p_dir: sort.dir })
        : supabase.rpc("list_customers", { p_limit: PAGE, p_offset: 0, p_sort: sort.activeKey, p_dir: sort.dir })) as never,
    [q, searching, sort.activeKey, sort.dir]
  );

  const dupes = useQuery<DuplicateGroup[]>(() => supabase.rpc("possible_duplicates") as never, []);
  const groups = dupes.data ?? [];

  async function merge(keep: string, remove: string, names: string) {
    if (!(await confirmAction({ title: `Merge ${names}?`, message: "All invoices, notes and receivers move to the record you keep. This cannot be undone.", confirmLabel: "Merge", danger: true }))) return;
    setBusy(remove);
    setError(null);
    const { error } = await supabase.rpc("merge_customers", { p_keep: keep, p_remove: remove });
    setBusy(null);
    if (error) return setError(error.message);
    dupes.reload();
    list.reload();
  }

  const customers = list.data?.customers ?? [];

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
          { key: "dupes" as const, label: `Possible duplicates (${groups.length})` },
        ].map((t) => (
          <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </Chip>
        ))}
        {tab === "all" && <SortSelect sort={sort} />}
        {tab === "all" && <ListSearch value={text} onChange={setText} placeholder="Name, mobile, Emirates ID or invoice" className="ml-auto" />}
      </div>

      <ErrorMessage message={list.error ?? dupes.error ?? error} />

      {tab === "all" &&
        (list.loading && !list.data ? (
          <Loading />
        ) : !customers.length ? (
          <EmptyState message={searching ? "No customer found." : "No customers yet."} />
        ) : (
          <>
            <ul className="space-y-3 md:hidden">
              {customers.map((c) => (
                <RowCard key={c.id} href={`/customers/${c.id}`}>
                  <span className="block text-lg font-semibold text-brand-700">{c.full_name}</span>
                  <span className="block text-base text-slate-900">{formatPhone(c.phone) || "No phone"}</span>
                  {c.address && <span className="block text-base text-slate-700">{c.address}</span>}
                  <span className="mt-1 block text-sm text-slate-600">
                    {c.invoices} {c.invoices === 1 ? "invoice" : "invoices"}
                    {c.last_invoice ? ` · last ${c.last_invoice}` : ""}
                  </span>
                </RowCard>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <SortableTh column={COLUMNS.name} sort={sort} />
                    <SortableTh column={COLUMNS.phone} sort={sort} />
                    <SortableTh column={COLUMNS.address} sort={sort} />
                    <SortableTh column={COLUMNS.invoices} sort={sort} align="right" />
                    <SortableTh column={COLUMNS.last_invoice} sort={sort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${c.id}`} className="inline-flex min-h-11 items-center font-medium text-brand-700">
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

      {tab === "dupes" &&
        (dupes.loading && !dupes.data ? (
          <Loading />
        ) : !groups.length ? (
          <EmptyState message="No duplicates found. Two customers with the same phone number or Emirates ID would show here." />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              These customers share a phone number or an Emirates ID, so they are probably the same person.
              {can("customers.manage") ? " Choose the record to keep; the other one is merged into it and nothing is lost." : " A manager can merge them."}
            </p>
            {groups.map((g) => (
              <Card key={`${g.kind}-${g.value}`} title={g.kind === "phone" ? `Same phone: ${formatPhone(g.value)}` : `Same Emirates ID: ${g.value}`}>
                <ul className="divide-y divide-slate-100 text-sm">
                  {g.customers.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <span>
                        <Link href={`/customers/${c.id}`} className="inline-flex min-h-11 items-center font-medium text-brand-700">
                          {c.full_name}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {c.invoices} {c.invoices === 1 ? "invoice" : "invoices"}
                          {c.address ? ` · ${c.address}` : ""}
                        </span>
                      </span>
                      {can("customers.manage") &&
                        g.customers
                          .filter((o) => o.id !== c.id)
                          .map((o) => (
                            <Button key={o.id} variant="secondary" disabled={busy !== null} onClick={() => merge(c.id, o.id, `${o.full_name} into ${c.full_name}`)}>
                              Keep this, merge {g.customers.length > 2 ? o.full_name : "the other"} into it
                            </Button>
                          ))}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ))}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersContent />
    </Suspense>
  );
}
