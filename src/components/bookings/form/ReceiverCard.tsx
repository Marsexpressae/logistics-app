"use client";

import { Card, Field, inputClass } from "@/components/ui/form";
import type { CustomerHit, ReceiverEntry } from "@/lib/customers";

/** The receiver's name, and (for a picked customer) their saved receivers to tap. Phone and address come later with the invoice. */
export default function ReceiverCard({
  receiverName,
  picked,
  book,
  receiverPick,
  onPickReceiver,
}: {
  receiverName: { value: string; n: number };
  picked: CustomerHit | null;
  book: ReceiverEntry[];
  receiverPick: ReceiverEntry | null;
  onPickReceiver: (r: ReceiverEntry) => void;
}) {
  return (
    <Card title="Receiver (optional)">
      <div className="max-w-sm">
        <Field label="Name">
          <input key={`r${receiverName.n}`} name="receiver_name" defaultValue={receiverName.value} className={inputClass} />
        </Field>
      </div>
      {picked && book.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-600">{picked.full_name}&apos;s receivers. Tap one to fill the name, phone and address.</p>
          <div className="flex flex-wrap gap-2">
            {book.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onPickReceiver(r)}
                className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm ${receiverPick?.id === r.id ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white"}`}
              >
                <span className="font-medium">{r.name}</span>
                {r.address && <span className="block max-w-56 truncate text-xs text-slate-500">{r.address}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Phone and address are added later with the invoice and shipment details.</p>
    </Card>
  );
}
