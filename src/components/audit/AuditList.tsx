import { formatDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

export const TABLE_LABELS: Record<string, string> = {
  bookings: "Booking",
  booking_items: "Item",
  payments: "Payment",
  parcels: "Parcel",
  containers: "Container",
  drivers: "Driver",
  profiles: "User",
  role_permissions: "Role permission",
};

const humanize = (key: string) => key.replace(/_/g, " ");

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  // timestamps read like normal dates instead of 2026-10-02T13:48:02.432+00:00
  if (typeof v === "string" && ISO_DATETIME.test(v)) return formatDate(v);
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

// A one-line description of the row an insert/delete refers to.
function rowSummary(table: string, row: Record<string, unknown>): string {
  switch (table) {
    case "bookings":
      return `${row.code ?? ""} ${row.sender_name ?? ""}`.trim();
    case "booking_items":
      return `${row.quantity} × ${row.description} (${row.weight_kg} kg)`;
    case "payments":
      return `${row.amount} by ${String(row.method).replace("_", " ")}`;
    case "parcels":
      return String(row.barcode ?? "");
    case "containers":
      return String(row.code ?? "");
    case "drivers":
      return String(row.name ?? "");
    case "profiles":
      return `${row.full_name ?? ""} (${row.role})`;
    case "role_permissions":
      return `${row.role}: ${row.permission}`;
    default:
      return "";
  }
}

export function describe(e: AuditEntry): string[] {
  if (e.action === "update") {
    return Object.entries(e.changes).map(([field, v]) => {
      const { old, new: next } = v as { old: unknown; new: unknown };
      return `${humanize(field)}: ${show(old)} → ${show(next)}`;
    });
  }
  return [rowSummary(e.table_name, e.changes)];
}

const ACTION_STYLE = {
  insert: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-700",
} as const;

type AuditListProps = {
  entries: AuditEntry[];
  codes?: Record<string, string>; // booking id -> code, to label each row
};

export default function AuditList({ entries, codes }: AuditListProps) {
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[e.action]}`}>{e.action}</span>
            <span className="font-medium">{TABLE_LABELS[e.table_name] ?? e.table_name}</span>
            {e.booking_id && codes?.[e.booking_id] && (
              <span className="font-mono text-slate-600">{codes[e.booking_id]}</span>
            )}
            <span className="text-slate-500">
              by {e.actor_name || "system"} · {formatDate(e.changed_at)}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5 pl-1 text-slate-600">
            {describe(e).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
