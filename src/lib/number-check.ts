import { STATUS } from "./status.ts";

/** The booking that already has a number, as number_in_use() returns it. */
export type NumberUse = { id: string; code: string; status: string };
/** The answer for one typed value. `failed` = the question could not be asked (no network, no permission). */
export type NumberAnswer = { value: string; by: NumberUse | null; failed: boolean };
export type NumberCheck = { state: "idle" | "checking" | "free" | "taken" | "unknown"; by?: NumberUse };

/** What to show for the value in the box now, given the last answer (which may be for an older value). */
export function checkState(value: string, answer: NumberAnswer | null): NumberCheck {
  if (!value) return { state: "idle" };
  if (!answer || answer.value !== value) return { state: "checking" };
  if (answer.failed) return { state: "unknown" };
  return answer.by ? { state: "taken", by: answer.by } : { state: "free" };
}

export function takenMessage(kind: "booking" | "invoice", full: string, by: NumberUse): string {
  const status = STATUS[by.status]?.label ?? by.status;
  return kind === "booking"
    ? `${full} is already used by another booking (${status}). Choose another number.`
    : `Invoice ${full} is already used by booking ${by.code} (${status}). Choose another number.`;
}
