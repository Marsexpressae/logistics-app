import { phoneMatches } from "./phone.ts"; // .ts so the tests can run this file directly

type Field = string | number | null | undefined;

/**
 * The same search everywhere. Several words narrow the result ("ismail 0567": every word must be found somewhere),
 * capitals do not matter, and a phone number matches however it was typed (0567375716, 56 737 5716, +971567375716).
 * An empty search matches everything.
 */
export function matchesSearch(text: string, fields: Field[], phones: Field[] = []): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const phone = (query: string, stored: Field) => phoneMatches(query, stored === null || stored === undefined ? null : String(stored));
  // the whole text as one number, spaces and all (only when it is made of digits, not mixed with words)
  if (/^[\d\s+()-]+$/.test(q) && phones.some((p) => phone(text, p))) return true;
  const haystack = fields.map((f) => String(f ?? "").toLowerCase());
  return q.split(/\s+/).every((word) => haystack.some((f) => f.includes(word)) || phones.some((p) => phone(word, p)));
}
