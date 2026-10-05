"use client";

import { useState, type FormEvent } from "react";
import { Camera, IdCard as IdIcon } from "lucide-react";
import { Button, Card, ErrorMessage, Field, inputClass, Loading } from "@/components/ui/form";
import type { IdDocument } from "@/lib/customers";
import { formatDate } from "@/lib/format";
import { shrinkImage } from "@/lib/image";
import { useQuery } from "@/lib/hooks";
import { usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

/** Shows a stored ID photo through a short-lived private link. */
export function IdPhoto({ path }: { path: string }) {
  const url = useQuery<string>(
    async () => {
      const { data, error } = await supabase.storage.from("customer-ids").createSignedUrl(path, 600);
      return { data: data?.signedUrl ?? null, error };
    },
    [path]
  );
  if (url.error) return <p className="text-xs text-red-700">{url.error}</p>;
  if (!url.data) return <p className="text-xs text-slate-500">Loading photo…</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url.data} alt="Emirates ID" className="max-h-64 rounded-md border border-slate-200" />;
}

/**
 * The sender's Emirates ID number and photo, recorded by the driver at pickup (or by the office later).
 * The number also fills the customer record when it has none. Photos are private; managers can delete them, with a reason.
 */
export default function IdCard({ bookingId, onChanged }: { bookingId: string; onChanged?: () => void }) {
  const { can } = usePermissions();
  const canUse = can("customers.id_photo");
  const docs = useQuery<IdDocument[]>(
    () => (canUse ? (supabase.from("id_documents").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }) as never) : Promise.resolve({ data: [], error: null })),
    [bookingId, canUse]
  );
  const [eid, setEid] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canUse) return null;
  const list = docs.data ?? [];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!eid.trim() && !file) return setError("Enter the Emirates ID number, take a photo, or both.");
    if (eid.trim() && !/^784\D*\d{4}\D*\d{7}\D*\d$/.test(eid.trim())) return setError("An Emirates ID has 15 digits and starts with 784, for example 784-1990-1234567-1");
    setBusy(true);
    setError(null);
    let path: string | null = null;
    if (file) {
      try {
        const blob = await shrinkImage(file);
        path = `${bookingId}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("customer-ids").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
      } catch (err) {
        setBusy(false);
        return setError(`The photo could not be saved: ${(err as Error).message}`);
      }
    }
    const { error } = await supabase.from("id_documents").insert({ booking_id: bookingId, emirates_id: eid.trim() || null, photo_path: path });
    setBusy(false);
    if (error) return setError(error.message);
    setEid("");
    setFile(null);
    setFileKey((k) => k + 1);
    docs.reload();
    onChanged?.();
  }

  async function remove(d: IdDocument) {
    const reason = window.prompt("Why is this Emirates ID being deleted?");
    if (!reason) return;
    const { data, error } = await supabase.rpc("delete_id_document", { p_id: d.id, p_reason: reason });
    if (error) return setError(error.message);
    if (data) await supabase.storage.from("customer-ids").remove([data as string]);
    docs.reload();
    onChanged?.();
  }

  return (
    <Card title="Emirates ID">
      {list.map((d) => (
        <div key={d.id} className="mb-3 space-y-2 border-b border-slate-100 pb-3 text-sm">
          <p className="flex items-center gap-2">
            <IdIcon className="h-4 w-4 text-slate-400" />
            <span className="font-mono">{d.emirates_id ?? "Photo only"}</span>
          </p>
          {d.photo_path && <IdPhoto path={d.photo_path} />}
          <p className="text-xs text-slate-500">
            Added by {d.uploaded_by_name} · {formatDate(d.created_at)}
          </p>
          {can("customers.manage") && (
            <button type="button" onClick={() => remove(d)} className="text-xs font-medium text-red-700">
              Delete this ID record
            </button>
          )}
        </div>
      ))}
      {docs.loading && !docs.data && <Loading />}
      <form onSubmit={save} className="space-y-3">
        <Field label={list.length ? "Add another number or photo" : "Emirates ID number"}>
          <input value={eid} onChange={(e) => setEid(e.target.value)} placeholder="784-1990-1234567-1" inputMode="numeric" className={`${inputClass} font-mono`} />
        </Field>
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-700">
          <Camera className="h-4 w-4" />
          {file ? file.name : "Take or choose a photo of the ID"}
          <input key={fileKey} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <ErrorMessage message={error ?? docs.error} />
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}
