// Staff rewards, checked against the sample-data backend, which mirrors migration 0062
// (the same rules run against the real database in db-tests/rules.test.mts).
// People in the sample data: mock-user (super admin), sample-manager, sample-staff, sample-driver, and sample-warehouse (inactive).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient, freshMockData, setMockUser } from "../src/lib/mock-supabase.ts";
import { birthdayLabel, featureKeyFor, levelFor, newBadges, streakOf, type Level } from "../src/lib/rewards.ts";

const LEVELS: Level[] = [
  { number: 1, name: "Rookie", min_points: 0 },
  { number: 2, name: "Helper", min_points: 100 },
  { number: 3, name: "Handler", min_points: 300 },
];

test("levelFor: 0 points is the first level, a threshold moves up, the top level has no next", () => {
  assert.equal(levelFor(0, LEVELS).level.name, "Rookie");
  assert.equal(levelFor(99, LEVELS).level.name, "Rookie");
  assert.equal(levelFor(100, LEVELS).level.name, "Helper");
  assert.deepEqual([levelFor(150, LEVELS).toNext, levelFor(150, LEVELS).percent, levelFor(150, LEVELS).next?.name], [150, 25, "Handler"]);
  const top = levelFor(5000, LEVELS);
  assert.deepEqual([top.level.name, top.next, top.toNext, top.percent], ["Handler", null, 0, 100]);
});

test("streakOf: counts back from today or yesterday and stops at a gap", () => {
  assert.equal(streakOf(["2026-10-18", "2026-10-17", "2026-10-16"], "2026-10-18"), 3);
  assert.equal(streakOf(["2026-10-17", "2026-10-16"], "2026-10-18"), 2); // nothing yet today: the streak is still alive
  assert.equal(streakOf(["2026-10-18", "2026-10-15"], "2026-10-18"), 1);
  assert.equal(streakOf(["2026-10-15"], "2026-10-18"), 0);
  assert.equal(streakOf([], "2026-10-18"), 0);
  assert.equal(streakOf(["2026-02-28", "2026-03-01"], "2026-03-01"), 2); // across a month end
});

test("birthdayLabel: day and month, nothing when hidden or missing", () => {
  assert.equal(birthdayLabel(14, 3, false), "14 Mar");
  assert.equal(birthdayLabel(14, 3, true), null);
  assert.equal(birthdayLabel(null, 3, false), null);
  assert.equal(birthdayLabel(14, 13, false), null);
});

test("featureKeyFor: pages count as features, other pages do not", () => {
  assert.equal(featureKeyFor("/bookings"), "use_bookings");
  assert.equal(featureKeyFor("/bookings/abc"), "use_bookings");
  assert.equal(featureKeyFor("/warehouse-inventory/labels"), "use_warehouse");
  assert.equal(featureKeyFor("/search"), "use_search");
  assert.equal(featureKeyFor("/"), null);
  assert.equal(featureKeyFor("/bookings-archive"), null);
  assert.equal(featureKeyFor("/account"), null);
});

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (name: string, args?: R): Promise<{ data: any; error: { message: string } | null }> => c.rpc(name, args); // eslint-disable-line @typescript-eslint/no-explicit-any
const fresh = (who = "mock-user") => { freshMockData(); setMockUser(who); };
const newBooking = (name = "Rewards Test") => c.from("bookings").insert({ sender_name: name, sender_phone: "+971500000777", pickup_area: "Dubai", pickup_address: "Somewhere", pickup_date: "2026-10-18" }).select("*").single();
const mine = async (): Promise<R> => (await rpc("my_rewards")).data;

test("mock: a booking pays its creator 5 points, once", async () => {
  fresh();
  const { data: b } = await newBooking();
  assert.equal((await mine()).total, 7); // 5 for the booking and 2 for being active today
  assert.equal((await mine()).level_name, "Rookie");
  const booked = ((await c.from("point_log").select("*")).data as R[]).filter((l) => l.rule_key === "booking_created");
  assert.equal(booked.length, 1);
  assert.match(booked[0].reason, new RegExp(b.code));
});

