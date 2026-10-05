import { invoiceStatus, round2 } from "./format.ts"; // .ts so the tests can run this file directly

export type StatementBooking = {
  id: string;
  code: string;
  invoice_no: string | null;
  invoice_amount: number | null;
  pickup_date: string;
  status: string;
  payments?: { amount: number }[];
};

export type StatementRow = {
  id: string;
  ref: string;
  date: string;
  amount: number | null; // null = no invoice amount entered yet
  paid: number;
  balance: number | null;
  state: "not_invoiced" | "unpaid" | "partial" | "paid";
};

/**
 * A customer's statement: every invoice (cancelled bookings are left out), what was invoiced, what was paid, and what is still owed.
 * Invoices with no amount yet are listed but add nothing to the totals. Oldest first, like a bank statement.
 */
export function buildStatement(bookings: StatementBooking[]) {
  const rows: StatementRow[] = bookings
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.code.localeCompare(b.code))
    .map((b) => {
      const paid = round2((b.payments ?? []).reduce((s, p) => s + Number(p.amount), 0));
      const amount = b.invoice_amount === null || b.invoice_amount === undefined ? null : Number(b.invoice_amount);
      return {
        id: b.id,
        ref: b.invoice_no ?? b.code,
        date: b.pickup_date,
        amount,
        paid,
        balance: amount === null ? null : round2(amount - paid),
        state: invoiceStatus(amount, paid),
      };
    });
  const invoiced = round2(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  const paid = round2(rows.reduce((s, r) => s + r.paid, 0));
  return { rows, invoiced, paid, outstanding: round2(invoiced - paid), withoutAmount: rows.filter((r) => r.amount === null).length };
}
