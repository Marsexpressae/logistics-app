import { parsePhoneNumberFromString } from "libphonenumber-js/min";

// Phone numbers are stored in international format (E.164), e.g. +971567375716.
// People type them many ways: "056 737 5716", "0567375716", "971567375716", "+92 300 1234567".
// UAE is the default country, so a local UAE number needs no country code.
const DEFAULT_COUNTRY = "AE";

export type ParsedPhone = { e164: string; display: string };

/** Understands what a person typed and returns the standard number, or null if it is not a real number. */
export function parsePhone(input: string | null | undefined): ParsedPhone | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  const parsed = parsePhoneNumberFromString(text, DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid()) return null;
  return { e164: parsed.number, display: parsed.formatInternational() };
}

/** A stored number shown nicely (+971 56 737 5716). Falls back to the raw text for old, unfixable values. */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  const parsed = parsePhoneNumberFromString(stored, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.formatInternational() : stored;
}

/** Digits only, as wa.me wants them (no +, spaces or dashes). */
const digitsOf = (n: string) => n.replace(/\D/g, "");

export const telLink = (e164: string) => `tel:${e164}`;
export const whatsappLink = (e164: string) => `https://wa.me/${digitsOf(e164)}`;

/** Which number WhatsApp should use: the separate one if there is one, otherwise the call number. */
export const whatsappNumber = (phone: string | null | undefined, whatsapp: string | null | undefined) =>
  whatsapp || phone || null;

/**
 * Search helper: "0567375716", "56 737 5716" and "+971567375716" all find the same stored number.
 * Ignores very short queries so a couple of digits do not match everything.
 */
export function phoneMatches(query: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const q = digitsOf(query).replace(/^00/, "").replace(/^0/, "");
  return q.length >= 4 && digitsOf(stored).includes(q);
}
