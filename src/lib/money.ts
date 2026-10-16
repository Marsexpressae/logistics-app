import type { Money, PayStatus } from "@/lib/types";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The money of one booking, worked out exactly like the database function money_of(). This copy serves the sample-data
 * layer; the real app reads the database. Only ACTIVE credits and refunds are passed in (a voided one counts for nothing).
 *
 * - invoice total now = the invoice amount minus the credits
 * - paid = payments received minus refunds handed back
 * - balance due = invoice total now minus paid (never below zero)
 * - refund due = paid minus invoice total now, when the customer paid more than they now owe
 */
export function moneyOf(input: { invoiceAmount: number | null; payments: number[]; credits: number[]; refunds: number[] }): Money {
  const sum = (list: number[]) => list.reduce((s, n) => s + n, 0);
  const paid = r2(sum(input.payments) - sum(input.refunds));
  if (input.invoiceAmount === null) return { invoice_now: null, paid, balance_due: null, refund_due: 0, pay_status: "not_invoiced" };
  const now = r2(input.invoiceAmount - sum(input.credits));
  const status: PayStatus = paid > now ? "refund_due" : now === 0 && paid === 0 ? "credited" : now - paid <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  return { invoice_now: now, paid, balance_due: Math.max(r2(now - paid), 0), refund_due: Math.max(r2(paid - now), 0), pay_status: status };
}
