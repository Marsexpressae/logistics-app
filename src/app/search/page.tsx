"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import ListSearch from "@/components/ui/ListSearch";
import { Card, ErrorMessage, StatusBadge } from "@/components/ui/form";
import { formatDay } from "@/lib/format";
import { EMPTY_RESULT, jobHref, type SearchResult } from "@/lib/job-link";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

const LIMIT = 25;

/**
 * All the results for what was typed in the top bar. The search itself runs in the database
 * (invoice, booking, name, phone in any format, address, notes, package barcode, position, place, container).
 */
function SearchResults({ initial }: { initial: string }) {
  const { can } = usePermissions();
  const [text, setText] = useState(initial);
  const [typed, setTyped] = useState(initial); // the text once typing pauses
  const [answer, setAnswer] = useState<{ q: string; result: SearchResult; error: string | null } | null>(null);
  const seesMoney = can("accounts.view");
  const seesContainers = can("containers.view") || can("containers.manage");

  useEffect(() => {
    const t = setTimeout(() => setTyped(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (typed.replace(/\s/g, "").length < 2) return;
    let stale = false;
    supabase.rpc("global_search", { p_query: typed, p_limit: LIMIT }).then(({ data, error }) => {
      if (stale) return;
      setAnswer({ q: typed, result: error || !data ? EMPTY_RESULT : (data as SearchResult), error: error?.message ?? null });
    });
    return () => {
      stale = true;
    };
  }, [typed]);

  const ready = typed.replace(/\s/g, "").length >= 2;
  const result = ready && answer ? answer.result : EMPTY_RESULT;
  const error = ready ? (answer?.error ?? null) : null;
  const loading = ready && answer?.q !== typed;

  const active = ready;
  const seesCustomers = can("customers.view");
  const customers = seesCustomers ? (result.customers ?? []) : [];
  const total = result.bookings_total + result.parcels_total + (seesContainers ? result.containers_total : 0) + (seesCustomers ? (result.customers_total ?? 0) : 0);

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Search results" description="Invoice number, booking code, name, phone number, address, notes, package barcode, position, place or container." />
      <ListSearch value={text} onChange={setText} placeholder="Search everything" className="max-w-none sm:max-w-none" />
      <ErrorMessage message={error} />

      {!active && <p className="text-sm text-slate-500">Type at least two characters. Several words narrow the result, for example &quot;ismail 0567&quot;.</p>}
      {active && loading && !total && <p className="text-sm text-slate-500">Searching…</p>}
      {active && !loading && !total && !error && <p className="text-sm text-slate-600">Nothing found for &quot;{typed}&quot;.</p>}

      {result.bookings.length > 0 && (
        <Card title={`Invoices and bookings (${result.bookings_total})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {result.bookings.map((b) => {
              const href = jobHref(can, b.id);
              const body = (
                <>
                  <span>
                    <span className="font-mono font-medium text-brand-700">{b.invoice_no ?? b.code}</span>
                    {b.invoice_no && <span className="ml-2 font-mono text-xs text-slate-500">{b.code}</span>}
                    <span className="block text-slate-700">
                      {b.sender_name} → {b.receiver_name ?? <span className="text-slate-500">receiver not set</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {formatPhone(b.sender_phone)} · {b.pickup_area} · {formatDay(b.pickup_date)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge status={b.status} />
                    {seesMoney && b.pay_status && <StatusBadge status={b.pay_status} />}
                  </span>
                </>
              );
              return (
                <li key={b.id}>
                  {href ? (
                    <Link href={href} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {result.bookings_total > LIMIT && <p className="mt-2 text-xs text-slate-500">Showing the first {LIMIT} of {result.bookings_total}. Add more words to narrow it.</p>}
        </Card>
      )}

      {result.parcels.length > 0 && (
        <Card title={`Packages (${result.parcels_total})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {result.parcels.map((p) => {
              const href = jobHref(can, p.booking_id);
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-mono font-medium">{p.barcode}</span>
                    <span className="block text-slate-700">
                      {p.description ?? "Package"} · {Number(p.weight_kg)} kg
                      {p.place ? ` · ${p.place}` : ""}
                      {p.position ? ` · ${p.position}` : ""}
                    </span>
                    {href ? (
                      <Link href={href} className="font-mono text-xs text-brand-700">
                        {p.invoice_no ?? p.booking_code} · {p.sender_name}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-slate-500">
                        {p.invoice_no ?? p.booking_code} · {p.sender_name}
                      </span>
                    )}
                  </span>
                  <StatusBadge status={p.status} />
                </li>
              );
            })}
          </ul>
          {result.parcels_total > LIMIT && <p className="mt-2 text-xs text-slate-500">Showing the first {LIMIT} of {result.parcels_total}. Add more words to narrow it.</p>}
        </Card>
      )}

      {customers.length > 0 && (
        <Card title={`Customers (${result.customers_total ?? customers.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-center justify-between gap-2 py-3 active:bg-slate-50">
                  <span>
                    <span className="font-medium text-brand-700">{c.full_name}</span>
                    <span className="block text-xs text-slate-600">{[formatPhone(c.phone), c.address].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-xs text-slate-500">{c.invoices} {c.invoices === 1 ? "invoice" : "invoices"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {seesContainers && result.containers.length > 0 && (
        <Card title={`Containers (${result.containers_total})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {result.containers.map((c) => (
              <li key={c.id}>
                <Link href={`/containers/${c.id}`} className="flex items-center justify-between gap-2 py-3 active:bg-slate-50">
                  <span>
                    <span className="font-mono font-medium text-brand-700">{c.code}</span>
                    <span className="ml-2 text-slate-600">{c.destination ?? "No destination"}</span>
                  </span>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}

// A new question from the top bar starts a fresh page (the key changes with the question).
function SearchPageInner() {
  const asked = useSearchParams().get("q") ?? "";
  return <SearchResults key={asked} initial={asked} />;
}
