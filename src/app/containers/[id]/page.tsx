"use client";

import BookingLink from "@/components/bookings/BookingLink";
import { useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { CheckCheck, MapPinCheck, PackagePlus, Pencil, Rocket, ScanLine, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import ListSearch from "@/components/ui/ListSearch";
import { matchesSearch } from "@/lib/search";
import CameraScanner from "@/components/scan/CameraScanner";
import { Button, Card, ErrorMessage, StatusBadge, inputClass, Loading } from "@/components/ui/form";
import { dateArg, formatDay, todayISO } from "@/lib/format";
import DateField from "@/components/ui/DateField";
import { useDay, useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";
import type { Container, Parcel } from "@/lib/types";
import { askText, confirmAction } from "@/lib/ask";
import BackLink from "@/components/ui/BackLink";

type WarehouseParcel = Parcel & { warehouse: { code: string; name?: string } | null; booking: { code: string; invoice_no: string | null; sender_name: string } | null };
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
    supabase.from("parcels").select("*, warehouse:warehouses(code, name), booking:bookings(code, invoice_no, sender_name)").eq("status", "in_warehouse").order("barcode")
  );

  // Per booking: how many of its parcels are in this container, and which are still in the warehouse.
  const check = useQuery<CheckRow[]>(() => supabase.rpc("container_check", { p_container_id: id }) as never);

  const [selected, setSelected] = useState<string[]>([]);
  const [find, setFind] = useState("");
  // Real dates: left as today, nothing special happens. Pick an earlier day when entering an old shipment.
  const [departDate, setDepartDate] = useDay(id);
  const [loadDate, setLoadDate] = useDay(id);
  const [arriveDate, setArriveDate] = useDay(id);
  const [delivering, setDelivering] = useState<{ id: string; partner: string; tracking: string; date: string } | null>(null);
  const partners = useQuery<{ delivery_partner: string | null }[]>(() => supabase.from("parcels").select("delivery_partner").limit(500));
  const partnerNames = [...new Set((partners.data ?? []).map((p) => p.delivery_partner).filter((n): n is string => !!n))].sort();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  // When "payment before loading" is on, a manager can load anyway by giving a reason. The reason is remembered
  // for the same booking while this page stays open, so a batch of parcels asks once.
  const overrides = useRef<Record<string, string>>({});

  const c = container.data;
  if (container.loading) return <Loading />;
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
      supabase.rpc("load_parcel", { p_container_id: id, p_barcode: barcode, p_override_reason: reason ?? overrides.current[code] ?? null, p_date: dateArg(loadDate) });
    let { error } = await attempt();

    const needsPayment = error?.message.match(/^PAYMENT_REQUIRED (\S+) : (.*)$/);
    if (needsPayment) {
      const [, booking, why] = needsPayment;
      const stop = { message: `${booking} is not fully paid (${why}). Not loaded. Payment is required first.` };
      if (can("containers.override_payment")) {
        const reason = await askText({
          title: `${booking} is not fully paid`,
          message: `${why}\n\nTo load it anyway, type the reason. It is recorded on the booking.`,
          field: { label: "Reason", multiline: true },
          confirmLabel: "Load anyway",
          danger: true,
        });
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
    if (!(await confirmAction({ title: `Depart ${c!.code}?`, message: `All ${loaded.data?.length} loaded parcels will be marked In transit.`, confirmLabel: "Depart" }))) return;
    let { error } = await supabase.rpc("depart_container", { p_container_id: id, p_date: dateArg(departDate) });

    // Parcels of an invoice are still in the warehouse: only an authorised person can send it anyway, with a reason.
    const missing = error?.message.match(/^PARCELS_MISSING : (.*)$/);
    if (missing) {
      const detail = (check.data ?? [])
        .filter((r) => r.missing.length)
        .map((r) => `${r.invoice_no ?? r.booking_code}: ${r.loaded} of ${r.expected} loaded, missing ${r.missing.join(", ")}`)
        .join("\n");
      if (can("containers.override_departure")) {
        const reason = await askText({
          title: "Parcels are missing",
          message: `${detail}\n\nTo send the container anyway, type the reason. It is recorded on each booking.`,
          field: { label: "Reason", multiline: true },
          confirmLabel: "Depart anyway",
          danger: true,
        });
        if (reason?.trim()) ({ error } = await supabase.rpc("depart_container", { p_container_id: id, p_override_reason: reason.trim(), p_date: dateArg(departDate) }));
        else error = { message: `Not departed. Parcels missing: ${missing[1]}.` } as typeof error;
      } else {
        error = { message: `Not departed. Parcels missing: ${missing[1]}. Only a manager can send a container with missing parcels.` } as typeof error;
      }
    }
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Container departed" });
    refresh();
  }

  async function arrive() {
    if (!(await confirmAction({ title: `Mark ${c!.code} as arrived?`, message: "It has reached its destination.", confirmLabel: "Yes, arrived" }))) return;
    const { error } = await supabase.rpc("arrive_container", { p_container_id: id, p_date: dateArg(arriveDate) });
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Container arrived" });
    refresh();
  }

  async function deliver() {
    const d = delivering!;
    const { error } = await supabase.rpc("deliver_parcel", {
      p_parcel_id: d.id,
      p_partner: d.partner || null,
      p_tracking: d.tracking || null,
      p_date: dateArg(d.date),
    });
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: "Marked as delivered" });
    if (!error) setDelivering(null);
    refresh();
  }

  /** Changes the container number. Parcels point at the container itself, so loaded parcels and labels are not affected. */
  async function rename() {
    const typed = await askText({
      title: `Rename container ${c!.code}`,
      message: "Type the new container number, for example 38 or CN-120. Loaded parcels stay in this container.",
      field: { label: "Container number", placeholder: c!.code },
      confirmLabel: "Save",
    });
    const code = typed?.trim().toUpperCase();
    if (!code || code === c!.code) return;
    const { error } = await supabase.from("containers").update({ code }).eq("id", id);
    setMessage(error ? { ok: false, text: error.code === "23505" ? "That container number is already used." : error.message } : { ok: true, text: `Renamed to ${code}` });
    refresh();
  }

  return (
    <div className="max-w-4xl space-y-4">
      <BackLink href="/containers">Containers</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={`Container ${c.code}`}
          description={[
            c.destination ?? "No destination set",
            c.departed_at ? `Departed ${formatDay(c.departed_at.slice(0, 10))}` : null,
            c.arrived_at ? `Arrived ${formatDay(c.arrived_at.slice(0, 10))}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={c.status} />
          {canOperate && (
            <Button variant="secondary" onClick={rename}>
              <Pencil className="h-4 w-4" /> Rename
            </Button>
          )}
        </div>
      </div>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Scan or type barcode">
            <DateField className="mb-3" label="Loading date (for parcels loaded now)" value={loadDate} onChange={setLoadDate} pastNote="Parcels you load now are dated then." />
            <Button size="large" className="mb-3" onClick={() => setCamera(true)}>
              <ScanLine className="h-6 w-6" aria-hidden="true" /> Scan with the camera
            </Button>
            <CameraScanner
              open={camera}
              continuous
              title="Load parcels"
              onClose={() => setCamera(false)}
              onCode={async (code) => {
                const ok = await load(code);
                refresh();
                return { ok, text: ok ? "loaded" : "not loaded (see the message below)" };
              }}
            />
            <form onSubmit={onScan} className="flex gap-2">
              <input ref={scanRef} placeholder="BK-1001-P1" aria-label="Parcel barcode to load" className={`${inputClass} font-mono`} />
              <Button type="submit" variant="secondary">
                <ScanLine className="h-4 w-4" aria-hidden="true" /> Load
              </Button>
            </form>
          </Card>

          <Card title="Select from warehouse">
            {!available.data?.length ? (
              <p className="text-sm text-slate-500">No parcels waiting in the warehouse.</p>
            ) : (
              <>
                <ListSearch value={find} onChange={setFind} placeholder="Invoice, barcode or name" className="mb-2 max-w-none sm:max-w-none" />
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm">
                  {available.data
                    .filter((p) => matchesSearch(find, [p.barcode, p.description, p.booking?.invoice_no, p.booking?.code, p.booking?.sender_name, p.warehouse?.name, p.warehouse?.code, p.position]))
                    .map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                        <input
                          type="checkbox"
                          className="h-6 w-6 shrink-0 accent-brand-600"
                          checked={selected.includes(p.barcode)}
                          onChange={(e) =>
                            setSelected(e.target.checked ? [...selected, p.barcode] : selected.filter((s) => s !== p.barcode))
                          }
                        />
                        <span className="font-mono">{p.barcode}</span>
                        <span className="text-slate-500">
                          {p.booking?.invoice_no ? `${p.booking.invoice_no} · ` : ""}
                          {p.warehouse?.name ?? p.warehouse?.code} · {Number(p.weight_kg)} kg
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
                  <BookingLink id={r.booking_id}>{r.invoice_no ?? r.booking_code}</BookingLink>{" "}
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
                  {p.status === "delivered" && (p.delivery_partner || p.delivery_tracking) && (
                    <span className="mt-0.5 block text-xs text-slate-600">
                      Delivered{p.delivery_partner ? ` by ${p.delivery_partner}` : ""}
                      {p.delivery_tracking ? ` · Tracking ${p.delivery_tracking}` : ""}
                      {p.delivered_at ? ` · ${formatDay(p.delivered_at.slice(0, 10))}` : ""}
                    </span>
                  )}
                  {delivering?.id === p.id && (
                    <span className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                      <input
                        list="delivery-partners"
                        className={inputClass}
                        placeholder="Delivered by (e.g. Leopards Courier)"
                        aria-label="Delivery partner"
                        value={delivering.partner}
                        onChange={(e) => setDelivering({ ...delivering, partner: e.target.value })}
                      />
                      <input
                        className={`${inputClass} font-mono`}
                        placeholder="Tracking number"
                        aria-label="Tracking number"
                        value={delivering.tracking}
                        onChange={(e) => setDelivering({ ...delivering, tracking: e.target.value })}
                      />
                      <input
                        type="date"
                        max={todayISO()}
                        className={inputClass}
                        aria-label="Delivery date"
                        value={delivering.date}
                        onChange={(e) => setDelivering({ ...delivering, date: e.target.value })}
                      />
                      <span className="flex gap-2">
                        <Button onClick={deliver}>Mark delivered</Button>
                        <Button variant="secondary" onClick={() => setDelivering(null)}>
                          Cancel
                        </Button>
                      </span>
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={p.status} />
                  {open && (
                    <button aria-label="Unload parcel" className="flex h-11 w-11 items-center justify-center" onClick={() => unload(p.id)}>
                      <X className="h-5 w-5 text-slate-600" />
                    </button>
                  )}
                  {canOperate && p.status === "arrived" && delivering?.id !== p.id && (
                    <Button variant="secondary" className="text-sm" onClick={() => setDelivering({ id: p.id, partner: "", tracking: "", date: todayISO() })}>
                      <CheckCheck className="h-3.5 w-3.5" /> Mark delivered
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <datalist id="delivery-partners">
          {partnerNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {open && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <DateField label="Departed on" value={departDate} onChange={setDepartDate} pastNote="The container is marked departed on that day." />
            <Button onClick={depart} disabled={!loaded.data?.length}>
              <Rocket className="h-4 w-4" /> Mark container departed
            </Button>
          </div>
        )}
        {canOperate && c.status === "departed" && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <DateField label="Arrived on" value={arriveDate} onChange={setArriveDate} pastNote="The container is marked arrived on that day." />
            <Button onClick={arrive}>
              <MapPinCheck className="h-4 w-4" /> Mark container arrived
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
