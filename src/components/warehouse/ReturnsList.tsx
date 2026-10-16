"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui/form";
import { formatDay, kg } from "@/lib/format";
import type { ReturnForm } from "@/lib/types";

/** The returns, one group per invoice (booking), newest first, with its returns inside. */
export default function ReturnsList({ list, hasAny, canOperate, openReturns, setOpenReturns }: {
  list: ReturnForm[];
  hasAny: boolean;
  canOperate: boolean;
  openReturns: string[];
  setOpenReturns: (v: string[]) => void;
}) {
  const returnGroups = (list: ReturnForm[]) => {
    const byBooking = new Map<string, { bookingId: string; invoice: string; code: string; customer: string; returns: ReturnForm[] }>();
    for (const x of list) {
      const g = byBooking.get(x.booking_id) ?? {
        bookingId: x.booking_id,
        invoice: x.booking?.invoice_no ?? x.booking?.code ?? "",
        code: x.booking?.code ?? "",
        customer: x.booking?.sender_name ?? "",
        returns: [],
      };
      g.returns.push(x);
      byBooking.set(x.booking_id, g);
    }
    return [...byBooking.values()].sort((a, b) => b.invoice.localeCompare(a.invoice, undefined, { numeric: true }));
  };

  return (
    <Card>
      {!list.length ? (
        <p className="text-sm text-slate-500">
          {hasAny ? "No returns match your search." : "No returns yet. Tick parcels in Unpacked or Packed, then press Return selected."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {returnGroups(list).map((g) => {
            const isOpen = openReturns.includes(g.bookingId);
            const statuses = [...new Set(g.returns.map((x) => x.status))];
            const packages = g.returns.reduce((s, x) => s + (x.parcels?.length ?? 0), 0);
            return (
              <li key={g.bookingId} className="py-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenReturns(isOpen ? openReturns.filter((x) => x !== g.bookingId) : [...openReturns, g.bookingId])}
                  className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg px-1 text-left active:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-lg font-semibold text-brand-700">{g.invoice}</span>
                    <span className="block text-base text-slate-800">{g.customer}</span>
                    <span className="block text-base text-slate-700">
                      <span className="font-mono">{g.code}</span> · {g.returns.length} {g.returns.length === 1 ? "return" : "returns"}, {packages}{" "}
                      {packages === 1 ? "package" : "packages"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {statuses.map((s) => (
                      <StatusBadge large key={s} status={s} />
                    ))}
                    {isOpen ? <ChevronDown className="h-6 w-6 text-slate-600" /> : <ChevronRight className="h-6 w-6 text-slate-600" />}
                  </span>
                </button>
                {isOpen && (
                  <ul className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
                    {g.returns.map((x) => (
                      <li key={x.id}>
                        {(() => {
                          const inner = (
                            <>
                              <span className="min-w-0">
                                <span className="block font-mono text-base font-semibold">{x.code}</span>
                                <span className="block text-sm text-slate-700">{formatDay(x.form_date)}</span>
                                <span className="block text-base text-slate-800">
                                  {(x.parcels ?? []).map((p) => `${p.barcode} (${kg(Number(p.weight_kg))})`).join(", ") || "no packages"}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center justify-between gap-2">
                                <StatusBadge large status={x.status} />
                                {canOperate && (
                                  <span className="flex items-center gap-1 rounded-md border border-brand-600 px-3 py-2 text-base font-semibold text-brand-700">
                                    {x.status === "open" ? "Form" : "View"} <ChevronRight className="h-5 w-5" />
                                  </span>
                                )}
                              </span>
                            </>
                          );
                          const box = "flex min-h-16 flex-col gap-3 rounded-lg border border-slate-300 bg-white p-3 sm:flex-row sm:items-center sm:justify-between";
                          return canOperate ? (
                            <Link href={`/warehouse-inventory/returns/${x.id}`} className={`${box} active:bg-slate-50`}>
                              {inner}
                            </Link>
                          ) : (
                            <div className={box}>{inner}</div>
                          );
                        })()}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
