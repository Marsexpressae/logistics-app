"use client";

import CustomerPicker from "@/components/customers/CustomerPicker";
import PhoneInput from "@/components/ui/PhoneInput";
import { Field, inputClass } from "@/components/ui/form";
import type { CustomerHit } from "@/lib/customers";

export type SenderState = {
  name: { value: string; n: number }; // n changes to re-fill the name box when a customer is picked
  phone: string;
  sameWhatsapp: boolean;
  whatsapp: string;
};

/**
 * Who is sending. A new booking opens as a form (search an existing customer, or fill in a new one).
 * An existing booking with a customer shows nothing here: the Customer card above the form shows them once.
 * These are cells of the Card's grid, so the result is a fragment.
 */
export default function CustomerFields({
  onlyPickup,
  canPickCustomer,
  picked,
  onPick,
  onClearPicked,
  locked,
  sender,
  onPhone,
  onSameWhatsapp,
  onWhatsapp,
}: {
  onlyPickup: boolean;
  canPickCustomer: boolean;
  picked: CustomerHit | null;
  onPick: (c: CustomerHit) => void;
  onClearPicked: () => void;
  locked: boolean;
  sender: SenderState;
  onPhone: (v: string) => void;
  onSameWhatsapp: (v: boolean) => void;
  onWhatsapp: (v: string) => void;
}) {
  if (onlyPickup) return <input type="hidden" name="sender_name" value={sender.name.value} />;
  return (
    <>
      {canPickCustomer && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          {picked ? (
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Customer: <strong>{picked.full_name}</strong> ({picked.invoices} {picked.invoices === 1 ? "invoice" : "invoices"})
              </span>
              <button type="button" onClick={onClearPicked} className="font-medium text-brand-700">
                Not this customer
              </button>
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium text-slate-700">Existing customer? Search by mobile, name or an old invoice number.</p>
              <CustomerPicker onPick={onPick} />
              <p className="mt-2 text-xs text-slate-500">New customer? Just fill in the details below. They are saved as a customer automatically.</p>
            </>
          )}
        </div>
      )}
      <Field label="Name">
        <input
          key={`n${sender.name.n}`}
          name="sender_name"
          required
          readOnly={locked}
          defaultValue={sender.name.value}
          className={`${inputClass} ${locked ? "cursor-not-allowed bg-slate-100 text-slate-600" : ""}`}
        />
      </Field>
      <Field label="Phone">
        <PhoneInput value={sender.phone} onChange={onPhone} required disabled={locked} />
      </Field>
      <div className="sm:col-span-2">
        <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700">
          <input type="checkbox" checked={sender.sameWhatsapp} onChange={(e) => onSameWhatsapp(e.target.checked)} disabled={locked} className="h-5 w-5 accent-brand-600" />
          WhatsApp is the same number
        </label>
        {!sender.sameWhatsapp && (
          <div className="mt-3 max-w-sm">
            <Field label="WhatsApp number">
              <PhoneInput value={sender.whatsapp} onChange={onWhatsapp} disabled={locked} />
            </Field>
          </div>
        )}
      </div>
    </>
  );
}
