"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * A card whose body opens and closes, for long pages like Settings. The body stays on the page while closed (just hidden),
 * so anything typed into it is kept. `badge` shows a short note in the header, for example "2 unsaved".
 */
export default function CollapsibleCard({ title, children, defaultOpen = false, badge, className = "" }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      <h2 className="text-base font-semibold text-slate-900">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 w-full items-center gap-2 rounded-lg px-4 text-left"
        >
          {open ? <ChevronDown className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" /> : <ChevronRight className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />}
          <span className="flex-1">{title}</span>
          {badge}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
