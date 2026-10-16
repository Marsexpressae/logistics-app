"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/form";
import type { Booking } from "@/lib/types";

/** Collected cargo waiting to be received into the warehouse. */
export default function IntakeList({ bookings, hasAny, canOperate }: { bookings: Booking[]; hasAny: boolean; canOperate: boolean }) {
  return (
    <Card id="awaiting-intake" className="border-0! bg-transparent! p-0!">
      {!bookings.length ? (
        <p className="text-sm text-slate-500">{hasAny ? "No bookings match your search." : "No collected bookings waiting."}</p>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => {
            const row = (
              <>
                <span className="min-w-0">
                  <span className="block font-mono text-lg font-semibold">{b.invoice_no ?? b.code}</span>
                  <span className="block text-base text-slate-800">{b.sender_name}</span>
                  <span className="block text-sm text-slate-600">→ {b.receiver_name ?? "receiver not set"}</span>
                </span>
                {canOperate && (
                  <span className="flex shrink-0 items-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-base font-semibold text-white">
                    Receive <ChevronRight className="h-5 w-5" />
                  </span>
                )}
              </>
            );
            const box = "flex min-h-20 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white p-4";
            return (
              <li key={b.id}>
                {canOperate ? (
                  <Link href={`/warehouse-inventory/split/${b.id}`} className={`${box} active:bg-slate-50`}>
                    {row}
                  </Link>
                ) : (
                  <div className={box}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
