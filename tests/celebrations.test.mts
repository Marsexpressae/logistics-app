// Celebrations: the pure helpers, the event bus, and the sample-data backend (which mirrors migration 0064;
// the same rules run against the real database in db-tests/rules.test.mts).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient, freshMockData, setMockUser } from "../src/lib/mock-supabase.ts";
import { celebrate, onCelebrate } from "../src/lib/celebrate.ts";
import {
  COOLDOWN_MS, DEFAULT_CELEBRATIONS, DURATION_MS, STYLES, chooseStyle, invoiceJustRaised, isLightDevice, messageFor, normalizeCelebrations, shouldCelebrate, spawn,
  type CelebrationEvent, type StyleKey,
} from "../src/lib/celebrations.ts";

const ALL_ON = { enabled: true, style: "salvo" as StyleKey, events: { booking_created: true, pickup_collected: true, intake_received: true, invoice_raised: true } };

test("the defaults are on, triple salvo, all four events", () => {
  assert.deepEqual(DEFAULT_CELEBRATIONS, ALL_ON);
  assert.equal(COOLDOWN_MS, 4000);
  assert.equal(DURATION_MS, 2500);
});

test("normalizeCelebrations: anything missing or wrong falls back to the default for that part, and it never throws", () => {
  for (const bad of [null, undefined, "x", 5, [], true]) assert.deepEqual(normalizeCelebrations(bad), ALL_ON);
  assert.equal(normalizeCelebrations({ enabled: false }).enabled, false);
  assert.equal(normalizeCelebrations({ enabled: "no" }).enabled, true);
  assert.equal(normalizeCelebrations({ style: "confetti" }).style, "confetti");
  assert.equal(normalizeCelebrations({ style: "disco" }).style, "salvo");
  assert.deepEqual(normalizeCelebrations({ events: { booking_created: false, pickup_collected: "x", extra: false } }).events, { booking_created: false, pickup_collected: true, intake_received: true, invoice_raised: true });
  assert.deepEqual(normalizeCelebrations({ events: "all" }).events, ALL_ON.events);
  const good = { enabled: false, style: "willow", events: { booking_created: false, pickup_collected: true, intake_received: false, invoice_raised: true } };
  assert.deepEqual(normalizeCelebrations(good), good);
});

test("shouldCelebrate: the master switch, each event, and the device switch", () => {
  assert.equal(shouldCelebrate(ALL_ON, "booking_created", false), true);
  assert.equal(shouldCelebrate({ ...ALL_ON, enabled: false }, "booking_created", false), false);
  assert.equal(shouldCelebrate({ ...ALL_ON, events: { ...ALL_ON.events, pickup_collected: false } }, "pickup_collected", false), false);
  assert.equal(shouldCelebrate({ ...ALL_ON, events: { ...ALL_ON.events, pickup_collected: false } }, "booking_created", false), true);
  assert.equal(shouldCelebrate(ALL_ON, "invoice_raised", true), false);
});

test("styles: five of them, with the dot counts from the sample page", () => {
  assert.deepEqual(STYLES.map((s) => [s.key, s.label, s.cost]), [
    ["salvo", "Triple salvo", 210], ["confetti", "Confetti pop", 70], ["classic", "Classic burst", 110], ["rings", "Double ring", 96], ["willow", "Golden willow", 90],
  ]);
  assert.ok(STYLES.every((s) => s.description.length > 10));
});

test("chooseStyle: a light device gets the confetti pop in place of any style with more than 100 dots", () => {
  assert.equal(chooseStyle("salvo", true), "confetti");
  assert.equal(chooseStyle("classic", true), "confetti");
  assert.equal(chooseStyle("confetti", true), "confetti");
  assert.equal(chooseStyle("willow", true), "willow");
  assert.equal(chooseStyle("rings", true), "rings");
  assert.equal(chooseStyle("salvo", false), "salvo");
});

test("isLightDevice: few cores, little memory, or data saver", () => {
  assert.equal(isLightDevice({ hardwareConcurrency: 4 }), true);
  assert.equal(isLightDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), true);
  assert.equal(isLightDevice({ hardwareConcurrency: 8, deviceMemory: 8, connection: { saveData: true } }), true);
  assert.equal(isLightDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(isLightDevice({}), false);
});

