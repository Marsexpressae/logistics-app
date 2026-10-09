"use client";

import { inputClass } from "@/components/ui/form";
import { formatDay, todayISO } from "@/lib/format";

/**
 * The one date box used wherever a real day is entered (collected, paid, received, loaded, departed, arrived).
 * It stops at today, and with `pastNote` it says out loud when the day is not today, so an old date left in the box
 * never quietly dates new work. Works controlled (value + onChange) or uncontrolled (name + defaultValue, inside a form).
 */
export default function DateField({
  label,
  value,
  onChange,
  name,
  defaultValue,
  pastNote,
  className = "",
}: {
  label: string;
  value?: string;
  onChange?: (day: string) => void;
  name?: string;
  defaultValue?: string;
  pastNote?: string;
  className?: string;
}) {
  const controlled = value !== undefined;
  const notToday = controlled && !!pastNote && !!value && value !== todayISO();
  return (
    <div className={className}>
      <label className="block text-sm">
        <span className="mb-1 block text-sm text-slate-600">{label}</span>
        <input
          type="date"
          name={name}
          max={todayISO()}
          {...(controlled ? { value, onChange: (e) => onChange?.(e.target.value) } : { defaultValue: defaultValue ?? todayISO() })}
          className={`${inputClass} w-auto`}
        />
      </label>
      {notToday && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Dated {formatDay(value!)}, not today. {pastNote}
          </span>
          <button type="button" onClick={() => onChange?.(todayISO())} className="min-h-11 font-medium underline">
            Back to today
          </button>
        </p>
      )}
    </div>
  );
}