test("mock: nothing is paid to an inactive person", async () => {
  fresh("sample-warehouse"); // inactive
  await newBooking();
  assert.equal((await c.from("point_log").select("*")).data.length, 0);
});

test("mock: trying a feature pays once, unknown features are refused, active-today needs real work", async () => {
  fresh();
  assert.equal((await rpc("record_feature_use", { p_key: "use_bookings" })).data, 10);
  assert.equal((await rpc("record_feature_use", { p_key: "use_bookings" })).data, 0);
  assert.equal((await mine()).total, 10);
  assert.match((await rpc("record_feature_use", { p_key: "booking_created" })).error?.message ?? "", /Unknown feature/);
  await newBooking(); // +5
  await rpc("record_feature_use", { p_key: "use_scan" }); // +10, then active-today +2
  assert.equal((await mine()).total, 27);
  await rpc("record_feature_use", { p_key: "use_scan" });
  assert.equal((await mine()).total, 27);
});

test("mock: thank-yous need the permission, a message, another person, and respect the monthly limits", async () => {
  fresh("sample-manager");
  const thank = (points: number, message: string, person = "sample-staff") => rpc("give_thank_you", { p_person: person, p_points: points, p_message: message });
  assert.equal((await thank(20, "Great job on the late rush")).error, null);
  assert.match((await thank(5, "me", "sample-manager")).error?.message ?? "", /yourself/);
  assert.match((await thank(5, "  ")).error?.message ?? "", /message/i);
  assert.match((await thank(0, "x")).error?.message ?? "", /between 1 and 100/);
  assert.match((await thank(101, "x")).error?.message ?? "", /between 1 and 100/);
  assert.match((await thank(5, "x", "sample-warehouse")).error?.message ?? "", /not active/);
  for (let i = 0; i < 9; i++) assert.equal((await thank(1, `thanks ${i}`)).error, null); // ten in all
  assert.match((await thank(1, "eleventh")).error?.message ?? "", /thank-yous for this month/);
  setMockUser("sample-staff");
  assert.equal((await mine()).total, 29);
  assert.match((await rpc("give_thank_you", { p_person: "sample-manager", p_points: 5, p_message: "hi" })).error?.message ?? "", /permission/i);
});

test("mock: badges by hand, count badges for the right team, progress for locked ones, and the wins feed", async () => {
  fresh();
  assert.equal((await rpc("set_staff_details", { p_person_id: "mock-user", p_team: "sales", p_job_title: "Sales rep", p_joined_on: null })).error, null);
  await newBooking();
  const badges = (await rpc("my_badges")).data as R[];
  const byKey = Object.fromEntries(badges.map((b) => [b.key, b]));
  assert.ok(byKey.first_booking.earned_at, "first booking earned");
  assert.equal(byKey.bookings_100.earned_at, null);
  assert.deepEqual([byKey.bookings_100.progress, byKey.bookings_100.goal], [1, 100]);
  assert.ok(!byKey.pickups_100, "pickup badges are not shown to the sales team");
  assert.match((await rpc("give_badge", { p_person: "mock-user", p_badge: "team_player", p_message: "Me" })).error?.message ?? "", /yourself/);
  assert.match((await rpc("give_badge", { p_person: "sample-staff", p_badge: "bookings_100", p_message: "x" })).error?.message ?? "", /by hand/);
  assert.equal((await rpc("give_badge", { p_person: "sample-staff", p_badge: "team_player", p_message: "Stayed late" })).error, null);
  assert.match((await rpc("give_badge", { p_person: "sample-staff", p_badge: "team_player", p_message: "again" })).error?.message ?? "", /already/);
  await rpc("give_thank_you", { p_person: "sample-staff", p_points: 10, p_message: "Thanks" });
  const feed = (await rpc("wins_feed", { p_limit: 20 })).data as R[];
  assert.deepEqual(feed.map((f) => f.kind).sort(), ["badge", "badge", "thank_you"]);
  assert.ok(feed.every((f) => !("points" in f) && !("phone" in f)));
  setMockUser("sample-staff");
  assert.match((await rpc("give_badge", { p_person: "mock-user", p_badge: "team_player", p_message: "x" })).error?.message ?? "", /permission/i);
});

