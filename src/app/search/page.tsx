"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import RowLimitNotice from "@/components/ui/RowLimitNotice";
import { Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { formatDay, invoiceStatus, totalPaid } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { formatPhone, phoneMatches } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import type { Booking, Container, Parcel } from "@/lib/types";

type ParcelRow = Parcel & { booking: Pick<Booking, "code" | "invoice_no" | "sender_name"> | null };

const LIMIT = 25;

/**
 * One box for everything: invoice number, booking code, names, phone numbers (any format), addresses,
 * parcel barcodes and container codes. Several words narrow the result: "ismail 0567".
 */
export default function SearchPage() {
  const [text, setText] = useState("");
  const bookings = useQuery<Booking[]>(() => supabase.from("bookings").select("*, payments(*)").order("created_at", { ascending: false }));
  const parcels = useQuery<ParcelRow[]>(() =>
    supabase.from("parcels").select("*, booking:bookings(code, invoice_no, sender_name)").neq("status", "repacked").order("barcode")
  );
  const containers = useQuery<Container[]>(() => supabase.from("containers").select("*").order("created_at", { ascending: false }));

  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const active = words.join("").length >= 2;
  const has = (value: string | null | undefined, w: string) => !!value && value.toLowerCase().includes(w);
  const everyWord = (match: (w: string) => boolean) => words.every(match);

  const foundBookings = !active
    ? []
    : (bookings.data ?? []).filter((b) =>
        // the whole text as one phone number ("50 123 4567", "0501234567", "+971501234567"), or every word somewhere
        [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp].some((n) => phoneMatches(text, n)) ||
        everyWord(
          (w) =>
            [b.invoice_no, b.code, b.sender_name, b.receiver_name, b.pickup_address, b.pickup_area, b.receiver_address].some((v) => has(v, w)) ||
            [b.sender_phone, b.sender_whatsapp, b.receiver_phone, b.receiver_whatsapp].some((n) => phoneMatches(w, n))
        )
      );
  const foundParcels = !active
    ? []
    : (parcels.data ?? []).filter((p) =>
        everyWord((w) => [p.barcode, p.description, p.booking?.invoice_no, p.booking?.code, p.booking?.sender_name].some((v) => has(v, w)))
      );
  const foundContainers = !active ? [] : (containers.data ?? []).filter((c) => everyWord((w) => [c.code, c.destination].some((v) => has(v, w))));

  const nothing = active && !foundBookings.length && !foundParcels.length && !foundContainers.length;
  const loading = bookings.loading || parcels.loading || containers.loading;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Search" description="Invoice number, booking code, name, phone number, address, parcel barcode or container." />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="INV-1001, BK-1002, Ismail, 0567375716, BK-1002-P1…"
          aria-label="Search"
          className={`${inputClass} pl-9`}
        />
      </div>
      <ErrorMessage message={bookings.error ?? parcels.error ?? containers.error} />
      <RowLimitNotice count={Math.max(bookings.data?.length ?? 0, parcels.data?.length ?? 0, containers.data?.length ?? 0)} what="records in a list" effect="the search can miss older ones." />

      {!active && <p className="text-sm text-slate-500">Type at least two characters. Several words narrow the result, for example &quot;ismail 0567&quot;.</p>}
      {active && loading && <p className="text-sm text-slate-500">Searching…</p>}
      {nothing && !loading && <p className="text-sm text-slate-600">Nothing found for &quot;{text.trim()}&quot;.</p>}

      {foundBookings.length > 0 && (
        <Card title={`Invoices and bookings (${foundBookings.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {foundBookings.slice(0, LIMIT).map((b) => (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-mono font-medium text-blue-700">{b.invoice_no ?? b.code}</span>
                    {b.invoice_no && <span className="ml-2 font-mono text-xs text-slate-500">{b.code}</span>}
                    <span className="block text-slate-700">
                      {b.sender_name} → {b.receiver_name ?? <span className="text-slate-400">receiver not set</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {formatPhone(b.sender_phone)} · {b.pickup_area} · {formatDay(b.pickup_date)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge status={b.status} />
                    {b.invoice_no && <StatusBadge status={invoiceStatus(b.invoice_amount === null ? null : Number(b.invoice_amount), totalPaid(b.payments))} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {foundBookings.length > LIMIT && <p className="mt-2 text-xs text-slate-500">Showing the first {LIMIT}. Add more words to narrow it.</p>}
        </Card>
      )}

      {foundParcels.length > 0 && (
        <Card title={`Parcels (${foundParcels.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {foundParcels.slice(0, LIMIT).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-mono font-medium">{p.barcode}</span>
                  <span className="block text-slate-700">
                    {p.description ?? "Parcel"} · {Number(p.weight_kg)} kg
                  </span>
                  <Link href={`/bookings/${p.booking_id}`} className="font-mono text-xs text-blue-700">
                    {p.booking?.invoice_no ?? p.booking?.code} · {p.booking?.sender_name}
                  </Link>
                </span>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {foundContainers.length > 0 && (
        <Card title={`Containers (${foundContainers.length})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {foundContainers.slice(0, LIMIT).map((c) => (
              <li key={c.id}>
                <Link href={`/containers/${c.id}`} className="flex items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-mono font-medium text-blue-700">{c.code}</span>
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
