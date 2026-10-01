import type { Payment } from "./types";

export const money = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const totalPaid = (payments: Pick<Payment, "amount">[] = []) =>
  payments.reduce((sum, p) => sum + Number(p.amount), 0);

export const methodLabel = (m: string) => (m === "bank_transfer" ? "Bank transfer" : "Cash");