test("mock: profiles - own fields only, a hidden birthday and other people's phone stay hidden", async () => {
  fresh("sample-staff");
  assert.equal((await rpc("update_my_profile", { p_photo_path: null, p_birthday_day: 14, p_birthday_month: 3, p_hide_birthday: true, p_about: "Loves forklifts", p_phone: "+971500000001" })).error, null);
  assert.match((await rpc("update_my_profile", { p_photo_path: null, p_birthday_day: 31, p_birthday_month: 2, p_hide_birthday: false, p_about: null, p_phone: null })).error?.message ?? "", /birthday/i);
  assert.match((await rpc("update_my_profile", { p_photo_path: null, p_birthday_day: null, p_birthday_month: null, p_hide_birthday: false, p_about: "x".repeat(201), p_phone: null })).error?.message ?? "", /200/);
  assert.match((await rpc("update_my_profile", { p_photo_path: "someone-else/me.jpg", p_birthday_day: null, p_birthday_month: null, p_hide_birthday: false, p_about: null, p_phone: null })).error?.message ?? "", /own folder/);
  const look = async (who: string, id: string) => {
    setMockUser(who);
    const row = ((await rpc("people_directory")).data as R[]).find((p) => p.id === id)!;
    return [row.birthday_day, row.birthday_month, row.phone];
  };
  assert.deepEqual(await look("sample-manager", "sample-staff"), [null, null, "+971500000001"]); // managers see the phone, never a hidden birthday
  assert.deepEqual(await look("sample-driver", "sample-staff"), [null, null, null]);
  assert.deepEqual(await look("sample-staff", "sample-staff"), [14, 3, "+971500000001"]);
  setMockUser("sample-staff");
  assert.match((await rpc("set_staff_details", { p_person_id: "sample-staff", p_team: "sales", p_job_title: "x", p_joined_on: null })).error?.message ?? "", /permission/i);
  setMockUser("sample-manager");
  assert.match((await rpc("set_staff_details", { p_person_id: "sample-staff", p_team: "pirates", p_job_title: null, p_joined_on: null })).error?.message ?? "", /team/i);
});

test("newBadges: the first visit announces nothing, later visits announce only badges not seen before", () => {
  const b = (key: string, earned: boolean) => ({ key, name: key, description: "", icon: "star", earned_at: earned ? "2026-10-18T10:00:00Z" : null, message: null, progress: null, goal: null });
  const first = newBadges(null, [b("a", true), b("b", false)]);
  assert.deepEqual([first.fresh, first.seenKeys], [[], ["a"]]);
  const later = newBadges(["a"], [b("a", true), b("b", true), b("c", false)]);
  assert.deepEqual([later.fresh.map((x) => x.key), later.seenKeys.sort()], [["b"], ["a", "b"]]);
  assert.deepEqual(newBadges(["a", "b"], [b("a", true)]).fresh, []);
});