test("spawn: exactly the style's dot count, all numbers finite, the salvo in three timed groups, the same seed gives the same dots", () => {
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const s of STYLES) {
    const dots = spawn(s.key, 400, 200, seeded(7));
    assert.equal(dots.length, s.cost, s.key);
    for (const d of dots) for (const n of [d.x, d.y, d.vx, d.vy, d.drag, d.g, d.life, d.fade, d.r, d.delay]) assert.ok(Number.isFinite(n), `${s.key} has a non-number`);
    assert.deepEqual(dots, spawn(s.key, 400, 200, seeded(7)));
  }
  const salvo = spawn("salvo", 400, 200, seeded(3));
  assert.deepEqual([0, 70, 140].map((i) => salvo[i].delay), [0, 450, 900]);
  assert.equal(new Set(salvo.slice(0, 70).map((d) => d.delay)).size, 1);
  assert.ok(spawn("confetti", 400, 200, seeded(3)).every((d) => d.rect === true), "confetti is paper");
  assert.ok(spawn("classic", 400, 200, seeded(3)).every((d) => d.delay === 0));
});

test("messageFor: a friendly line for each event, with the booking number when there is one", () => {
  const events: CelebrationEvent[] = ["booking_created", "pickup_collected", "intake_received", "invoice_raised"];
  assert.deepEqual(events.map((e) => messageFor(e)), ["Booking created. Nice work!", "Pickup collected. Great job!", "Intake received. Well done!", "Invoice raised. Nice one!"]);
  assert.equal(messageFor("booking_created", "BK-1234"), "Booking BK-1234 created. Nice work!");
  assert.equal(messageFor("pickup_collected", "BK-1234"), "Pickup collected. Great job!");
});

test("celebrate and onCelebrate: handlers hear the event, unsubscribe works, a failing handler hurts nobody", () => {
  const heard: string[] = [];
  const off = onCelebrate((e, d) => heard.push(`${e}:${d ?? ""}`));
  onCelebrate(() => { throw new Error("boom"); });
  celebrate("booking_created", "BK-1");
  celebrate("invoice_raised");
  assert.deepEqual(heard, ["booking_created:BK-1", "invoice_raised:"]);
  off();
  celebrate("pickup_collected");
  assert.equal(heard.length, 2);
  assert.doesNotThrow(() => celebrate("intake_received"));
});

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const c: any = createMockClient(); // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (name: string, args?: R): Promise<{ data: any; error: { message: string } | null }> => c.rpc(name, args); // eslint-disable-line @typescript-eslint/no-explicit-any
const EVENTS = { booking_created: true, pickup_collected: false, intake_received: true, invoice_raised: true };

test("mock: the default setting exists and only people who manage settings can save, with the same checks as the database", async () => {
  freshMockData();
  const row = ((await c.from("app_settings").select("*").eq("key", "celebrations").single()).data as R).value;
  assert.deepEqual(row, ALL_ON);
  setMockUser("sample-staff");
  assert.match((await rpc("save_celebrations", { p_enabled: true, p_style: "confetti", p_events: EVENTS })).error?.message ?? "", /permission/i);
  setMockUser("mock-user"); // the sample super admin
  assert.equal((await rpc("save_celebrations", { p_enabled: false, p_style: "confetti", p_events: EVENTS })).error, null);
  assert.deepEqual(((await c.from("app_settings").select("*").eq("key", "celebrations").single()).data as R).value, { enabled: false, style: "confetti", events: EVENTS });
  const refused = async (args: R, re: RegExp) => assert.match((await rpc("save_celebrations", { p_enabled: true, p_style: "salvo", p_events: EVENTS, ...args })).error?.message ?? "", re);
  await refused({ p_style: "disco" }, /Choose a style from the list/);
  await refused({ p_events: { booking_created: true, pickup_collected: true, intake_received: true } }, /on or off choice/);
  await refused({ p_events: { ...EVENTS, extra: true } }, /on or off choice/);
  await refused({ p_events: { ...EVENTS, invoice_raised: "yes" } }, /on or off choice/);
  await refused({ p_events: [] }, /on or off choice/);
  await refused({ p_enabled: null }, /Choose on or off/);
  assert.equal(((await c.from("app_settings").select("*").eq("key", "celebrations").single()).data as R).value.style, "confetti", "a refused save changes nothing");
});

test("invoiceJustRaised: only the first time an amount is saved", () => {
  assert.equal(invoiceJustRaised(null, 100), true);
  assert.equal(invoiceJustRaised(0, 100), true);
  assert.equal(invoiceJustRaised(undefined, 50), true);
  assert.equal(invoiceJustRaised(100, 200), false);
  assert.equal(invoiceJustRaised(100, null), false);
  assert.equal(invoiceJustRaised(null, null), false);
  assert.equal(invoiceJustRaised(null, 0), false);
  assert.equal(invoiceJustRaised(0, 0), false);
});
