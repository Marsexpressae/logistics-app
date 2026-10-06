import type { ButtonHTMLAttributes } from "react";

/** A filter / tab button: a finger-sized pill (44px tall) that says whether it is the selected one. */
export default function Chip({ active, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-pressed={active}
      className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium ${
        active ? "bg-blue-600 text-white" : "border border-slate-500 bg-white text-slate-800"
      } ${className}`}
    />
  );
}
