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

// Every country, named by the browser from its two-letter code. The ones this business uses most come first.
const CODES =
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" ");
const FIRST = ["United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Oman", "Bahrain", "Pakistan", "India"];

export const COUNTRIES: string[] = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const all = CODES.map((c) => names.of(c) ?? c).filter((n, i) => n && n !== CODES[i]);
  return [...FIRST, ...all.filter((n) => !FIRST.includes(n)).sort((x, y) => x.localeCompare(y))];
})();

/** The organization's legal name, currency and country (one row). */
export function useOrganization() {
  const q = useQuery<Organization>(() => supabase.from("organization").select("legal_name, currency, country").maybeSingle());
  return { org: q.data, loading: q.loading, reload: q.reload, error: q.error };
}
