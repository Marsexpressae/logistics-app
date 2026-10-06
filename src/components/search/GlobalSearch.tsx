"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Container as ContainerIcon, FileText, Search, UserRound } from "lucide-react";
import { StatusBadge } from "@/components/ui/form";
import { EMPTY_RESULT, jobHref, type SearchResult } from "@/lib/job-link";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

type Item = { key: string; href: string };

/**
 * The search box in the top bar, on every screen. Type to see the best matches at once (invoices, packages,
 * containers); press Enter, or "See all results", for the full page. Press / or Ctrl+K from anywhere to start typing.
 * The rules are the same as the search boxes above each list, and permissions apply: you only find what you may open.
 */
export default function GlobalSearch({ autoFocus = false, onDone, className = "" }: { autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  // The latest answer from the database, and which question it was for.
  const [answer, setAnswer] = useState<{ q: string; result: SearchResult; failed: boolean } | null>(null);
  const [active, setActive] = useState(-1);

  const q = text.trim();
  const ready = q.replace(/\s/g, "").length >= 2;
  const seesContainers = can("containers.view") || can("containers.manage");
  const result = ready && answer ? answer.result : EMPTY_RESULT;
  const failed = ready && !!answer?.failed;
  const loading = ready && answer?.q !== q;

  // Look up while typing, once typing pauses. An older answer never replaces a newer one.
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("global_search", { p_query: q, p_limit: 5 });
      if (stale) return;
      setAnswer({ q, result: error || !data ? EMPTY_RESULT : (data as SearchResult), failed: !!error });
      setActive(-1);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, ready]);

  // / and Ctrl+K start a search from anywhere (not while typing in another box).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
      if ((e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking elsewhere.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const seesCustomers = can("customers.view");
  const customers = seesCustomers ? (result.customers ?? []) : [];
  const items: Item[] = [
    ...customers.map((c) => ({ key: `u-${c.id}`, href: `/customers/${c.id}` })),
    ...result.bookings.flatMap((b) => {
      const href = jobHref(can, b.id);
      return href ? [{ key: `b-${b.id}`, href }] : [];
    }),
    ...result.parcels.flatMap((p) => {
      const href = jobHref(can, p.booking_id);
      return href ? [{ key: `p-${p.id}`, href }] : [];
    }),
    ...(seesContainers ? result.containers.map((c) => ({ key: `c-${c.id}`, href: `/containers/${c.id}` })) : []),
  ];

  const allHref = `/search?q=${encodeURIComponent(q)}`;
  const close = () => {
    setOpen(false);
    setActive(-1);
    onDone?.();
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
      onDone?.();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter" && ready) {
      e.preventDefault();
      go(active >= 0 && items[active] ? items[active].href : allHref);
    }
  }

  const total = result.bookings_total + result.parcels_total + (seesContainers ? result.containers_total : 0) + (seesCustomers ? (result.customers_total ?? 0) : 0);
  const activeKey = active >= 0 ? items[active]?.key : undefined;
  const row = (key: string, href: string | null, children: ReactNode) => {
    const content = (
      <span className={`flex items-start justify-between gap-3 px-3 py-2 ${activeKey === key ? "bg-brand-50" : "hover:bg-slate-50"}`}>{children}</span>
    );
    return href ? (
      <li key={key} id={`gs-${key}`} role="option" aria-selected={activeKey === key}>
        <Link href={href} onClick={close} className="block">
          {content}
        </Link>
      </li>
    ) : (
      <li key={key} role="option" aria-selected={false}>
        {content}
      </li>
    );
  };

  return (
    <div ref={box} className={`relative w-full ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={input}
        autoFocus={autoFocus}
        type="search"
        role="combobox"
        aria-expanded={open && ready}
        aria-controls="global-search-results"
        aria-activedescendant={activeKey ? `gs-${activeKey}` : undefined}
        aria-label="Search everything"
        placeholder="Search invoices, names, phones, packages…  ( / )"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-full border border-slate-500 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
      />

      {open && ready && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && !total ? (
            <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
          ) : failed ? (
            <p className="px-3 py-3 text-sm text-red-700">The search is not available right now.</p>
          ) : !total ? (
            <p className="px-3 py-3 text-sm text-slate-600">Nothing found for &quot;{q}&quot;.</p>
          ) : (
            <>
              {customers.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase text-slate-500">Customers</p>
                  <ul>
                    {customers.map((c) =>
                      row(
                        `u-${c.id}`,
                        `/customers/${c.id}`,
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm">
                            <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="font-medium text-brand-700">{c.full_name}</span>
                          </span>
                          <span className="block truncate text-xs text-slate-600">
                            {[formatPhone(c.phone), c.address].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      )
                    )}
                  </ul>
                </>
              )}
              {result.bookings.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase text-slate-500">Invoices and bookings</p>
                  <ul>
                    {result.bookings.map((b) =>
                      row(
                        `b-${b.id}`,
                        jobHref(can, b.id),
                        <>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
                              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="whitespace-nowrap font-mono font-medium text-brand-700">{b.invoice_no ?? b.code}</span>
                              {b.invoice_no && <span className="whitespace-nowrap font-mono text-xs text-slate-500">{b.code}</span>}
                            </span>
                            <span className="block truncate text-xs text-slate-600">
                              {b.sender_name} → {b.receiver_name ?? "receiver not set"}
                            </span>
                          </span>
                          <StatusBadge status={b.status} />
                        </>
                      )
                    )}
                  </ul>
                </>
              )}
              {result.parcels.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase text-slate-500">Packages</p>
                  <ul>
                    {result.parcels.map((p) =>
                      row(
                        `p-${p.id}`,
                        jobHref(can, p.booking_id),
                        <>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
                              <Box className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="whitespace-nowrap font-mono font-medium">{p.barcode}</span>
                              <span className="whitespace-nowrap font-mono text-xs text-slate-500">{p.invoice_no ?? p.booking_code}</span>
                            </span>
                            <span className="block truncate text-xs text-slate-600">
                              {[p.place, p.position, p.description].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <StatusBadge status={p.status} />
                        </>
                      )
                    )}
                  </ul>
                </>
              )}
              {seesContainers && result.containers.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase text-slate-500">Containers</p>
                  <ul>
                    {result.containers.map((c) =>
                      row(
                        `c-${c.id}`,
                        `/containers/${c.id}`,
                        <>
                          <span className="flex items-center gap-1.5 text-sm">
                            <ContainerIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="font-mono font-medium text-brand-700">{c.code}</span>
                            <span className="text-xs text-slate-600">{c.destination ?? ""}</span>
                          </span>
                          <StatusBadge status={c.status} />
                        </>
                      )
                    )}
                  </ul>
                </>
              )}
              <Link href={allHref} onClick={close} className="block border-t border-slate-100 px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-slate-50">
                See all results for &quot;{q}&quot; →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
