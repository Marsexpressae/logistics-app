/* eslint-disable @typescript-eslint/no-explicit-any */
// Staff rewards for the sample-data backend. Mirrors migration 0062_staff_rewards.sql: the same rules and the same messages,
// so the screens behave the same with sample data as with the real database.
import { streakOf } from "./rewards.ts";

type Row = Record<string, any>;
type Result = { data: any; error: { message: string } | null };

const DUBAI = 4 * 3600_000;
const dayOf = (iso: string) => new Date(Date.parse(iso) + DUBAI).toISOString().slice(0, 10);
const stamp = () => new Date().toISOString();
const today = () => dayOf(stamp());
const sum = (rows: Row[]) => rows.reduce((n, r) => n + r.points, 0);
const fail = (message: string): Result => ({ data: null, error: { message } });
const ok = (data: any = null): Result => ({ data, error: null });

/** The starting rules, levels and badges: the same values the migration seeds. */
export function seedRewards(): Row {
  const rule = (key: string, label: string, kind: string, points: number, daily_cap: number | null, once_per_person: boolean) =>
    ({ key, label, kind, points, daily_cap, once_per_person, active: true });
  const badge = (key: string, name: string, description: string, icon: string, kind: string, rule_key: string | null, threshold: number | null, family: string | null = null, tier: number | null = null) =>
    ({ key, name, description, icon, team: null, kind, rule_key, threshold, family, tier, active: true });
  return {
    point_rules: [
      rule("booking_created", "Create a booking", "work", 5, 50, false),
      rule("pickup_collected", "Mark a pickup collected", "work", 5, 50, false),
      rule("payment_recorded", "Record a payment", "work", 3, 50, false),
      rule("parcel_moved", "Scan or move a parcel", "work", 1, 100, false),
      rule("active_today", "Use the app today", "daily", 2, null, false),
      ...([["bookings", "Try the Bookings page"], ["warehouse", "Try the Warehouse page"], ["scan", "Try scanning"], ["accounts", "Try the Accounts page"],
        ["customers", "Try the Customers page"], ["pickups", "Try the Pickups page"], ["activity", "Try the Activity page"], ["search", "Try the search"]] as const)
        .map(([k, label]) => rule(`use_${k}`, label, "explore", 10, null, true)),
    ],
    point_log: [],
    levels: [["Rookie", 0], ["Helper", 100], ["Handler", 300], ["Pro handler", 700], ["Specialist", 1500], ["Expert", 3000], ["Master", 6000], ["Legend", 12000]]
      .map(([name, min_points], i) => ({ number: i + 1, name, min_points })),
    badges: [
      badge("first_booking", "First booking", "Made your first booking", "file-plus", "count", "booking_created", 1, "bookings", 1),
      badge("bookings_10", "10 bookings", "Made 10 bookings", "file-plus", "count", "booking_created", 10, "bookings", 2),
      badge("bookings_50", "50 bookings", "Made 50 bookings", "file-plus", "count", "booking_created", 50, "bookings", 3),
      badge("bookings_100", "100 bookings", "Made 100 bookings", "package", "count", "booking_created", 100, "bookings", 4),
      badge("bookings_500", "500 bookings", "Made 500 bookings", "file-plus", "count", "booking_created", 500, "bookings", 5),
      badge("first_pickup", "First pickup", "Collected your first pickup", "truck", "count", "pickup_collected", 1, "pickups", 1),
      badge("pickups_10", "10 pickups", "Collected 10 pickups", "truck", "count", "pickup_collected", 10, "pickups", 2),
      badge("pickups_50", "50 pickups", "Collected 50 pickups", "truck", "count", "pickup_collected", 50, "pickups", 3),
      badge("pickups_100", "100 pickups", "Collected 100 pickups", "truck", "count", "pickup_collected", 100, "pickups", 4),
      badge("pickups_500", "500 pickups", "Collected 500 pickups", "truck", "count", "pickup_collected", 500, "pickups", 5),
      badge("payments_10", "10 payments", "Recorded 10 payments", "receipt", "count", "payment_recorded", 10, "payments", 1),
      badge("payments_50", "50 payments", "Recorded 50 payments", "receipt", "count", "payment_recorded", 50, "payments", 2),
      badge("payments_200", "200 payments", "Recorded 200 payments", "receipt", "count", "payment_recorded", 200, "payments", 3),
      badge("parcels_50", "50 parcels", "Moved or scanned 50 parcels", "scan", "count", "parcel_moved", 50, "parcels", 1),
      badge("parcels_250", "250 parcels", "Moved or scanned 250 parcels", "scan", "count", "parcel_moved", 250, "parcels", 2),
      badge("scan_master", "Scan master", "Moved or scanned 1,000 parcels", "scan", "count", "parcel_moved", 1000, "parcels", 3),
      badge("streak_3", "Three in a row", "Worked in the app 3 days in a row", "flame", "streak", null, 3, "streaks", 1),
      badge("streak_7", "Seven in a row", "Worked in the app 7 days in a row", "flame", "streak", null, 7, "streaks", 2),
      badge("streak_14", "Fortnight streak", "Worked in the app 14 days in a row", "flame", "streak", null, 14, "streaks", 3),
      badge("streak_30", "Month streak", "Worked in the app 30 days in a row", "flame", "streak", null, 30, "streaks", 4),
      badge("thanks_1", "Thanked", "Got your first thank-you", "heart", "count", "thank_you", 1, "appreciated", 1),
      badge("thanks_5", "Appreciated", "Got 5 thank-yous", "heart", "count", "thank_you", 5, "appreciated", 2),
      badge("thanks_20", "Much appreciated", "Got 20 thank-yous", "heart", "count", "thank_you", 20, "appreciated", 3),
      badge("explorer", "Explorer", "Tried every main page of the app", "compass", "count", "explore", null),
      badge("team_player", "Team player", "Given by a manager for helping out", "heart", "manual", null, null),
      badge("star_of_month", "Star of the month", "Given by a manager to the person who shone this month", "star", "manual", null, null),
    ],
    person_badges: [],
  };
}

