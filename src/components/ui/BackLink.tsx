import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** The "back to the list" link at the top of a detail page: 44px tall, easy to hit with a thumb. */
export default function BackLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center gap-1 text-base font-medium text-slate-700 ${className}`}>
      <ArrowLeft className="h-5 w-5" aria-hidden="true" /> {children}
    </Link>
  );
}
