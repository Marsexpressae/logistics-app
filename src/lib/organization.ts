"use client";

import { useQuery } from "./hooks";
import { supabase } from "./supabase";

export type Organization = { legal_name: string; currency: string; country: string };

export const CURRENCIES = [
  { code: "AED", name: "UAE Dirham" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "KWD", name: "Kuwaiti Dinar" },
  { code: "OMR", name: "Omani Rial" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "INR", name: "Indian Rupee" },
] as const;

export const COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Oman",
  "Bahrain",
  "Pakistan",
  "India",
  "United Kingdom",
  "United States",
];

/** The organization's legal name, currency and country (one row). */
export function useOrganization() {
  const q = useQuery<Organization>(() => supabase.from("organization").select("legal_name, currency, country").maybeSingle());
  return { org: q.data, loading: q.loading, reload: q.reload, error: q.error };
}
