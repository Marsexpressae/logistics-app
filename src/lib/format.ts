import type { Payment } from "./types";

export const money = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Rounds to 2 decimals, so sums like 0.1 + 0.2 do not show as 0.30000000000000004. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A weight for display: "80 kg", "12.5 kg". */
export const kg = (n: number) => `${round2(n)} kg`;

export const totalPaid = (payments: Pick<Payment, "amount">[] = []) =>
  round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));

/** Not invoiced / unpaid / partly paid / paid, from the invoice amount and what has been collected. */
export const invoiceStatus = (invoice: number | null, paid: number): "not_invoiced" | "unpaid" | "partial" | "paid" => {
  if (invoice === null) return "not_invoiced";
  const due = round2(Number(invoice) - paid);
  return due <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
};

export const methodLabel = (m: string) => (m === "bank_transfer" ? "Bank transfer" : "Cash");

/** Today as YYYY-MM-DD in the user's local time (what <input type="date"> uses). */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What to send to the database for a picked day: nothing when it is today (the database uses "now"), otherwise the day. */
export const dateArg = (day: string) => (day && day !== todayISO() ? day : null);

/**
 * The moment to save for a day somebody picked: now when it is today, otherwise noon on that day.
 * Used when entering old records, so the invoice, payment and history show the real day.
 */
export const dateStamp = (day: string) => (!day || day === todayISO() ? new Date().toISOString() : new Date(`${day}T12:00:00`).toISOString());

/** "Fri, 3 Oct 2026" from a YYYY-MM-DD date (parsed as local, so no timezone shift). */
export const formatDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Today / Overdue / Upcoming, used to flag pickups that need attention. */
export const dayState = (date: string): "today" | "overdue" | "upcoming" => {
  const t = todayISO();
  return date === t ? "today" : date < t ? "overdue" : "upcoming";
};
