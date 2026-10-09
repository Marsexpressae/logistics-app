"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * The one open/close pattern of the app, so every collapsible part behaves and looks the same.
 *
 * - `DisclosureButton` is just the header button: a chevron, an `aria-expanded` state, and a 44px tap height.
 *   Use it alone where the layout is not a div (for example a header row inside a table).
 * - `Disclosure` is a whole section: header button plus a body. The body stays on the page while closed (only hidden),
 *   so anything typed into it is kept.
 *
 * It works on its own (`defaultOpen`), or controlled by a parent (`open` + `onToggle`), for example "Open all groups".
 */
export function DisclosureButton({
  open,
  onToggle,
  controls,
  className = "",
  children,
}: {
  open: boolean;
  onToggle: () => void;
  controls?: string;
  className?: string;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className={`flex min-h-11 w-full items-center gap-2 text-left ${className}`}>
      <Chevron className="h-5 w-5 shrink-0 text-slate-600" aria-hidden="true" />
      {children}
    </button>
  );
}

export default function Disclosure({
  title,
  meta,
  badge,
  variant = "card",
  defaultOpen = false,
  open,
  onToggle,
  className = "",
  children,
}: {
  title: ReactNode;
  meta?: ReactNode; // quiet text on the right, for example "3 of 8 on"
  badge?: ReactNode; // a note that needs attention, for example "2 unsaved"
  variant?: "card" | "bar"; // card: the section is a card. bar: just a header bar, the body sits below it
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : inner;
  const toggle = () => (controlled ? onToggle?.() : setInner((o) => !o));
  const bodyId = useId();
  const card = variant === "card";
  return (
    <section className={`${card ? "rounded-lg border border-slate-200 bg-white" : ""} ${className}`}>
      <h2 className="text-base font-semibold text-slate-900">
        <DisclosureButton
          open={isOpen}
          onToggle={toggle}
          controls={bodyId}
          className={card ? "min-h-14 rounded-lg px-4" : "min-h-12 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold uppercase text-slate-600"}
        >
          <span className="flex-1">{title}</span>
          {meta && <span className="text-xs font-normal normal-case text-slate-600">{meta}</span>}
          {badge}
        </DisclosureButton>
      </h2>
      <div id={bodyId} hidden={!isOpen} className={card ? "px-4 pb-4" : "mt-1"}>
        {children}
      </div>
    </section>
  );
}
