import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Ban, CheckCircle2, CircleDollarSign, Clock, Container, FileQuestion, PackageCheck, Truck, Undo2, Warehouse, type LucideIcon } from "lucide-react";
import { STATUS } from "@/lib/status";

export const inputClass =
  "min-h-11 w-full rounded-md border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 sm:min-h-10";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  /** large = one main action: full width, 56px tall, bigger text (for phones in the warehouse). */
  size?: "large";
};

const variants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

export function Button({ variant = "primary", size, className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 ${variants[variant]} ${size === "large" ? "min-h-14! w-full text-lg font-semibold" : ""} ${className}`}
    />
  );
}

// One icon per status, so it can be recognised without reading.
const STATUS_ICON: Record<string, LucideIcon> = {
  booked: Clock, collected: PackageCheck, repacked: PackageCheck, at_warehouse: Warehouse, in_warehouse: Warehouse,
  loaded: Container, in_transit: Truck, ready_for_return: Undo2, returned: CheckCircle2, cancelled: Ban, open: Clock,
  completed: CheckCircle2, delivered: CheckCircle2, loading: Container, departed: Truck, arrived: CheckCircle2,
  not_invoiced: FileQuestion, unpaid: CircleDollarSign, partial: CircleDollarSign, paid: CheckCircle2,
};

export function StatusBadge({ status, large = false }: { status: string; large?: boolean }) {
  const s = STATUS[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ${large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"} ${s.className}`}
    >
      {Icon && <Icon className={large ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />}
      {s.label}
    </span>
  );
}

export function Card({ title, children, className = "", id }: { title?: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

/** The one loading state: a short message that screen readers announce politely. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-slate-600">
      {label}
    </p>
  );
}