const setting = (d: Row, key: string, fallback: number): number => {
  const s = d.app_settings.find((x: Row) => x.key === key);
  return s ? Number(s.value) : fallback;
};
const isWork = (d: Row, l: Row) => d.point_rules.find((r: Row) => r.key === l.rule_key)?.kind === "work";

export function currentStreak(d: Row, person: string): number {
  const days = d.point_log.filter((l: Row) => l.person_id === person && isWork(d, l)).map((l: Row) => dayOf(l.created_at));
  return streakOf(days, today());
}

/** How far a person is toward a badge: [progress, goal], or null for badges given by hand. */
function badgeProgress(d: Row, person: string, b: Row): [number, number] | null {
  if (b.kind === "streak") return [currentStreak(d, person), b.threshold];
  if (b.kind === "count" && b.rule_key === "explore") {
    const explore = d.point_rules.filter((r: Row) => r.kind === "explore" && r.active).map((r: Row) => r.key);
    const done = new Set(d.point_log.filter((l: Row) => l.person_id === person && explore.includes(l.rule_key)).map((l: Row) => l.rule_key));
    return [done.size, explore.length];
  }
  if (b.kind === "count") return [d.point_log.filter((l: Row) => l.person_id === person && l.rule_key === b.rule_key).length, b.threshold];
  return null;
}

function checkBadges(d: Row, person: string): void {
  if (!d.profiles.some((p: Row) => p.id === person && p.active)) return;
  for (const b of d.badges) {
    if (!b.active || b.kind === "manual") continue;
    if (d.person_badges.some((x: Row) => x.person_id === person && x.badge_key === b.key)) continue;
    const prog = badgeProgress(d, person, b);
    if (prog && prog[1] > 0 && prog[0] >= prog[1]) d.person_badges.push({ person_id: person, badge_key: b.key, earned_at: stamp(), given_by: null, message: null });
  }
}

