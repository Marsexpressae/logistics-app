"use client";

import { Search } from "lucide-react";
import { inputClass } from "@/components/ui/form";

/** The search box used above every list: a magnifier and a text box. The list filters as you type. */
export default function ListSearch({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-48 flex-1 sm:max-w-xs ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} pl-9`}
      />
    </div>
  );
}
