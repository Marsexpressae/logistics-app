"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCheck, MapPinCheck, PackagePlus, Rocket, ScanLine, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, StatusBadge, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Container, Parcel } from "@/lib/types";

type WarehouseParcel = Parcel & { warehouse: { code: string } | null };
type CheckRow = { booking_id: string; booking_code: string; invoice_no: string | null; expected: number; loaded: number; missing: string[] };

export default function ContainerManifestPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const canOperate = can("containers.manage");
  const container = useQuery<Container>(() => supabase.from("containers").select("*").eq("id", id).single());
  const loaded = useQuery<Parcel[]>(() =>
    supabase.from("parcels").select("*").eq("container_id", id).order("barcode")
  );
  const available = useQuery<WarehouseParcel[]>(() =>
    supabase.from("parcels").select("*, warehouse:warehouses(code)").eq("status", "in_warehouse").order("barcode")
  );

  // Per booking: how many of its parcels are in this container, and which are still in the warehouse.
  const check = useQuery<CheckRow[]>(() => supabase.rpc("container_check", { p_container_id: id }) as never);

  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  // When "payment before loading" is on, a manager can load anyway by giving a reason. The reason is remembered
  // for the same booking while this page stays open, so a batch of parcels asks once.
  const overrides = useRef<Record<string, string>>({});

  const c = container.data;
  if (container.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!c) return <ErrorMessage message={container.error ?? "Container not found"} />;

  const open = c.status === "loading" && canOperate;

  const refresh = () => {
    container.reload();
    loaded.reload();
    available.reload();
    check.reload();
  };

  async function load(barcode: string) {
    const code = barcode.trim().toUpperCase().replace(/-(R\d+-)?P\d+$/, "");
    const attempt = (reason?: string) =>
      supabase.rpc("load_parcel", { p_container_id: id, p_barcode: barcode, p_override_reason: reason ?? overrides.current[code] ?? null });
    let { error } = await attempt();

    const needsPayment = error?.message.match(/^PAYMENT_REQUIRED (\S+) : (.*)$/);
    if (needsPayment) {
      const [, booking, why] = needsPayment;
      const stop = { message: `${booking} is not fully paid (${why}). Not loaded. Payment is required first.` };
      if (can("containers.override_payment")) {
        const reason = window.prompt(`${booking} is not fully paid (${why}).\n\nTo load it anyway, type the reason. It is recorded on the booking.`);
        if (reason?.trim()) {
          overrides.current[code] = reason.trim();
          ({ error } = await attempt(reason.trim()));
        } else {
          error = stop as typeof error;
        }
      } else {
        error = { message: stop.message + " Ask a manager." } as typeof error;
      }
    }
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: `Loaded ${barcode.toUpperCase()}` });
    return !error;
  }

  // Scanners behave like a keyboard: scan types the barcode then presses Enter.
  async function onScan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = scanRef.current!;
    const code = input.value.trim();
    if (!code) return;
    await load(code);
    input.value = "";
    input.focus();
    refresh();
  }

  async function loadSelected() {
    for (const code of selected) await load(code);
    setSelected([]);
    refresh();
  }

  async function unload(parcelId: string) {
    const { error } = await supabase.rpc("unload_parcel", { p_parcel_id: parcelId });
    setMessage(error ? { ok: false, text: error.message } : null);
    refresh();
  }

  async function depart() {
    if (!confirm(`Depart ${c!.code}? All ${loaded.data?.length} loaded parcels will be marked In transit.`)) return;
    let { error } = await supabase.rpc("depart_container", { p_container_id: id });

    // Parcels of an invoice are still in the warehouse: only an authorised person can send it anyway, with a reason.
    const missing = error?.message.match(/^PARCELS_MISSING : (.*)$/);
    if (missing) {
      const detail = (check.data ?? [])
        .filter((r) => r.missing.length)
        .map((r) => `${r.invoice_no ?? r.booking_code}: ${r.loaded} of ${r.expected} loaded, missing ${r.missing.join(", ")}`)
        .join("\n");
      if (can("containers.override_departure")) {
        const reason = window.prompt(`Parcels are missing:\n${detail}\n\nTo send the container anyway, type the reason. It is recorded on each booking.`);
        if (reason?.trim()) ({ error } = await supabase.rpc("depart_container", { p_container_id: id, p_override_reason: reason.trim() }));
        else error = { message: `Not departed. Parcels missing: ${missing[1]}.` } as typeof error;
      } else {
        error = { message: `Not departed. Parcels missing: ${missing[1]}. Only a manager can send a container with missing parcels.` } as typeof error;
      }
    }
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Container departed" });
    refresh();
  }

  async function arrive() {
    if (!confirm(`Mark ${c!.code} as arrived at its destination?`)) return;
    const { error } = await supabase.rpc("arrive_container", { p_container_id: id });
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Container arrived" });
    refresh();
  }

  async function deliver(parcelId: string) {
    const { error } = await supabase.rpc("deliver_parcel", { p_parcel_id: parcelId });
    setMessage(error ? { ok: false, text: error.message } : null);
    refresh();
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Link href="/containers" className="inline-flex items-center gap-1 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Containers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={`Container ${c.code}`} description={c.destination ?? "No destination set"} />
        <StatusBadge status={c.status} />
      </div>

      {message && (
        <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Scan or type barcode">
            <form onSubmit={onScan} className="flex gap-2">
              <input ref={scanRef} autoFocus placeholder="BK-1001-P1" className={`${inputClass} font-mono`} />
              <Button type="submit">
                <ScanLine className="h-4 w-4" /> Load
              </Button>
            </form>
          </Card>

          <Card title="Select from warehouse">
            {!available.data?.length ? (
              <p className="text-sm text-slate-500">No parcels waiting in the warehouse.</p>
            ) : (
              <>
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm">
                  {available.data.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(p.barcode)}
                          onChange={(e) =>
                            setSelected(e.target.checked ? [...selected, p.barcode] : selected.filter((s) => s !== p.barcode))
                          }
                        />
                        <span className="font-mono">{p.barcode}</span>
                        <span className="text-slate-500">
                          WH {p.warehouse?.code} · {Number(p.weight_kg)} kg
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button className="mt-3" onClick={loadSelected} disabled={!selected.length}>
                  <PackagePlus className="h-4 w-4" /> Load {selected.length || ""} selected
                </Button>
              </>
            )}
          </Card>
        </div>
      )}

      {!!check.data?.length && (
        <Card title="Check against invoices">
          <ul className="divide-y divide-slate-100 text-sm">
            {check.data.map((r) => (
              <li key={r.booking_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-mono font-medium">{r.invoice_no ?? r.booking_code}</span>{" "}
                  <span className={r.missing.length ? "font-medium text-amber-700" : "text-green-700"}>
                    {r.loaded} of {r.expected} parcels loaded
                  </span>
                </span>
                {r.missing.length > 0 && <span className="font-mono text-xs text-amber-700">Missing: {r.missing.join(", ")}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Manifest (${loaded.data?.length ?? 0} parcels)`}>
        {!loaded.data?.length ? (
          <p className="text-sm text-slate-500">Nothing loaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {loaded.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono font-medium">{p.barcode}</span>
                  <span className="ml-2 text-slate-500">
                    {p.description ?? ""} {Number(p.weight_kg)} kg
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={p.status} />
                  {open && (
                    <button aria-label="Unload parcel" onClick={() => unload(p.id)}>
                      <X className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                  {canOperate && p.status === "arrived" && (
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => deliver(p.id)}>
                      <CheckCheck className="h-3.5 w-3.5" /> Mark delivered
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <Button className="mt-4" onClick={depart} disabled={!loaded.data?.length}>
            <Rocket className="h-4 w-4" /> Mark container departed
          </Button>
        )}
        {canOperate && c.status === "departed" && (
          <Button className="mt-4" onClick={arrive}>
            <MapPinCheck className="h-4 w-4" /> Mark container arrived
          </Button>
        )}
      </Card>
    </div>
  );
}
