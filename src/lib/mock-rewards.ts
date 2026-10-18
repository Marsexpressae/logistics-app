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
  const badge = (key: string, name: string, description: string, icon: string, team: string | null, kind: string, rule_key: string | null, threshold: number | null) =>
    ({ key, name, description, icon, team, kind, rule_key, threshold, active: true });
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
      badge("first_booking", "First booking", "Made your first booking", "file-plus", "sales", "count", "booking_created", 1),
      badge("bookings_100", "100 bookings", "Made 100 bookings", "package", "sales", "count", "booking_created", 100),
      badge("first_pickup", "First pickup", "Collected your first pickup", "truck", "pickup", "count", "pickup_collected", 1),
      badge("pickups_100", "100 pickups", "Collected 100 pickups", "truck", "pickup", "count", "pickup_collected", 100),
      badge("scan_master", "Scan master", "Moved or scanned 1,000 parcels", "scan", null, "count", "parcel_moved", 1000),
      badge("streak_7", "Seven in a row", "Worked in the app 7 days in a row", "flame", null, "streak", null, 7),
      badge("explorer", "Explorer", "Tried every main page of the app", "compass", null, "count", "explore", null),
      badge("team_player", "Team player", "Given by a manager for helping out", "heart", null, "manual", null, null),
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
  const prof = d.profiles.find((p: Row) => p.id === person && p.active);
  if (!prof) return;
  for (const b of d.badges) {
    if (!b.active || b.kind === "manual" || (b.team && b.team !== (prof.team ?? null))) continue;
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

  const personRewards = (person: string): Result => {
    const d = db();
    if (!active(person)) return fail("Person not found");
    const mine: Row[] = d.point_log.filter((l: Row) => l.person_id === person);
    const total = sum(mine);
    const levels: Row[] = [...d.levels].sort((a, b) => a.number - b.number);
    const lvl = [...levels].reverse().find((l) => l.min_points <= total) ?? levels[0];
    const nxt = levels.find((l) => l.min_points > total) ?? null;
    const recent = [...mine].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)).slice(0, 20)
      .map((l) => ({ points: l.points, reason: l.reason, created_at: l.created_at }));
    return ok({
      total, level_number: lvl.number, level_name: lvl.name, level_min: lvl.min_points,
      next_level_name: nxt?.name ?? null, next_min: nxt?.min_points ?? null,
      streak: currentStreak(d, person), today: sum(mine.filter((l) => dayOf(l.created_at) === today())), recent,
    });
  };

  const badgesOf = (person: string): Result => {
    const d = db();
    const prof = d.profiles.find((p: Row) => p.id === person && p.active);
    if (!prof) return fail("Person not found");
    const list = d.badges.flatMap((b: Row) => {
      const got = d.person_badges.find((x: Row) => x.person_id === person && x.badge_key === b.key);
      if (!got && !(b.active && (!b.team || b.team === (prof.team ?? null)))) return [];
      const prog = got ? null : badgeProgress(d, person, b);
      return [{ key: b.key, name: b.name, description: b.description, icon: b.icon, earned_at: got?.earned_at ?? null, message: got?.message ?? null, progress: prog?.[0] ?? null, goal: prog?.[1] ?? null }];
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

    my_rewards: () => personRewards(me()),
    person_rewards: ({ p_person }) => personRewards(p_person),
    my_badges: () => badgesOf(me()),
    person_badges_of: ({ p_person }) => badgesOf(p_person),

    wins_feed(a) {
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