/** Pay points for one rule, once per record, within the caps. Returns the points paid (0 when nothing was paid). */
export function awardPoints(d: Row, person: string | null, rule: string, sourceTable: string | null, sourceId: string | null, reason: string): number {
  if (!person || !d.profiles.some((p: Row) => p.id === person && p.active)) return 0;
  const r = d.point_rules.find((x: Row) => x.key === rule && x.active);
  if (!r || !r.points) return 0;
  const mine: Row[] = d.point_log.filter((l: Row) => l.person_id === person);
  if (r.once_per_person && mine.some((l) => l.rule_key === rule)) return 0;
  if (sourceId && mine.some((l) => l.rule_key === rule && l.source_table === sourceTable && l.source_id === sourceId)) return 0;
  const todays = mine.filter((l) => dayOf(l.created_at) === today());
  if (r.kind === "daily" && (todays.some((l) => l.rule_key === rule) || !todays.some((l) => isWork(d, l)))) return 0;
  if (r.daily_cap != null && sum(todays.filter((l) => l.rule_key === rule)) + r.points > r.daily_cap) return 0;
  if (r.kind === "work" && sum(todays.filter((l) => isWork(d, l))) + r.points > setting(d, "rewards_daily_cap", 100)) return 0;
  const id = d.point_log.reduce((n: number, l: Row) => Math.max(n, l.id), 0) + 1;
  d.point_log.push({ id, person_id: person, rule_key: rule, points: r.points, reason: reason.slice(0, 200), source_table: sourceTable, source_id: sourceId, given_by: null, created_at: stamp() });
  checkBadges(d, person);
  if (r.kind === "work") awardPoints(d, person, "active_today", "feature", null, "Used the app today");
  return r.points;
}

type Helpers = { db: () => Row; me: () => string; save: () => void };

