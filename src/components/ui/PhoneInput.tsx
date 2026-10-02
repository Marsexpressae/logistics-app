"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/form";
import { parsePhone } from "@/lib/phone";

type PhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
};

/**
 * One text box for a phone number. UAE is assumed, so "056 737 5716" is enough; start with + for another country.
 * It tidies the number when you leave the box and shows the exact number that will be saved.
 */
export default function PhoneInput({ value, onChange, required, disabled, ariaLabel }: PhoneInputProps) {
  const [touched, setTouched] = useState(false);
  const parsed = parsePhone(value);
  const invalid = value.trim() !== "" && !parsed;

  return (
    <div>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="off"
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={touched && invalid}
        value={value}
        placeholder="050 123 4567"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          if (parsed) onChange(parsed.display); // tidy up, e.g. 0567375716 -> +971 56 737 5716
        }}
        className={`${inputClass} ${touched && invalid ? "border-red-400" : ""}`}
      />
      {touched && invalid ? (
        <p className="mt-1 text-xs text-red-600">Not a valid number. UAE numbers like 050 123 4567, or start with + for another country.</p>
      ) : parsed ? (
        <p className="mt-1 text-xs text-green-700">Will be saved as {parsed.e164}</p>
      ) : null}
    </div>
  );
}
