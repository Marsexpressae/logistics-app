// Pure helpers for the staff rewards screens: levels, streaks, birthday text and which page counts as which feature.
// Imports use relative paths and no "@/" alias so node can run the tests directly.

export type Level = { number: number; name: string; min_points: number };

export type Rewards = {
  total: number;
  level_number: number;
  level_name: string;
  level_min: number;
  next_level_name: string | null;
  next_min: number | null;
  streak: number;
  today: number;
  recent?: { points: number; reason: string; created_at: string }[];
};

export type BadgeView = {
  key: string;
  name: string;
  description: string;
  icon: string;
  earned_at: string | null;
  message: string | null;
  progress: number | null;
  goal: number | null;
};

/** The level for a points total, the next one, and how far along the way the person is. Levels only ever go up. */
export function levelFor(total: number, levels: Level[]): { level: Level; next: Level | null; toNext: number; percent: number } {
  const sorted = [...levels].sort((a, b) => a.min_points - b.min_points);
  let level = sorted[0];
  for (const l of sorted) if (total >= l.min_points) level = l;
  const next = sorted.find((l) => l.min_points > total) ?? null;
  if (!next) return { level, next: null, toNext: 0, percent: 100 };
  const span = next.min_points - level.min_points;
  return { level, next, toNext: next.min_points - total, percent: Math.round(((total - level.min_points) / span) * 100) };
}

const DAY = 86400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);

/** Days in a row with real work, counted back from today (or from yesterday, if today has no work yet). */
export function streakOf(days: string[], today: string): number {
  const have = new Set(days.map(dayNumber));
  let cur = dayNumber(today);
  if (!have.has(cur)) cur -= 1;
  let n = 0;
  while (have.has(cur)) { n += 1; cur -= 1; }
  return n;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Mar", or nothing when there is no birthday or the person hides it. */
export function birthdayLabel(day: number | null | undefined, month: number | null | undefined, hidden: boolean): string | null {
  if (hidden || !day || !month || month < 1 || month > 12) return null;
  return `${day} ${MONTHS[month - 1]}`;
}

const FEATURES: [string, string][] = [
  ["/bookings", "use_bookings"],
  ["/warehouse-inventory", "use_warehouse"],
  ["/accounts", "use_accounts"],
  ["/customers", "use_customers"],
  ["/pickups", "use_pickups"],
  ["/activity", "use_activity"],
  ["/search", "use_search"],
];

/** Which "try a feature" rule a page counts for, or null for pages that do not count. */
export function featureKeyFor(pathname: string): string | null {
  for (const [prefix, key] of FEATURES) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  return null;
}

/** How far along to the next level, 0 to 100 (100 at the top level). */
export function progressPercent(r: { total: number; level_min: number; next_min: number | null }): number {
  if (r.next_min == null) return 100;
  return Math.round(((r.total - r.level_min) / (r.next_min - r.level_min)) * 100);
}

/** A colleague as the people directory returns them. Phone and a hidden birthday are already left out by the database. */
export type DirectoryPerson = {
  id: string;
  full_name: string;
  role: string;
  team: string | null;
  job_title: string | null;
  about: string | null;
  photo_path: string | null;
  joined_on: string | null;
  birthday_day: number | null;
  birthday_month: number | null;
  hide_birthday: boolean;
  phone: string | null;
};

export const TEAM_LABEL: Record<string, string> = { sales: "Sales", pickup: "Pickup", warehouse: "Warehouse", office: "Office" };