test("mock: only managers of the rewards system change point values, levels and badges, and the values are checked", async () => {
  fresh("sample-staff");
  for (const [name, args] of [["save_point_rule", { p_key: "booking_created", p_points: 7, p_daily_cap: 40, p_active: true }], ["save_level", { p_number: 2, p_name: "Helper", p_min_points: 100 }], ["save_badge", { p_key: "team_player", p_name: "x", p_description: "x", p_active: true, p_threshold: null }]] as const) {
    assert.match((await rpc(name, args as R)).error?.message ?? "", /permission/i);
  }
  setMockUser("sample-manager");
  assert.equal((await rpc("save_point_rule", { p_key: "booking_created", p_points: 7, p_daily_cap: 40, p_active: true })).error, null);
  assert.equal(((await c.from("point_rules").select("*").eq("key", "booking_created").single()).data as R).points, 7);
  assert.match((await rpc("save_point_rule", { p_key: "booking_created", p_points: 1001, p_daily_cap: 40, p_active: true })).error?.message ?? "", /between 0 and 1000/);
  assert.match((await rpc("save_point_rule", { p_key: "booking_created", p_points: 5, p_daily_cap: -1, p_active: true })).error?.message ?? "", /cannot be negative/);
  assert.match((await rpc("save_point_rule", { p_key: "made_up", p_points: 5, p_daily_cap: null, p_active: true })).error?.message ?? "", /Rule not found/);
  assert.equal((await rpc("save_level", { p_number: 3, p_name: "Handler", p_min_points: 350 })).error, null);
  assert.match((await rpc("save_level", { p_number: 3, p_name: "Handler", p_min_points: 100 })).error?.message ?? "", /more points than the one before/);
  assert.match((await rpc("save_level", { p_number: 3, p_name: "Handler", p_min_points: 700 })).error?.message ?? "", /fewer points than the one after/);
  assert.match((await rpc("save_level", { p_number: 1, p_name: "Rookie", p_min_points: 5 })).error?.message ?? "", /starts at 0/);
  assert.match((await rpc("save_level", { p_number: 3, p_name: "  ", p_min_points: 350 })).error?.message ?? "", /name/i);
  assert.equal((await rpc("save_level", { p_number: 9, p_name: "Mythic", p_min_points: 20000 })).error, null);
  assert.equal(((await c.from("levels").select("*")).data as R[]).length, 9);
  assert.equal((await rpc("save_badge", { p_key: "bookings_100", p_name: "150 bookings", p_description: "Made 150 bookings", p_active: true, p_threshold: 150 })).error, null);
  assert.match((await rpc("save_badge", { p_key: "bookings_100", p_name: "x", p_description: "x", p_active: true, p_threshold: 0 })).error?.message ?? "", /more than 0/);
  assert.match((await rpc("save_badge", { p_key: "made_up", p_name: "x", p_description: "x", p_active: true, p_threshold: 5 })).error?.message ?? "", /Badge not found/);
});

// ---- fixes after the whole-branch review ----
test("mock: real work earns the active-today points straight away, once a day", async () => {
  fresh();
  await newBooking();
  await newBooking();
  assert.deepEqual(((await c.from("point_log").select("*")).data as R[]).map((l) => l.rule_key), ["booking_created", "active_today", "booking_created"]);
});

test("mock: only single-parcel moves pay, not a whole container being moved", async () => {
  fresh();
  const parcel = ((await c.from("parcels").select("*")).data as R[])[0];
  await c.from("parcels").update({ status: "in_transit" }).eq("id", parcel.id);
  assert.equal(((await c.from("point_log").select("*")).data as R[]).filter((l) => l.rule_key === "parcel_moved").length, 0);
  await c.from("parcels").update({ status: "delivered" }).eq("id", parcel.id);
  assert.equal(((await c.from("point_log").select("*")).data as R[]).filter((l) => l.rule_key === "parcel_moved").length, 1);
});

test("mock: other people do not see a colleague's point reasons, the person and managers do", async () => {
  fresh();
  await newBooking();
  const recent = async (who: string) => { setMockUser(who); return (await rpc("person_rewards", { p_person: "mock-user" })).data as R; };
  assert.ok((await recent("mock-user")).recent.length >= 1);
  assert.ok((await recent("sample-manager")).recent.length >= 1);
  assert.deepEqual((await recent("sample-staff")).recent, []);
  assert.equal((await recent("sample-staff")).total, 7);
});

test("mock: a person with no active profile reads nothing from the rewards functions", async () => {
  fresh("sample-warehouse"); // inactive
  assert.deepEqual((await rpc("people_directory")).data, []);
  assert.deepEqual((await rpc("wins_feed", { p_limit: 5 })).data, []);
  assert.match((await rpc("person_rewards", { p_person: "mock-user" })).error?.message ?? "", /not signed in/);
});
