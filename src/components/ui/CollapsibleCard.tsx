"use client";

import type { ReactNode } from "react";
import Disclosure from "@/components/ui/Disclosure";

/**
 * A card whose body opens and closes, for long pages like Settings. The body stays on the page while closed (just hidden),
 * so anything typed into it is kept. `badge` shows a short note in the header, for example "2 unsaved".
 */
export default function CollapsibleCard({ title, children, defaultOpen = false, badge, className = "" }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode; className?: string }) {
  return (
    <Disclosure title={title} defaultOpen={defaultOpen} badge={badge} className={className}>
      {children}
    </Disclosure>
  );
}