/** The rewards functions, with the same names and arguments as the database functions. */
export function rewardsRpc({ db, me, save }: Helpers): Record<string, (a: any) => Result> {
  const can = (perm: string) => {
    const d = db();
    const p = d.profiles.find((x: Row) => x.id === me() && x.active);
    return !!p && d.role_permissions.some((rp: Row) => rp.role === p.role && rp.permission === perm);
  };
  const need = (perm: string): Result | null => (can(perm) ? null : fail("You do not have permission to do this"));
  const active = (id: string) => db().profiles.some((p: Row) => p.id === id && p.active);
  const signedIn = () => active(me());

  const personRewards = (person: string): Result => {
    const d = db();
    if (!signedIn()) return fail("You are not signed in");
    if (!active(person)) return fail("Person not found");
    const mine: Row[] = d.point_log.filter((l: Row) => l.person_id === person);
    const total = sum(mine);
    const levels: Row[] = [...d.levels].sort((a, b) => a.number - b.number);
    const lvl = [...levels].reverse().find((l) => l.min_points <= total) ?? levels[0];
    const nxt = levels.find((l) => l.min_points > total) ?? null;
    const mayRead = person === me() || can("rewards.manage");
    const recent = !mayRead ? [] : [...mine].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)).slice(0, 20)
      .map((l) => ({ points: l.points, reason: l.reason, created_at: l.created_at }));
    return ok({
      total, level_number: lvl.number, level_name: lvl.name, level_min: lvl.min_points,
      next_level_name: nxt?.name ?? null, next_min: nxt?.min_points ?? null,
      streak: currentStreak(d, person), today: sum(mine.filter((l) => dayOf(l.created_at) === today())), recent,
    });
  };

  const badgesOf = (person: string): Result => {
    const d = db();
    if (!signedIn()) return fail("You are not signed in");
    const prof = d.profiles.find((p: Row) => p.id === person && p.active);
    if (!prof) return fail("Person not found");
    const list = d.badges.flatMap((b: Row) => {
      const got = d.person_badges.find((x: Row) => x.person_id === person && x.badge_key === b.key);
      if (!got && !b.active) return [];
      const prog = got ? null : badgeProgress(d, person, b);
      return [{ key: b.key, name: b.name, description: b.description, icon: b.icon, family: b.family ?? null, tier: b.tier ?? null, earned_at: got?.earned_at ?? null, message: got?.message ?? null, progress: prog?.[0] ?? null, goal: prog?.[1] ?? null }];
    });
    list.sort((a: Row, b: Row) => (a.earned_at && b.earned_at ? (a.earned_at < b.earned_at ? 1 : -1) : a.earned_at ? -1 : b.earned_at ? 1 : a.name.localeCompare(b.name)));
    return ok(list);
  };

  return {
    update_my_profile({ p_photo_path, p_birthday_day, p_birthday_month, p_hide_birthday, p_about, p_phone }) {
      const d = db();
      const prof = d.profiles.find((p: Row) => p.id === me() && p.active);
      if (!prof) return fail("You are not signed in");
      if (p_photo_path != null && !String(p_photo_path).startsWith(`${me()}/`)) return fail("The photo must be in your own folder");
      if ((p_birthday_day == null) !== (p_birthday_month == null)) return fail("Enter both the day and the month of your birthday");
      if (p_birthday_day != null) {
        const t = new Date(Date.UTC(2024, p_birthday_month - 1, p_birthday_day));
        if (p_birthday_month < 1 || p_birthday_month > 12 || t.getUTCMonth() !== p_birthday_month - 1 || t.getUTCDate() !== p_birthday_day) return fail("That birthday is not a real date");
      }
      if (String(p_about ?? "").length > 200) return fail("Keep the about line under 200 characters");
      Object.assign(prof, {
        photo_path: p_photo_path ?? prof.photo_path ?? null,
        birthday_day: p_birthday_day ?? null, birthday_month: p_birthday_month ?? null, hide_birthday: !!p_hide_birthday,
        about: String(p_about ?? "").trim() || null, phone: String(p_phone ?? "").trim() || null,
      });
      save();
      return ok();
    },

    set_staff_details({ p_person_id, p_team, p_job_title, p_joined_on }) {
      const denied = need("users.manage");
      if (denied) return denied;
      if (p_team != null && !["sales", "pickup", "warehouse", "office"].includes(p_team)) return fail("Team must be sales, pickup, warehouse or office");
      const prof = db().profiles.find((p: Row) => p.id === p_person_id);
      if (!prof) return fail("Person not found");
      Object.assign(prof, { team: p_team ?? null, job_title: String(p_job_title ?? "").trim() || null, joined_on: p_joined_on ?? prof.joined_on ?? null });
      save();
      return ok();
    },

    people_directory() {
      if (!signedIn()) return ok([]);
      const seeAll = can("rewards.manage");
      return ok(db().profiles.filter((p: Row) => p.active).map((p: Row) => {
        const hide = !!p.hide_birthday && p.id !== me();
        return {
          id: p.id, full_name: p.full_name, role: p.role, team: p.team ?? null, job_title: p.job_title ?? null, about: p.about ?? null,
          photo_path: p.photo_path ?? null, joined_on: p.joined_on ?? null,
          birthday_day: hide ? null : p.birthday_day ?? null, birthday_month: hide ? null : p.birthday_month ?? null,
          hide_birthday: !!p.hide_birthday && p.id === me(),
          phone: p.id === me() || seeAll ? p.phone ?? null : null,
        };
      }));
    },

    record_feature_use({ p_key }) {
      const d = db();
      const r = d.point_rules.find((x: Row) => x.key === p_key && ["explore", "daily"].includes(x.kind) && x.active);
      if (!r) return fail("Unknown feature");
      const paid = awardPoints(d, me(), p_key, "feature", null, r.label);
      if (p_key !== "active_today") awardPoints(d, me(), "active_today", "feature", null, "Used the app today");
      save();
      return ok(paid);
    },

    give_thank_you({ p_person, p_points, p_message }) {
      const denied = need("rewards.give");
      if (denied) return denied;
      const d = db();
      if (p_person === me()) return fail("You cannot thank yourself");
      if (!String(p_message ?? "").trim()) return fail("Write a short message to go with the thank-you");
      if (p_points == null || p_points < 1 || p_points > 100) return fail("Give between 1 and 100 points");
      if (!active(p_person)) return fail("That person is not active");
      const month = today().slice(0, 7);
      const given: Row[] = d.point_log.filter((l: Row) => l.given_by === me() && l.rule_key === "thank_you" && dayOf(l.created_at).startsWith(month));
      if (given.length >= setting(d, "rewards_thank_you_monthly_count", 10)) return fail("You have used your thank-yous for this month");
      if (sum(given) + p_points > setting(d, "rewards_thank_you_monthly_points", 200)) return fail("That is more than your points for this month");
      const id = d.point_log.reduce((n: number, l: Row) => Math.max(n, l.id), 0) + 1;
      d.point_log.push({ id, person_id: p_person, rule_key: "thank_you", points: p_points, reason: String(p_message).trim().slice(0, 200), source_table: "thank_you", source_id: null, given_by: me(), created_at: stamp() });
      checkBadges(d, p_person);
      save();
      return ok();
    },

    give_badge({ p_person, p_badge, p_message }) {
      const denied = need("rewards.give");
      if (denied) return denied;
      const d = db();
      if (p_person === me()) return fail("You cannot give yourself a badge");
      if (!d.badges.some((b: Row) => b.key === p_badge && b.kind === "manual" && b.active)) return fail("That badge cannot be given by hand");
      if (!active(p_person)) return fail("That person is not active");
      if (d.person_badges.some((x: Row) => x.person_id === p_person && x.badge_key === p_badge)) return fail("They already have that badge");
      d.person_badges.push({ person_id: p_person, badge_key: p_badge, earned_at: stamp(), given_by: me(), message: String(p_message ?? "").trim().slice(0, 200) || null });
      save();
      return ok();
    },

    save_point_rule({ p_key, p_points, p_daily_cap, p_active }) {
      const denied = need("rewards.manage");
      if (denied) return denied;
      if (p_points == null || p_points < 0 || p_points > 1000) return fail("Points must be between 0 and 1000");
      if (p_daily_cap != null && p_daily_cap < 0) return fail("The daily limit cannot be negative");
      const r = db().point_rules.find((x: Row) => x.key === p_key);
      if (!r) return fail("Rule not found");
      Object.assign(r, { points: p_points, daily_cap: p_daily_cap ?? null, active: p_active ?? r.active });
      save();
      return ok();
    },

    save_level({ p_number, p_name, p_min_points }) {
      const denied = need("rewards.manage");
      if (denied) return denied;
      const d = db();
      if (!String(p_name ?? "").trim()) return fail("Give the level a name");
      if (p_number == null || p_number < 1) return fail("Level numbers start at 1");
      if (p_min_points == null || p_min_points < 0) return fail("Points cannot be negative");
      if (p_number === 1 && p_min_points !== 0) return fail("The first level starts at 0 points");
      if (d.levels.some((l: Row) => l.number < p_number && l.min_points >= p_min_points)) return fail("Each level needs more points than the one before it");
      if (d.levels.some((l: Row) => l.number > p_number && l.min_points <= p_min_points)) return fail("Each level needs fewer points than the one after it");
      const row = d.levels.find((l: Row) => l.number === p_number);
      if (row) Object.assign(row, { name: String(p_name).trim(), min_points: p_min_points });
      else d.levels.push({ number: p_number, name: String(p_name).trim(), min_points: p_min_points });
      save();
      return ok();
    },

    save_badge({ p_key, p_name, p_description, p_active, p_threshold }) {
      const denied = need("rewards.manage");
      if (denied) return denied;
      if (!String(p_name ?? "").trim()) return fail("Give the badge a name");
      if (p_threshold != null && p_threshold < 1) return fail("The goal must be more than 0");
      const b = db().badges.find((x: Row) => x.key === p_key);
      if (!b) return fail("Badge not found");
      Object.assign(b, { name: String(p_name).trim(), description: String(p_description ?? "").trim(), active: p_active ?? b.active, threshold: b.kind === "manual" ? null : (p_threshold ?? b.threshold) });
      save();
      return ok();
    },

    team_overview() {
      const d = db();
      if (!signedIn()) return ok([]);
      return ok(d.profiles.filter((p: Row) => p.active).map((p: Row) => {
        const tot = sum(d.point_log.filter((l: Row) => l.person_id === p.id));
        const levels: Row[] = [...d.levels].sort((a, b) => a.number - b.number);
        const lvl = [...levels].reverse().find((l) => l.min_points <= tot) ?? levels[0];
        return {
          id: p.id, full_name: p.full_name, photo_path: p.photo_path ?? null, job_title: p.job_title ?? null, team: p.team ?? null,
          level_number: lvl.number, level_name: lvl.name, streak: currentStreak(d, p.id),
          badge_count: d.person_badges.filter((x: Row) => x.person_id === p.id).length,
        };
      }).sort((a: Row, b: Row) => a.full_name.localeCompare(b.full_name)));
    },

    person_wins({ p_person, p_limit }) {
      const d = db();
      if (!signedIn() || !active(p_person)) return ok([]);
      const name = (id: string | null) => d.profiles.find((p: Row) => p.id === id)?.full_name;
      const badges = d.person_badges.filter((pb: Row) => pb.person_id === p_person).map((pb: Row) => ({
        kind: "badge", title: d.badges.find((b: Row) => b.key === pb.badge_key)?.name ?? pb.badge_key, message: pb.message ?? "", created_at: pb.earned_at,
      }));
      const thanks = d.point_log.filter((l: Row) => l.person_id === p_person && l.rule_key === "thank_you").map((l: Row) => ({
        kind: "thank_you", title: `Thanked by ${name(l.given_by) ?? "a colleague"}`, message: l.reason, created_at: l.created_at,
      }));
      return ok([...badges, ...thanks].sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, Math.min(Math.max(p_limit ?? 20, 1), 100)));
    },

    create_badge({ p_name, p_description, p_icon, p_family, p_tier, p_kind, p_rule_key, p_threshold }) {
      const denied = need("rewards.manage");
      if (denied) return denied;
      const d = db();
      const name = String(p_name ?? "").trim();
      const family = String(p_family ?? "").trim() || null;
      if (!name) return fail("Give the badge a name");
      if (d.badges.some((b: Row) => b.name.toLowerCase() === name.toLowerCase())) return fail("A badge with that name already exists");
      if (!["star", "file-plus", "package", "truck", "receipt", "scan", "flame", "compass", "heart", "trophy"].includes(p_icon)) return fail("Choose an icon from the list");
      if (!["count", "streak", "manual"].includes(p_kind)) return fail("Choose how the badge is earned");
      if (p_kind === "count" && !(p_rule_key === "thank_you" || d.point_rules.some((r: Row) => r.key === p_rule_key && r.kind === "work"))) return fail("Choose what is counted");
      if (p_kind !== "manual" && (p_threshold == null || p_threshold < 1)) return fail("The goal must be more than 0");
      if (p_tier != null && (p_tier < 1 || p_tier > 5)) return fail("The tier must be from 1 to 5");
      if (family && p_tier == null) return fail("Choose a tier for a badge in a family");
      if (family && p_tier != null && d.badges.some((b: Row) => b.family === family && b.tier === p_tier)) return fail("That tier is already taken in this family");
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "badge";
      let key = base;
      for (let n = 2; d.badges.some((b: Row) => b.key === key); n++) key = `${base}_${n}`;
      d.badges.push({ key, name, description: String(p_description ?? "").trim(), icon: p_icon, team: null, kind: p_kind, rule_key: p_kind === "count" ? p_rule_key : null,
        threshold: p_kind === "manual" ? null : p_threshold, family, tier: family ? (p_tier ?? null) : null, active: true });
      save();
      return ok(key);
    },

    // Celebrations (migration 0064): the same checks and messages as the database function.
    save_celebrations({ p_enabled, p_style, p_events }) {
      const denied = need("settings.manage");
      if (denied) return denied;
      if (p_enabled == null) return fail("Choose on or off");
      if (!["salvo", "confetti", "classic", "rings", "willow"].includes(p_style)) return fail("Choose a style from the list");
      const keys = ["booking_created", "pickup_collected", "intake_received", "invoice_raised"];
      const isObject = p_events && typeof p_events === "object" && !Array.isArray(p_events);
      if (!isObject || Object.keys(p_events).length !== 4 || !keys.every((k) => typeof p_events[k] === "boolean")) return fail("Each celebration needs an on or off choice");
      const row = db().app_settings.find((s: Row) => s.key === "celebrations");
      const value = { enabled: p_enabled, style: p_style, events: Object.fromEntries(keys.map((k) => [k, p_events[k]])) };
      if (row) Object.assign(row, { value, updated_at: new Date().toISOString() });
      else db().app_settings.push({ key: "celebrations", value, label: "Celebrations", description: "Fireworks when good work is done. Change them on the Celebrations card.", updated_at: new Date().toISOString() });
      save();
      return ok();
    },

    my_rewards: () => personRewards(me()),
    person_rewards: ({ p_person }) => personRewards(p_person),
    my_badges: () => badgesOf(me()),
    person_badges_of: ({ p_person }) => badgesOf(p_person),

    wins_feed(a) {
      if (!signedIn()) return ok([]);
      const d = db();
      const limit = Math.min(Math.max(a?.p_limit ?? 20, 1), 100);
      const name = (id: string | null) => d.profiles.find((p: Row) => p.id === id)?.full_name;
      const badges = d.person_badges.filter((pb: Row) => active(pb.person_id)).map((pb: Row) => ({
        kind: "badge", person_id: pb.person_id, person_name: name(pb.person_id), title: d.badges.find((b: Row) => b.key === pb.badge_key)?.name ?? pb.badge_key, message: pb.message ?? "", created_at: pb.earned_at,
      }));
      const thanks = d.point_log.filter((l: Row) => l.rule_key === "thank_you" && active(l.person_id)).map((l: Row) => ({
        kind: "thank_you", person_id: l.person_id, person_name: name(l.person_id), title: `Thanked by ${name(l.given_by) ?? "a colleague"}`, message: l.reason, created_at: l.created_at,
      }));
      return ok([...badges, ...thanks].sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, limit));
    },
  };
}
