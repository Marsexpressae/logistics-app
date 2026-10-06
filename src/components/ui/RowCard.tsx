import Link from "next/link";
import type { ReactNode } from "react";

/** A list row for phones: one big card, and tapping anywhere on it opens the record. Wide screens keep the table. */
export default function RowCard({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="block min-h-20 rounded-lg border border-slate-300 bg-white p-4 active:bg-slate-50">
        {children}
      </Link>
    </li>
  );
}
