"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Printer } from "lucide-react";
import { Button, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { site } from "@/config/site";
import { formatDate, kg, round2 } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { formatPhone } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import type { ReturnForm } from "@/lib/types";

export default function ReturnFormPage() {
  const { id } = useParams<{ id: string }>();
  const form = useQuery<ReturnForm>(() =>
    supabase
      .from("returns")
      .select("*, booking:bookings(code, invoice_no, sender_name, sender_phone, pickup_address, pickup_area), parcels(*)")
      .eq("id", id)
      .single()
  );
  const [receivedBy, setReceivedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const r = form.data;
  if (form.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!r) return <ErrorMessage message={form.error ?? "Return not found"} />;

  const parcels = [...(r.parcels ?? [])].sort((a, b) => a.seq - b.seq);
  const totalKg = round2(parcels.reduce((s, p) => s + Number(p.weight_kg), 0));
  const open = r.status === "open";

  async function act(action: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await action;
    setBusy(false);
    if (error) setError(error.message);
    form.reload();
  }

  const complete = () => {
    if (!confirm(`Confirm the parcels were handed to ${receivedBy.trim()} and the form is signed?\n\nThis marks the parcels as Returned.`)) return;
    act(supabase.rpc("complete_return", { p_return_id: id, p_received_by: receivedBy }));
  };
  const cancel = () => {
    if (!confirm("Cancel this return? The parcels go back to normal warehouse stock.")) return;
    act(supabase.rpc("cancel_return", { p_return_id: id }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/warehouse-inventory" className="inline-flex items-center gap-1 text-sm text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Warehouse
        </Link>
        <span className="flex items-center gap-3">
          <StatusBadge status={r.status} />
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print form
          </Button>
        </span>
      </div>

      {/* The printed form */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm print:border-0 print:p-0">
        <div className="border-b border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold tracking-wide">{site.name}</p>
          <h1 className="text-sm font-medium uppercase text-slate-600">Cargo Return Form</h1>
          <p className="font-mono text-lg">{r.code}</p>
          <p className="text-slate-500">
            Invoice <span className="font-mono font-medium">{r.booking?.invoice_no ?? "—"}</span> · Booking{" "}
            <span className="font-mono">{r.booking?.code}</span> · {formatDate(r.created_at)}
          </p>
        </div>

        <div className="py-3">
          <p className="text-xs uppercase text-slate-500">Sender</p>
          <p className="font-medium">{r.booking?.sender_name}</p>
          <p>{formatPhone(r.booking?.sender_phone ?? null)}</p>
          <p>
            {r.booking?.pickup_area} · {r.booking?.pickup_address}
          </p>
        </div>

        <table className="w-full border-t border-slate-300 text-left">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="py-2">Package ID</th>
              <th className="py-2">Items</th>
              <th className="py-2 text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-1.5 font-mono">{p.barcode}</td>
                <td className="py-1.5">{p.description || "—"}</td>
                <td className="py-1.5 text-right">{kg(Number(p.weight_kg))}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-medium">
              <td className="py-2" colSpan={2}>
                Total · {parcels.length} {parcels.length === 1 ? "package" : "packages"}
              </td>
              <td className="py-2 text-right">{kg(totalKg)}</td>
            </tr>
          </tbody>
        </table>
        {r.note && <p className="mt-2 text-slate-600">Note: {r.note}</p>}

        <p className="mt-4 text-xs text-slate-600">
          I confirm that I received the packages listed above in good order, and that they are returned to me.
        </p>
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">
            Received by (name, signature, date)
            {r.received_by_name && <span className="block text-sm text-slate-900">{r.received_by_name}</span>}
          </div>
          <div className="border-t border-slate-400 pt-1">
            Released by, staff (name, signature)
            {r.completed_by_name && <span className="block text-sm text-slate-900">{r.completed_by_name}</span>}
          </div>
        </div>
        {r.status === "completed" && r.completed_at && (
          <p className="mt-4 text-center text-xs text-slate-500">Handed over on {formatDate(r.completed_at)}</p>
        )}
      </div>

      {/* Hand-over confirmation, screen only */}
      {open && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden">
          <h2 className="text-base font-semibold">After the customer signs</h2>
          <p className="text-sm text-slate-600">
            Print the form, hand over the packages and have it signed. Then enter who received them and mark the return as done.
          </p>
          <input
            className={inputClass}
            placeholder="Name of the person who received the packages"
            aria-label="Received by"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
          />
          <ErrorMessage message={error} />
          <div className="flex gap-2">
            <Button onClick={complete} disabled={busy || !receivedBy.trim()}>
              <CheckCircle2 className="h-4 w-4" /> Mark returned (signed)
            </Button>
            <Button variant="secondary" onClick={cancel} disabled={busy}>
              Cancel return
            </Button>
          </div>
        </div>
      )}
      {!open && <ErrorMessage message={error} />}
    </div>
  );
}
