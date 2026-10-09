"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/profile-context";

/**
 * A booking number that opens the booking. People who may not open bookings see plain text, so nobody lands on a screen
 * they cannot use. On paper it prints as normal text.
 */
export default function BookingLink({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const canOpen = usePermissions().can("bookings.view");
  if (!canOpen) return <span className={className}>{children}</span>;
  return (
    <Link href={`/bookings/${id}`} className={`inline-flex min-h-11 items-center font-mono font-medium text-brand-700 underline underline-offset-2 print:min-h-0 print:text-inherit print:no-underline ${className}`}>
      {children}
    </Link>
  );
}
