"use client";

import { useEffect, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { inputClass } from "@/components/ui/form";
import type { CustomerHit } from "@/lib/customers";
import { formatPhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";

/**
 * Find an existing customer by mobile, name, Emirates ID, or any old invoice or booking number of theirs, and pick them.
 * Used on the booking form, and on the Customer card of a booking.
 */
export default function CustomerPicker({
  onPick,
  autoFocus = false,
  placeholder = "Mobile, name, Emirates ID or an old invoice number",
  className = "",
}: {
  onPick: (customer: CustomerHit) => void;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<{ q: string; hits: CustomerHit[]; failed: boolean } | null>(null);

  const q = text.trim();
  const ready = q.replace(/\s/g, "").length >= 2;
  const loading = ready && answer?.q !== q;
  const hits = ready && answer ? answer.hits : [];

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_customers", { p_query: q, p_limit: 6 });
      if (stale) return;
      setAnswer({ q, hits: error || !data ? [] : ((data as { customers: CustomerHit[] }).customers ?? []), failed: !!error });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, ready]);

  return (
    <div className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Find a customer"
          className={`${inputClass} pl-9`}
        />
      </div>
      {ready && (
        <ul aria-live="polite" className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
          {loading && !hits.length ? (
            <li className="px-3 py-2.5 text-slate-600">Searching…</li>
          ) : answer?.failed && answer.q === q ? (
            <li className="px-3 py-2.5 text-red-700">The search is not available right now.</li>
          ) : !hits.length ? (
            <li className="px-3 py-2.5 text-slate-600">No customer found.</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onPick(h)} className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50 active:bg-slate-100">
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{h.full_name}</span>
                    <span className="block truncate text-xs text-slate-600">
                      {formatPhone(h.phone)}
                      {h.address ? ` · ${h.address}` : ""}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {h.invoices} {h.invoices === 1 ? "invoice" : "invoices"}
                      {h.last_invoice ? ` · last ${h.last_invoice}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
