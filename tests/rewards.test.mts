// Staff rewards, checked against the sample-data backend, which mirrors migration 0062
// (the same rules run against the real database in db-tests/rules.test.mts).
// People in the sample data: mock-user (super admin), sample-manager, sample-staff, sample-driver, and sample-warehouse (inactive).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient, freshMockData, setMockUser } from "../src/lib/mock-supabase.ts";
import { birthdayLabel, featureKeyFor, levelFor, streakOf, type Level } from "../src/lib/rewards.ts";

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
  assert.equal((await mine()).total, 5);
  assert.equal((await mine()).level_name, "Rookie");
  assert.equal((await c.from("point_log").select("*")).data.length, 1);
  assert.match((await c.from("point_log").select("*")).data[0].reason, new RegExp(b.code));
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
