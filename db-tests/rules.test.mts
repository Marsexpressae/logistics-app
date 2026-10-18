// Tests of the REAL database rules (permissions, row security, triggers, functions), not the sample-data version.
//
// Every test runs inside one transaction that is always rolled back, with throwaway users created on the spot, so nothing
// is ever kept in the database. It needs the database address in SUPABASE_DB_URL (in .env.local, or set by CI);
// without it the tests are skipped. Run with:  npm run test:db
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

if (!process.env.SUPABASE_DB_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const URL = process.env.SUPABASE_DB_URL;
const skip = URL ? false : "SUPABASE_DB_URL is not set, so the real-database tests are skipped";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A connection inside a transaction that is rolled back at the end. */
async function inTransaction(fn: (db: Db) => Promise<void>) {
  const client = new pg.Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await fn(new Db(client));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

class Db {
  constructor(private c: pg.Client) {}

  /** Run as the database owner (no row security), for setting the scene. */
  async owner(sql: string, params: unknown[] = []): Promise<Row[]> {
    await this.c.query("reset role");
    // the owner is nobody in particular: forget any person a previous call signed in as
    await this.c.query("select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)");
    return (await this.c.query(sql, params)).rows;
  }

  /** Run as a signed-in person with the given role (row security and permissions apply, like the real app). */
  async as(userId: string, sql: string, params: unknown[] = []): Promise<Row[]> {
    await this.c.query("reset role");
    await this.c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
    await this.c.query("set local role authenticated");
    return (await this.c.query(sql, params)).rows;
  }

  /** Run as someone who is not signed in at all (the public internet). */
  async anonymous(sql: string, params: unknown[] = []): Promise<Row[]> {
    await this.c.query("reset role");
    await this.c.query("set local role anon");
    return (await this.c.query(sql, params)).rows;
  }

  /** The error message the database gives, or null if it let it through. The transaction survives. */
  async error(run: () => Promise<unknown>): Promise<string | null> {
    await this.c.query("savepoint attempt");
    try {
      await run();
      await this.c.query("release savepoint attempt");
      return null;
    } catch (e) {
      await this.c.query("rollback to savepoint attempt");
      await this.c.query("reset role");
      return (e as Error).message;
    }
  }

  /**
   * A throwaway role holding exactly these permissions. Roles are data that the owner edits on the Roles page, so the tests
   * never depend on how the real roles are set up: they create their own and check that the rules are enforced.
   */
  async role(permissions: string[]): Promise<string> {
    const key = `t_${Math.random().toString(36).slice(2, 10)}`;
    await this.owner("insert into roles (key, label, sort) values ($1, $1, 999)", [key]);
    for (const permission of permissions) await this.owner("insert into role_permissions (role, permission) values ($1, $2)", [key, permission]);
    return key;
  }

  /** A throwaway person who holds exactly these permissions. */
  async person(permissions: string[], name = "person"): Promise<string> {
    const role = await this.role(permissions);
    const id = (await this.owner("insert into auth.users (id) values (gen_random_uuid()) returning id"))[0].id as string;
    await this.owner("insert into profiles (id, full_name, role, active) values ($1, $2, $3, true)", [id, `Test ${name}`, role]);
    return id;
  }

  async booking(over: Row = {}): Promise<string> {
    const b = { sender_name: "Test Sender", sender_phone: "+971500000123", pickup_area: "Dubai", pickup_address: "Somewhere", ...over };
    const rows = await this.owner(
      "insert into bookings (sender_name, sender_phone, pickup_area, pickup_address, pickup_date, driver_id, invoice_no) values ($1, $2, $3, $4, current_date, $5, $6) returning id",
      [b.sender_name, b.sender_phone, b.pickup_area, b.pickup_address, b.driver_id ?? null, b.invoice_no ?? null]
    );
    return rows[0].id as string;
  }
}

test("the public internet can reach nothing except tracking", { skip }, async () => {
  await inTransaction(async (db) => {
    const id = await db.booking();
    assert.match((await db.error(() => db.anonymous("select * from bookings"))) ?? "", /permission denied/);
    assert.match((await db.error(() => db.anonymous("select * from customers"))) ?? "", /permission denied/);
    assert.match((await db.error(() => db.anonymous("select create_customer('X', null, null, null, null, null, null)"))) ?? "", /permission denied/);
    assert.match((await db.error(() => db.anonymous("select delete_booking($1, 'x', false)", [id]))) ?? "", /permission denied/);
    assert.equal(await db.error(() => db.anonymous("select track_booking('NOPE-1')")), null); // the one public door
  });
});

test("a signed-in person with no profile, or a role with no permissions, sees nothing", { skip }, async () => {
  await inTransaction(async (db) => {
    await db.booking();
    const nobody = (await db.owner("insert into auth.users (id) values (gen_random_uuid()) returning id"))[0].id as string;
    assert.equal((await db.as(nobody, "select count(*)::int n from bookings"))[0].n, 0);
    const empty = await db.person([]);
    assert.equal((await db.as(empty, "select count(*)::int n from bookings"))[0].n, 0);
    assert.equal((await db.as(empty, "select count(*)::int n from customers"))[0].n, 0);
    const viewer = await db.person(["bookings.view"]);
    assert.ok((await db.as(viewer, "select count(*)::int n from bookings"))[0].n >= 1); // the permission is what opens the door
  });
});

test("a driver sees only their own pickups", { skip }, async () => {
  await inTransaction(async (db) => {
    const u1 = await db.person(["pickups.view_own"], "driver one");
    const u2 = await db.person(["pickups.view_own"], "driver two");
    const d1 = (await db.owner("insert into drivers (name, user_id) values ('Driver One', $1) returning id", [u1]))[0].id;
    const d2 = (await db.owner("insert into drivers (name, user_id) values ('Driver Two', $1) returning id", [u2]))[0].id;
    await db.booking({ driver_id: d1, sender_name: "Mine" });
    await db.booking({ driver_id: d2, sender_name: "Not mine" });
    const mine = await db.as(u1, "select sender_name from bookings");
    assert.deepEqual(mine.map((r) => r.sender_name), ["Mine"]);
  });
});

test("permissions are enforced as granted, and an inactive person has none", { skip }, async () => {
  await inTransaction(async (db) => {
    const editor = await db.person(["customers.edit"]);
    const viewer = await db.person(["customers.view"]);
    const can = async (id: string, perm: string) => (await db.as(id, "select has_perm($1) ok", [perm]))[0].ok as boolean;
    assert.equal(await can(editor, "customers.edit"), true);
    assert.equal(await can(editor, "customers.manage"), false);
    assert.equal(await can(viewer, "customers.edit"), false);
    assert.match((await db.error(() => db.as(viewer, "select create_customer('X', null, null, null, null, null, null)"))) ?? "", /permission/i);
    await db.owner("update profiles set active = false where id = $1", [editor]);
    assert.equal(await can(editor, "customers.edit"), false);
  });
});

test("customers: every booking gets one, and the rules for creating, merging and deleting hold", { skip }, async () => {
  await inTransaction(async (db) => {
    const staff = await db.person(["customers.view", "customers.edit"]);
    const manager = await db.person(["customers.view", "customers.edit", "customers.manage"]);
    const booking = await db.booking({ sender_name: "Auto Customer", sender_phone: "+971500009001" });
    const linked = await db.as(staff, "select c.full_name, c.phone from booking_contacts bc join customers c on c.id = bc.customer_id where bc.booking_id = $1 and bc.role = 'customer'", [booking]);
    assert.deepEqual([linked[0].full_name, linked[0].phone], ["Auto Customer", "+971500009001"]);

    // same phone, second booking: the same customer, not a duplicate
    const second = await db.booking({ sender_name: "Auto Customer", sender_phone: "+971500009001" });
    const ids = await db.owner("select distinct customer_id from booking_contacts where booking_id in ($1, $2) and role = 'customer'", [booking, second]);
    assert.equal(ids.length, 1);

    // validation
    assert.match((await db.error(() => db.as(staff, "select create_customer('X', null, null, null, null, null, '123')"))) ?? "", /Emirates ID/);
    assert.match((await db.error(() => db.as(staff, "select create_customer('  ', null, null, null, null, null, null)"))) ?? "", /name/);

    // staff can create, but only a manager can merge
    const a = (await db.as(staff, "select create_customer('Dup A', '+971500009002', null, null, null, null, null) id"))[0].id;
    const b = (await db.as(staff, "select create_customer('Dup B', '+971500009002', null, 'Sharjah', null, null, null) id"))[0].id;
    assert.match((await db.error(() => db.as(staff, "select merge_customers($1, $2)", [a, b]))) ?? "", /permission/i);
    assert.equal(await db.error(() => db.as(manager, "select merge_customers($1, $2)", [a, b])), null);
    assert.equal((await db.owner("select address from customers where id = $1", [a]))[0].address, "Sharjah"); // blanks filled from the other record
    assert.equal((await db.owner("select count(*)::int n from customers where id = $1", [b]))[0].n, 0);

    // a customer with invoices cannot be deleted
    const cust = ids[0].customer_id;
    assert.match((await db.error(() => db.as(manager, "select delete_customer($1)", [cust]))) ?? "", /linked to invoices/);
  });
});

test("editing a customer updates bookings waiting for pickup, and leaves collected invoices alone", { skip }, async () => {
  await inTransaction(async (db) => {
    const staff = await db.person(["customers.view", "customers.edit"]);
    const waiting = await db.booking({ sender_name: "Before", sender_phone: "+971500009010" });
    const done = await db.booking({ sender_name: "Before", sender_phone: "+971500009010" });
    await db.owner("update bookings set status = 'collected' where id = $1", [done]);
    const cust = (await db.owner("select customer_id from booking_contacts where booking_id = $1 and role = 'customer'", [waiting]))[0].customer_id;
    await db.as(staff, "select update_customer($1, 'After', '+971500009011', null, null, null, null, null)", [cust]);
    const rows = await db.owner("select id, sender_name, sender_phone from bookings where id in ($1, $2)", [waiting, done]);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    assert.deepEqual([by(waiting).sender_name, by(waiting).sender_phone], ["After", "+971500009011"]);
    assert.deepEqual([by(done).sender_name, by(done).sender_phone], ["Before", "+971500009010"]);
  });
});

test("deleting a booking needs permission and a reason, and never loses money silently", { skip }, async () => {
  await inTransaction(async (db) => {
    const admin = await db.person(["bookings.delete", "payments.manage"]);
    const staff = await db.person(["bookings.view", "bookings.edit"]);
    const booking = await db.booking({ invoice_no: "T-DEL-1" });
    assert.match((await db.error(() => db.as(staff, "select delete_booking($1, 'x', false)", [booking]))) ?? "", /permission/i);
    assert.match((await db.error(() => db.as(admin, "select delete_booking($1, '  ', false)", [booking]))) ?? "", /reason/);
    await db.owner("update bookings set invoice_amount = 100 where id = $1", [booking]);
    await db.owner("insert into payments (booking_id, amount, method) values ($1, 40, 'cash')", [booking]);
    assert.match((await db.error(() => db.as(admin, "select delete_booking($1, 'test', false)", [booking]))) ?? "", /PAYMENTS_EXIST/);
    assert.equal(await db.error(() => db.as(admin, "select delete_booking($1, 'test run', true)", [booking])), null);
    assert.equal((await db.owner("select count(*)::int n from bookings where id = $1", [booking]))[0].n, 0);
  });
});

test("payment before loading: an unpaid parcel cannot be loaded until it is paid (when the switch is on)", { skip }, async () => {
  await inTransaction(async (db) => {
    const warehouseUser = await db.person(["warehouse.view", "warehouse.manage", "containers.view", "containers.manage"]);
    const booking = await db.booking({ invoice_no: "T-PAY-1" });
    await db.owner("update bookings set status = 'collected', invoice_amount = 100 where id = $1", [booking]);
    const wh = (await db.owner("select id from warehouses order by code limit 1"))[0].id;
    await db.as(warehouseUser, "select split_booking($1, $2, $3::jsonb)", [booking, wh, JSON.stringify([{ description: "Box", weight_kg: 10 }])]);
    const parcel = (await db.owner("select barcode from parcels where booking_id = $1 and status = 'in_warehouse'", [booking]))[0]?.barcode;
    assert.ok(parcel, "the booking should have a parcel in the warehouse");
    const container = (await db.owner("insert into containers (destination) values ('Test') returning id"))[0].id;
    await db.owner("update app_settings set value = 'true'::jsonb where key = 'require_payment_before_loading'");

    const refused = await db.error(() => db.as(warehouseUser, "select load_parcel($1, $2, null)", [container, parcel]));
    assert.match(refused ?? "", /PAYMENT_REQUIRED/);
    await db.owner("insert into payments (booking_id, amount, method) values ($1, 100, 'cash')", [booking]);
    assert.equal(await db.error(() => db.as(warehouseUser, "select load_parcel($1, $2, null)", [container, parcel])), null);
  });
});

test("the Emirates ID setting: when on, a pickup cannot be marked collected without the ID number", { skip }, async () => {
  await inTransaction(async (db) => {
    const booking = await db.booking();
    await db.owner("update app_settings set value = 'true'::jsonb where key = 'require_id_before_collected'");
    assert.match((await db.error(() => db.owner("update bookings set status = 'collected' where id = $1", [booking]))) ?? "", /Emirates ID/);
    await db.owner("insert into id_documents (booking_id, emirates_id) values ($1, '784-1990-1234567-1')", [booking]);
    assert.equal(await db.error(() => db.owner("update bookings set status = 'collected' where id = $1", [booking])), null);
  });
});

test("a custom invoice number can be used only once", { skip }, async () => {
  await inTransaction(async (db) => {
    await db.booking({ invoice_no: "T-UNIQUE-1" });
    const message = await db.error(() => db.booking({ invoice_no: "T-UNIQUE-1" }));
    assert.match(message ?? "", /duplicate key|unique|already/i);
  });
});

test("every automatic number comes from Settings > Numbering, and a new series appears there by itself", { skip }, async () => {
  await inTransaction(async (db) => {
    // booking, invoice, return and container are all in the list, each with a label
    const kinds = (await db.owner("select kind from number_series")).map((r) => r.kind);
    for (const kind of ["booking", "invoice", "return", "container"]) assert.ok(kinds.includes(kind), `${kind} is in the list`);

    // a container and a return take their number from the series, with the prefix chosen there
    await db.owner("update number_series set prefix = 'ZZ-', next_number = 7000 where kind = 'container'");
    await db.owner("update number_series set prefix = 'RR-', next_number = 8000 where kind = 'return'");
    assert.equal((await db.owner("insert into containers (destination) values ('Test') returning code"))[0].code, "ZZ-7000");
    // a number somebody typed is kept, and the automatic one skips it
    assert.equal((await db.owner("insert into containers (destination, code) values ('Test', 'ZZ-7001') returning code"))[0].code, "ZZ-7001");
    assert.equal((await db.owner("insert into containers (destination) values ('Test') returning code"))[0].code, "ZZ-7002");
    const booking = await db.booking();
    assert.equal((await db.owner("insert into returns (booking_id) values ($1) returning code", [booking]))[0].code, "RR-8000");

    // a series registered in future migrations is picked up with no other change
    await db.owner("select register_number_series('demo', 'Demo numbers', 'dm-', 5, null, null, 50)");
    const demo = (await db.owner("select label, prefix, next_number from number_series where kind = 'demo'"))[0];
    assert.equal(demo.prefix, "DM-");
    assert.equal((await db.owner("select take_next_number('demo') n"))[0].n, "DM-5");

    // only people who may manage settings can change a prefix
    const nobody = await db.person(["bookings.view", "numbers.edit"]);
    assert.match((await db.error(() => db.as(nobody, "select set_number_series('container', 'XX-', 1)"))) ?? "", /permission/i);
  });
});

test("a typed booking or invoice number must start with the prefix from Settings", { skip }, async () => {
  await inTransaction(async (db) => {
    const prefix = (await db.owner("select prefix from number_series where kind = 'booking'"))[0].prefix as string;
    const person = await db.person(["bookings.view", "bookings.edit", "bookings.create", "numbers.edit"]);
    const booking = await db.booking();
    const wrong = await db.error(() => db.as(person, "update bookings set code = 'XX-9999' where id = $1", [booking]));
    assert.match(wrong ?? "", new RegExp(`must start with ${prefix}`));
    assert.equal(await db.error(() => db.as(person, "update bookings set code = $2 where id = $1", [booking, `${prefix}9999`])), null);
    const invoicePrefix = (await db.owner("select prefix from number_series where kind = 'invoice'"))[0].prefix as string;
    assert.match((await db.error(() => db.as(person, "update bookings set invoice_no = 'XX-1' where id = $1", [booking]))) ?? "", /must start with/);
    assert.equal(await db.error(() => db.as(person, "update bookings set invoice_no = $2 where id = $1", [booking, `${invoicePrefix}9998`])), null);
  });
});

test("old records: every step can carry its real day, never a future day", { skip }, async () => {
  await inTransaction(async (db) => {
    const office = await db.person(["bookings.view", "bookings.edit", "bookings.reschedule", "payments.manage"]);
    const warehouseUser = await db.person(["warehouse.view", "warehouse.manage", "containers.view", "containers.manage"]);
    const booking = await db.booking({ invoice_no: "T-OLD-1" });

    // pickup date: a past day is allowed
    assert.equal(await db.error(() => db.as(office, "select reschedule_booking($1, '2025-12-27', 'Entering the old record')", [booking])), null);

    // collected day (the invoice date) and payment day: past yes, future no
    await db.owner("update bookings set status = 'collected', collected_at = '2025-12-27T12:00:00Z' where id = $1", [booking]);
    assert.match((await db.error(() => db.owner("update bookings set collected_at = now() + interval '3 days' where id = $1", [booking]))) ?? "", /collection date cannot be in the future/);
    assert.equal(await db.error(() => db.owner("insert into payments (booking_id, amount, method, created_at) values ($1, 50, 'cash', '2025-12-27T12:00:00Z')", [booking])), null);
    assert.match((await db.error(() => db.owner("insert into payments (booking_id, amount, method, created_at) values ($1, 5, 'cash', now() + interval '3 days')", [booking]))) ?? "", /payment date cannot be in the future/);

    // received in the warehouse: not before the collection, not in the future
    const wh = (await db.owner("select id from warehouses order by code limit 1"))[0].id;
    const parcels = JSON.stringify([{ description: "Box", weight_kg: 10 }]);
    assert.match((await db.error(() => db.as(warehouseUser, "select split_booking($1, $2, $3::jsonb, '2025-12-01')", [booking, wh, parcels]))) ?? "", /before the collection/);
    assert.match((await db.error(() => db.as(warehouseUser, "select split_booking($1, $2, $3::jsonb, '2999-01-01')", [booking, wh, parcels]))) ?? "", /future/);
    assert.equal(await db.error(() => db.as(warehouseUser, "select split_booking($1, $2, $3::jsonb, '2025-12-28')", [booking, wh, parcels])), null);

    // loaded into a container: the history shows the real days, in order
    const parcel = (await db.owner("select id, barcode from parcels where booking_id = $1 and status = 'in_warehouse'", [booking]))[0];
    const container = (await db.owner("insert into containers (destination) values ('Test') returning id"))[0].id;
    assert.equal(await db.error(() => db.as(warehouseUser, "select load_parcel($1, $2, null, '2025-12-30')", [container, parcel.barcode])), null);
    const days = Object.fromEntries((await db.owner("select status, created_at::date::text d from parcel_events where parcel_id = $1", [parcel.id])).map((r) => [r.status, r.d]));
    assert.equal(days.in_warehouse, "2025-12-28");
    assert.equal(days.loaded, "2025-12-30");
  });
});

test("the next-number hint skips numbers already used, and only people who may type numbers can ask", { skip }, async () => {
  await inTransaction(async (db) => {
    await db.owner(readFileSync("supabase/migrations/0051_next_number_preview.sql", "utf8"));
    const editor = await db.person(["numbers.edit"]);
    const nobody = await db.person(["bookings.view"]);
    await db.owner("update number_series set prefix = 'PV-', next_number = 500 where kind = 'booking'");
    assert.equal((await db.as(editor, "select next_number_preview('booking') n"))[0].n, "PV-500");
    await db.booking(); // takes the next automatic number, PV-500
    assert.equal((await db.as(editor, "select next_number_preview('booking') n"))[0].n, "PV-501");
    assert.match((await db.error(() => db.as(nobody, "select next_number_preview('booking')"))) ?? "", /permission/i);
  });
});

test("the booking stage follows the parcels, for search and tracking too, even without permission to see parcels", { skip }, async () => {
  await inTransaction(async (db) => {
    await db.owner(readFileSync("supabase/migrations/0052_booking_stage.sql", "utf8"));
    const stageOf = async (code: string) => (await db.owner("select stage(b) s from bookings b where b.code = $1", [code]))[0]?.s;

    // a booking in the warehouse whose current parcels are all returned (repacked history is ignored)
    const booking = await db.booking({ invoice_no: "T-STAGE-1" });
    await db.owner("update bookings set status = 'at_warehouse' where id = $1", [booking]);
    const code = (await db.owner("select code from bookings where id = $1", [booking]))[0].code as string;
    const wh = (await db.owner("select id from warehouses order by code limit 1"))[0].id;
    const add = async (barcode: string, status: string, seq: number, round = 1) =>
      db.owner("insert into parcels (booking_id, seq, barcode, status, warehouse_id, round, weight_kg) values ($1, $2, $3, $4, $5, $6, 1)", [booking, seq, barcode, status, wh, round]);
    await add(`${code}-P1`, "repacked", 1);
    await add(`${code}-R2-P1`, "returned", 2, 2);
    await add(`${code}-R2-P2`, "returned", 3, 2);
    assert.equal(await stageOf(code), "returned");

    // a partial return stays at the warehouse; once the rest has left, the least advanced parcel decides
    await db.owner("update parcels set status = 'in_warehouse' where barcode = $1", [`${code}-R2-P2`]);
    assert.equal(await stageOf(code), "at_warehouse");
    await db.owner("update parcels set status = 'in_transit' where barcode = $1", [`${code}-R2-P2`]);
    assert.equal(await stageOf(code), "in_transit");
    await db.owner("update parcels set status = 'delivered' where barcode = $1", [`${code}-R2-P2`]);
    assert.equal(await stageOf(code), "delivered"); // the returned parcel does not hold it back

    // before the warehouse, the stored stage is shown
    await db.owner("update bookings set status = 'collected' where id = $1", [booking]);
    assert.equal(await stageOf(code), "collected");
    await db.owner("update bookings set status = 'at_warehouse' where id = $1", [booking]);
    await db.owner("update parcels set status = 'returned' where booking_id = $1 and status = 'delivered'", [booking]);

    // somebody who may see bookings but NOT parcels still gets the right stage: in the column, in search, in the public tracking
    const accounts = await db.person(["bookings.view", "accounts.view"]);
    assert.equal((await db.as(accounts, "select count(*)::int n from parcels"))[0].n, 0, "this person cannot see parcels");
    assert.equal((await db.as(accounts, "select stage(b) s from bookings b where b.id = $1", [booking]))[0].s, "returned");
    const found = (await db.as(accounts, "select global_search($1) r", [code]))[0].r as { bookings: { code: string; status: string }[] };
    assert.equal(found.bookings.find((b) => b.code === code)?.status, "returned");
    assert.equal((await db.owner("select track_booking($1) t", [code]))[0].t.status, "returned");

    // the rule itself is not callable from the app, and signed-out visitors cannot ask for a stage
    assert.match((await db.error(() => db.as(accounts, "select booking_stage_of('at_warehouse', $1)", [booking]))) ?? "", /permission denied/i);
    assert.match((await db.error(() => db.anonymous("select stage(b) from bookings b limit 1"))) ?? "", /permission denied|does not exist/i);
  });
});

test("Customers and Accounts lists can be sorted in the database, safely, and a custom invoice number cannot break Accounts", { skip }, async () => {
  await inTransaction(async (db) => {
    const viewer = await db.person(["customers.view", "accounts.view", "bookings.view"]);
    const make = async (name: string, phone: string, invoice: string, amount: number, daysAgo: number) => {
      const id = await db.booking({ sender_name: name, sender_phone: phone, invoice_no: invoice });
      await db.owner("update bookings set invoice_amount = $2, created_at = now() - ($3 || ' days')::interval where id = $1", [id, amount, String(daysAgo)]);
      return id;
    };
    await make("SortTest Zed", "+971501000003", "INV-9001", 100, 1);
    const zed2 = await make("SortTest Zed", "+971501000003", "INV-9002", 300, 2);
    await make("SortTest Amy", "+971501000001", "INV-9010", 200, 3);
    await make("SortTest Mid", "+971501000002", "T-OLD-5", 50, 4); // a custom number with no INV- prefix

    // ---- customers
    const names = async (sort: string | null, dir: string | null) =>
      ((await db.as(viewer, "select search_customers('SortTest', 50, $1, $2) r", [sort, dir]))[0].r.customers as { full_name: string }[]).map((c) => c.full_name.replace("SortTest ", ""));
    assert.deepEqual(await names(null, null), ["Amy", "Mid", "Zed"]); // the normal order is by name
    assert.deepEqual(await names("name", "desc"), ["Zed", "Mid", "Amy"]);
    assert.deepEqual(await names("phone", "desc"), ["Zed", "Mid", "Amy"]);
    assert.deepEqual(await names("invoices", "desc"), ["Zed", "Amy", "Mid"]); // Zed has 2; the tie is broken by name
    assert.deepEqual(await names("last_invoice", "desc"), ["Zed", "Amy", "Mid"]); // newest invoice first
    assert.deepEqual(await names("last_invoice", "asc"), ["Mid", "Amy", "Zed"]);
    assert.deepEqual(await names("name; drop table customers", "asc"), ["Amy", "Mid", "Zed"]); // anything not on the list is ignored
    const zedRow = ((await db.as(viewer, "select list_customers(200, 0, 'name', 'asc') r"))[0].r.customers as { full_name: string; invoices: number; last_invoice: string | null }[]).find((c) => c.full_name === "SortTest Zed");
    assert.equal(Number(zedRow?.invoices), 2);
    assert.equal(zedRow?.last_invoice, "INV-9001"); // the latest invoice, as before

    // ---- accounts
    const pay = async (status: string, sort: string | null, dir: string | null) =>
      (await db.as(viewer, "select r_invoice_no n from accounts_invoices($1, 'SortTest', 25, 0, $2, $3)", [status, sort, dir])).map((r) => r.n as string);
    assert.deepEqual(await pay("all", null, null), ["INV-9010", "INV-9002", "INV-9001", "T-OLD-5"]); // normal: newest invoice first, no crash on T-OLD-5
    assert.deepEqual(await pay("all", "invoice", "asc"), ["T-OLD-5", "INV-9001", "INV-9002", "INV-9010"]);
    assert.deepEqual(await pay("all", "amount", "desc"), ["INV-9002", "INV-9010", "INV-9001", "T-OLD-5"]);
    assert.deepEqual((await pay("all", "customer", "asc")).slice(0, 2), ["INV-9010", "T-OLD-5"]); // Amy, Mid, then Zed
    assert.deepEqual(await pay("all", "x; drop table bookings", "asc"), ["INV-9010", "INV-9002", "INV-9001", "T-OLD-5"]);

    await db.owner("insert into payments (booking_id, amount, method) values ($1, 300, 'cash')", [zed2]); // INV-9002 is now paid in full
    const byStatus = await pay("all", "status", "asc"); // needing attention first, paid last
    assert.equal(byStatus[byStatus.length - 1], "INV-9002");
    assert.equal((await pay("all", "balance", "asc"))[0], "INV-9002"); // balance 0 first
    assert.equal((await pay("outstanding", "amount", "desc"))[0], "INV-9010"); // the filter still applies with a sort

    const noAccounts = await db.person(["customers.view"]);
    assert.match((await db.error(() => db.as(noAccounts, "select accounts_invoices('all', null, 25, 0, 'amount', 'asc')"))) ?? "", /permission/i);
  });
});

// ---------------- refunds and credit notes (stage 1) ----------------
test("credit notes and refunds: tables are protected, permissions and series exist", { skip }, async () => {
  await inTransaction(async (db) => {
    const series = await db.owner("select kind, prefix from number_series where kind in ('credit_note', 'refund') order by kind");
    assert.deepEqual(series.map((r) => `${r.kind}:${r.prefix}`), ["credit_note:CR-", "refund:RF-"]);
    const grants = await db.owner("select role, permission from role_permissions where permission in ('refunds.issue', 'refunds.void') order by permission, role");
    assert.deepEqual(grants.map((g) => `${g.permission}:${g.role}`), ["refunds.issue:manager", "refunds.issue:super_admin", "refunds.void:super_admin"]);

    // nobody can write to the tables directly, whatever they may do elsewhere
    const everything = await db.person(["accounts.view", "payments.manage", "bookings.view", "refunds.issue", "refunds.void"]);
    for (const sql of ["insert into credit_notes (number) values ('x')", "update refunds set note = 'x'", "delete from credit_note_lines", "insert into refunds (number) values ('x')"]) {
      assert.match((await db.error(() => db.as(everything, sql))) ?? "", /permission denied/i, sql);
    }
    assert.match((await db.error(() => db.anonymous("select count(*) from credit_notes"))) ?? "", /permission denied/i);
    // a person who can see accounts can read them (empty here), a person without any money permission cannot
    assert.equal((await db.as(everything, "select count(*)::int n from refunds"))[0].n >= 0, true);
    const nobody = await db.person(["dashboard.view"]);
    assert.equal((await db.as(nobody, "select count(*)::int n from credit_notes"))[0].n, 0);
  });
});

// A collected booking with an invoice amount, for the money tests. Returns the booking id.
async function moneyBooking(db: Db, amount: number | null = 1000): Promise<string> {
  const id = await db.booking({ invoice_no: `T-M-${Math.random().toString(36).slice(2, 8).toUpperCase()}` });
  await db.owner("update bookings set status = 'collected', collected_at = now() - interval '2 days', invoice_amount = $2 where id = $1", [id, amount]);
  return id;
}
const moneyOf = async (db: Db, id: string) => {
  const r = (await db.owner("select invoice_now, paid, balance_due, refund_due, pay_status from money_of($1)", [id]))[0];
  return { invoice_now: r.invoice_now === null ? null : Number(r.invoice_now), paid: Number(r.paid), balance_due: r.balance_due === null ? null : Number(r.balance_due), refund_due: Number(r.refund_due), pay_status: r.pay_status as string };
};
const addPayment = (db: Db, id: string, amount: number) => db.owner("insert into payments (booking_id, amount, method) values ($1, $2, 'cash')", [id, amount]);
const addCredit = async (db: Db, id: string, oldTotal: number, newTotal: number, status = "active") =>
  (await db.owner(
    "insert into credit_notes (number, booking_id, invoice_no, note_date, reason, old_total, new_total, credit_amount, status) select 'T-CN-' || substr(gen_random_uuid()::text, 1, 6), $1, invoice_no, current_date, 'test', $2::numeric, $3::numeric, $2::numeric - $3::numeric, $4 from bookings where id = $1 returning id",
    [id, oldTotal, newTotal, status]
  ))[0].id as string;
const addRefund = (db: Db, id: string, amount: number, creditId: string | null, status = "active") =>
  db.owner("insert into refunds (number, booking_id, credit_note_id, amount, method, refund_date, status) values ('T-RF-' || substr(gen_random_uuid()::text, 1, 6), $1, $2, $3, 'cash', current_date, $4)", [id, creditId, amount, status]);

test("money_of works out invoice total now, paid, balance, refund due and the state", { skip }, async () => {
  await inTransaction(async (db) => {
    const a = await moneyBooking(db);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 1000, paid: 0, balance_due: 1000, refund_due: 0, pay_status: "unpaid" });
    await addPayment(db, a, 400);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 1000, paid: 400, balance_due: 600, refund_due: 0, pay_status: "partial" });
    await addPayment(db, a, 600);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 1000, paid: 1000, balance_due: 0, refund_due: 0, pay_status: "paid" });

    // a credit to 650 after paying 1000: 350 is owed back; paying it back settles the invoice
    const credit = await addCredit(db, a, 1000, 650);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 650, paid: 1000, balance_due: 0, refund_due: 350, pay_status: "refund_due" });
    await addRefund(db, a, 350, credit);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 650, paid: 650, balance_due: 0, refund_due: 0, pay_status: "paid" });

    // voided records change nothing
    const b = await moneyBooking(db);
    await addPayment(db, b, 1000);
    const voidCredit = await addCredit(db, b, 1000, 0, "void");
    await addRefund(db, b, 500, voidCredit, "void");
    assert.deepEqual(await moneyOf(db, b), { invoice_now: 1000, paid: 1000, balance_due: 0, refund_due: 0, pay_status: "paid" });

    // no invoice amount yet
    const c = await moneyBooking(db, null);
    assert.deepEqual(await moneyOf(db, c), { invoice_now: null, paid: 0, balance_due: null, refund_due: 0, pay_status: "not_invoiced" });
  });
});

test("credit above paid leaves a balance, and a full credit with nothing paid is 'credited'", { skip }, async () => {
  await inTransaction(async (db) => {
    const a = await moneyBooking(db);
    await addPayment(db, a, 100);
    await addCredit(db, a, 1000, 650);
    assert.deepEqual(await moneyOf(db, a), { invoice_now: 650, paid: 100, balance_due: 550, refund_due: 0, pay_status: "partial" }); // the kept services are still owed
    const b = await moneyBooking(db);
    await addCredit(db, b, 1000, 0);
    assert.deepEqual(await moneyOf(db, b), { invoice_now: 0, paid: 0, balance_due: 0, refund_due: 0, pay_status: "credited" });
  });
});

test("booking_money gives the same numbers to the app, to signed-in people only", { skip }, async () => {
  await inTransaction(async (db) => {
    const a = await moneyBooking(db);
    await addPayment(db, a, 400);
    const viewer = await db.person(["accounts.view", "bookings.view"]);
    const m = (await db.as(viewer, "select booking_money($1) m", [a]))[0].m;
    assert.deepEqual({ invoice_now: Number(m.invoice_now), paid: Number(m.paid), balance_due: Number(m.balance_due), refund_due: Number(m.refund_due), pay_status: m.pay_status }, { invoice_now: 1000, paid: 400, balance_due: 600, refund_due: 0, pay_status: "partial" });
    assert.match((await db.error(() => db.anonymous("select booking_money($1)", [a]))) ?? "", /permission denied/i);
    // a person who cannot read payments sees no payments in the sums (row security applies), so never someone else's money
    const nobody = await db.person(["dashboard.view"]);
    assert.equal(Number((await db.as(nobody, "select booking_money($1) m", [a]))[0].m?.paid ?? 0), 0);
  });
});

// ---- issue_credit_note
type CreditLine = { category: string; amount: number; note?: string };
const issueCredit = (db: Db, who: string, booking: string, reason: string, lines: CreditLine[], date: string | null = null, returnId: string | null = null) =>
  db.as(who, "select issue_credit_note($1, $2, $3::jsonb, $4::date, $5::uuid) id", [booking, reason, JSON.stringify(lines), date, returnId]);
const collectionDay = async (db: Db, booking: string) => (await db.owner("select ((collected_at at time zone 'Asia/Dubai')::date)::text d from bookings where id = $1", [booking]))[0].d as string;
const daysFromToday = async (db: Db, n: number) => (await db.owner("select (((now() at time zone 'Asia/Dubai')::date) + $1::int)::text d", [n]))[0].d as string;
const KEPT = [{ category: "transport", amount: 400, note: "to Karachi" }, { category: "packing", amount: 150 }, { category: "labour", amount: 100 }];

test("issue_credit_note: a credit note with kept services is numbered, totalled and visible in the money", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(["refunds.issue", "accounts.view", "bookings.view"], "issuer");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const id = (await issueCredit(db, issuer, booking, "Parcels returned", KEPT))[0].id as string;
    const note = (await db.owner("select number, status, old_total, new_total, credit_amount, return_id, created_by_name, invoice_no from credit_notes where id = $1", [id]))[0];
    assert.match(note.number, /^CR-\d+$/);
    assert.deepEqual([note.status, Number(note.old_total), Number(note.new_total), Number(note.credit_amount), note.return_id], ["active", 1000, 650, 350, null]);
    assert.equal(note.created_by_name, "Test issuer");
    assert.equal((await db.owner("select count(*)::int n from credit_note_lines where credit_note_id = $1", [id]))[0].n, 3);
    assert.deepEqual(await moneyOf(db, booking), { invoice_now: 650, paid: 1000, balance_due: 0, refund_due: 350, pay_status: "refund_due" });
  });
});

test("issue_credit_note: no lines is a full credit, amounts are rounded to two decimals, the collection day is allowed", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(["refunds.issue", "accounts.view", "bookings.view"], "issuer");
    const full = await moneyBooking(db);
    const id = (await issueCredit(db, issuer, full, "Wrong invoice", []))[0].id as string;
    const n = (await db.owner("select new_total, credit_amount from credit_notes where id = $1", [id]))[0];
    assert.deepEqual([Number(n.new_total), Number(n.credit_amount)], [0, 1000]);

    const rounded = await moneyBooking(db);
    const r = (await issueCredit(db, issuer, rounded, "Correction", [{ category: "other", amount: 100.005 }], await collectionDay(db, rounded)))[0].id as string;
    const row = (await db.owner("select new_total, credit_amount, note_date::text d from credit_notes where id = $1", [r]))[0];
    assert.deepEqual([Number(row.new_total), Number(row.credit_amount)], [100.01, 899.99]);
    assert.equal(row.d, await collectionDay(db, rounded)); // the collection day itself is accepted
  });
});

test("issue_credit_note: refuses what the rules do not allow", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(["refunds.issue", "accounts.view", "bookings.view"], "issuer");
    const ok = await moneyBooking(db);
    const refused = async (label: string, who: string, booking: string, reason: string, lines: CreditLine[], expect: RegExp, date: string | null = null, returnId: string | null = null) =>
      assert.match((await db.error(() => issueCredit(db, who, booking, reason, lines, date, returnId))) ?? "NOT REFUSED", expect, label);

    const notCollected = await db.booking({ invoice_no: "T-NC-1" });
    await db.owner("update bookings set invoice_amount = 500 where id = $1", [notCollected]);
    await refused("not collected", issuer, notCollected, "x", [], /collected/);
    const noAmount = await moneyBooking(db, null);
    await refused("no invoice amount", issuer, noAmount, "x", [], /invoice amount/);
    const cancelled = await moneyBooking(db);
    await db.owner("update bookings set status = 'cancelled', cancellation_reason = 'x' where id = $1", [cancelled]);
    await refused("cancelled", issuer, cancelled, "x", [], /cancel/);

    await refused("empty reason", issuer, ok, "   ", [], /reason/);
    await refused("zero line", issuer, ok, "x", [{ category: "transport", amount: 0 }], /above zero/);
    await refused("negative line", issuer, ok, "x", [{ category: "transport", amount: -5 }], /above zero/);
    await refused("unknown category", issuer, ok, "x", [{ category: "food", amount: 10 }], /category/);
    await refused("new total equal to the old", issuer, ok, "x", [{ category: "other", amount: 1000 }], /below/);
    await refused("new total above the old", issuer, ok, "x", [{ category: "other", amount: 1200 }], /below/);
    await refused("future date", issuer, ok, "x", [], /future/, await daysFromToday(db, 2));
    await refused("before the collection day", issuer, ok, "x", [], /before the collection/, await daysFromToday(db, -9));

    const other = await moneyBooking(db);
    const foreignReturn = (await db.owner("insert into returns (booking_id) values ($1) returning id", [other]))[0].id as string;
    await refused("a return of another booking", issuer, ok, "x", [], /return/, null, foreignReturn);

    const noPermission = await db.person(["accounts.view", "bookings.view"], "viewer");
    await refused("no permission", noPermission, ok, "x", [], /permission/i);
    // nothing was written by any refused call
    assert.equal((await db.owner("select count(*)::int n from credit_notes where booking_id = any($1::uuid[])", [[ok, notCollected, noAmount, cancelled, other]]))[0].n, 0);
  });
});

// ---- record_refund
const refundIt = (db: Db, who: string, booking: string, creditId: string | null, amount: number, method = "cash", date: string | null = null, note: string | null = null) =>
  db.as(who, "select record_refund($1, $2::uuid, $3::numeric, $4, $5::date, $6) id", [booking, creditId, amount, method, date, note]);
const ISSUER = ["refunds.issue", "accounts.view", "bookings.view"];

test("record_refund: refunds never exceed refund due, however they are split", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const credit = (await issueCredit(db, issuer, booking, "Parcels returned", KEPT))[0].id as string; // 350 is now owed back
    assert.match((await db.error(() => refundIt(db, issuer, booking, credit, 350.01))) ?? "NOT REFUSED", /more than/);
    const first = (await refundIt(db, issuer, booking, credit, 200, "bank_transfer", null, "first part"))[0].id as string;
    assert.match((await db.error(() => refundIt(db, issuer, booking, credit, 200))) ?? "NOT REFUSED", /more than/);
    await refundIt(db, issuer, booking, credit, 150);
    assert.deepEqual(await moneyOf(db, booking), { invoice_now: 650, paid: 650, balance_due: 0, refund_due: 0, pay_status: "paid" });
    const row = (await db.owner("select number, method, status, handed_by_name, note, credit_note_id from refunds where id = $1", [first]))[0];
    assert.match(row.number, /^RF-\d+$/);
    assert.deepEqual([row.method, row.status, row.handed_by_name, row.note, row.credit_note_id], ["bank_transfer", "active", "Test issuer", "first part", credit]);
  });
});

test("record_refund: no refund when nothing is due, and a plain overpayment can be refunded without a credit note", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const exact = await moneyBooking(db);
    await addPayment(db, exact, 1000);
    assert.match((await db.error(() => refundIt(db, issuer, exact, null, 1))) ?? "NOT REFUSED", /no refund due/i);
    const over = await moneyBooking(db);
    await addPayment(db, over, 1100);
    assert.equal((await moneyOf(db, over)).refund_due, 100);
    await refundIt(db, issuer, over, null, 100);
    assert.deepEqual(await moneyOf(db, over), { invoice_now: 1000, paid: 1000, balance_due: 0, refund_due: 0, pay_status: "paid" });
  });
});

test("record_refund: refuses what the rules do not allow", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const credit = (await issueCredit(db, issuer, booking, "x", KEPT))[0].id as string;
    const refused = async (label: string, run: () => Promise<unknown>, expect: RegExp) => assert.match((await db.error(run)) ?? "NOT REFUSED", expect, label);
    await refused("zero", () => refundIt(db, issuer, booking, credit, 0), /above zero/);
    await refused("negative", () => refundIt(db, issuer, booking, credit, -5), /above zero/);
    await refused("method", () => refundIt(db, issuer, booking, credit, 10, "card"), /method/);
    await refused("future", async () => refundIt(db, issuer, booking, credit, 10, "cash", await daysFromToday(db, 2)), /future/);
    await refused("before the collection day", async () => refundIt(db, issuer, booking, credit, 10, "cash", await daysFromToday(db, -9)), /before the collection/);
    const other = await moneyBooking(db);
    await addPayment(db, other, 1000);
    await refused("a credit note of another booking", () => refundIt(db, issuer, other, credit, 10), /belongs to another booking/);
    await db.owner("update credit_notes set status = 'void' where id = $1", [credit]);
    await refused("a voided credit note", () => refundIt(db, issuer, booking, credit, 10), /voided/);
    await db.owner("update credit_notes set status = 'active' where id = $1", [credit]);
    const noPermission = await db.person(["accounts.view", "bookings.view"], "viewer");
    await refused("no permission", () => refundIt(db, noPermission, booking, credit, 10), /permission/i);
    assert.equal((await db.owner("select count(*)::int n from refunds where booking_id = any($1::uuid[])", [[booking, other]]))[0].n, 0);
  });
});

// ---- voiding
test("voiding: records stay, the numbers are restored, and the order matters", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const voider = await db.person(["refunds.void", "accounts.view", "bookings.view"], "voider");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const credit = (await issueCredit(db, issuer, booking, "Parcels returned", KEPT))[0].id as string;
    const refund = (await refundIt(db, issuer, booking, credit, 350))[0].id as string;

    // a credit note cannot be voided while its refund is still active
    assert.match((await db.error(() => db.as(voider, "select void_credit_note($1, 'mistake')", [credit]))) ?? "NOT REFUSED", /refund/i);
    await db.as(voider, "select void_refund($1, 'paid twice by mistake')", [refund]);
    assert.deepEqual(await moneyOf(db, booking), { invoice_now: 650, paid: 1000, balance_due: 0, refund_due: 350, pay_status: "refund_due" });
    await db.as(voider, "select void_credit_note($1, 'wrong kept services')", [credit]);
    assert.deepEqual(await moneyOf(db, booking), { invoice_now: 1000, paid: 1000, balance_due: 0, refund_due: 0, pay_status: "paid" });

    // the records stay, marked void, with who and why
    const c = (await db.owner("select status, void_reason, voided_by_name, voided_at is not null as stamped, credit_amount from credit_notes where id = $1", [credit]))[0];
    assert.deepEqual([c.status, c.void_reason, c.voided_by_name, c.stamped, Number(c.credit_amount)], ["void", "wrong kept services", "Test voider", true, 350]);
    const r = (await db.owner("select status, void_reason, amount from refunds where id = $1", [refund]))[0];
    assert.deepEqual([r.status, r.void_reason, Number(r.amount)], ["void", "paid twice by mistake", 350]);
  });
});

test("voiding: refuses a missing reason, a second void, and anyone without the void permission", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const voider = await db.person(["refunds.void", "accounts.view", "bookings.view"], "voider");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const credit = (await issueCredit(db, issuer, booking, "x", KEPT))[0].id as string;
    assert.match((await db.error(() => db.as(voider, "select void_credit_note($1, '   ')", [credit]))) ?? "NOT REFUSED", /reason/i);
    assert.match((await db.error(() => db.as(issuer, "select void_credit_note($1, 'because')", [credit]))) ?? "NOT REFUSED", /permission/i); // issuing is not voiding
    await db.as(voider, "select void_credit_note($1, 'because')", [credit]);
    assert.match((await db.error(() => db.as(voider, "select void_credit_note($1, 'again')", [credit]))) ?? "NOT REFUSED", /already/i);
    assert.match((await db.error(() => db.as(voider, "select void_refund($1, 'x')", [credit]))) ?? "NOT REFUSED", /not found/i);
  });
});

// ---- review fixes: the books cannot be undermined from the side
test("the invoice amount and the payments cannot be changed under a credit note or a refund", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const voider = await db.person(["refunds.void", "accounts.view", "bookings.view"], "voider");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    await db.owner("update bookings set invoice_amount = 900 where id = $1", [booking]); // nothing issued yet: allowed
    await db.owner("update bookings set invoice_amount = 1000 where id = $1", [booking]);
    const credit = (await issueCredit(db, issuer, booking, "x", KEPT))[0].id as string;
    assert.match((await db.error(() => db.owner("update bookings set invoice_amount = 300 where id = $1", [booking]))) ?? "NOT REFUSED", /credit note/i);
    const refund = (await refundIt(db, issuer, booking, credit, 350))[0].id as string;
    assert.match((await db.error(() => db.owner("delete from payments where booking_id = $1", [booking]))) ?? "NOT REFUSED", /refund/i);
    assert.match((await db.error(() => db.owner("update payments set amount = 300 where booking_id = $1", [booking]))) ?? "NOT REFUSED", /refund/i);
    assert.equal(await db.error(() => db.owner("update payments set amount = 700 where booking_id = $1", [booking])), null); // 700 still covers the 350 handed back
    assert.equal(await db.error(() => db.owner("update payments set amount = 1000 where booking_id = $1", [booking])), null);
    // once everything is voided the booking is free again
    await db.as(voider, "select void_refund($1, 'x')", [refund]);
    await db.as(voider, "select void_credit_note($1, 'x')", [credit]);
    assert.equal(await db.error(() => db.owner("update bookings set invoice_amount = 1100 where id = $1", [booking])), null);
    const plain = await moneyBooking(db);
    await addPayment(db, plain, 50);
    assert.equal(await db.error(() => db.owner("delete from payments where booking_id = $1", [plain])), null); // no refunds: deleting works as before
  });
});

test("credit notes and refunds: chained credits, a full credit then refund, void rules, odd input, no truncate", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person(ISSUER, "issuer");
    const a = await moneyBooking(db);
    await addPayment(db, a, 1000);
    const first = (await issueCredit(db, issuer, a, "x", KEPT))[0].id as string;
    const second = (await issueCredit(db, issuer, a, "again", [{ category: "transport", amount: 300 }]))[0].id as string;
    const row = (await db.owner("select old_total, new_total, credit_amount from credit_notes where id = $1", [second]))[0];
    assert.deepEqual([Number(row.old_total), Number(row.new_total), Number(row.credit_amount)], [650, 300, 350]); // the second credit starts from the first's new total
    assert.equal((await moneyOf(db, a)).invoice_now, 300);
    assert.ok(first);

    const b = await moneyBooking(db);
    await addPayment(db, b, 1000);
    const full = (await issueCredit(db, issuer, b, "Cancelled order", []))[0].id as string;
    assert.equal((await moneyOf(db, b)).refund_due, 1000);
    const refund = (await refundIt(db, issuer, b, full, 1000))[0].id as string;
    assert.deepEqual(await moneyOf(db, b), { invoice_now: 0, paid: 0, balance_due: 0, refund_due: 0, pay_status: "credited" });

    assert.match((await db.error(() => db.as(issuer, "select void_refund($1, 'x')", [refund]))) ?? "NOT REFUSED", /permission/i);
    const voider = await db.person(["refunds.void", "accounts.view", "bookings.view"], "voider");
    await db.as(voider, "select void_refund($1, 'x')", [refund]);
    assert.match((await db.error(() => db.as(voider, "select void_refund($1, 'again')", [refund]))) ?? "NOT REFUSED", /already/i);

    assert.match((await db.error(() => db.as(issuer, "select issue_credit_note($1, 'x', '{\"a\": 1}'::jsonb)", [a]))) ?? "NOT REFUSED", /list/i);
    for (const t of ["credit_notes", "credit_note_lines", "refunds"]) {
      for (const priv of ["truncate", "references", "trigger", "insert", "update", "delete"]) {
        assert.equal((await db.owner("select has_table_privilege('authenticated', $1, $2) ok", [t, priv]))[0].ok, false, `${t} ${priv}`);
      }
      assert.equal((await db.owner("select has_table_privilege('anon', $1, 'select') ok", [t]))[0].ok, false);
    }
  });
});

// ---------------- stage 2: the money maths in Accounts, search and the cancel rule ----------------
const invoiceOf = async (db: Db, booking: string) => (await db.owner("select invoice_no from bookings where id = $1", [booking]))[0].invoice_no as string;

test("accounts_summary counts credits and refunds, and shows what is owed back", { skip }, async () => {
  await inTransaction(async (db) => {
    const viewer = await db.person(["accounts.view", "bookings.view", "refunds.issue"], "viewer");
    const read = async () => {
      const s = (await db.as(viewer, "select accounts_summary() s"))[0].s;
      return { invoiced: Number(s.invoiced), collected: Number(s.collected), outstanding: Number(s.outstanding), refunded: Number(s.refunded), due_count: Number(s.refund_due_count), due_amount: Number(s.refund_due_amount), cash: Number(s.refunds.cash), bank: Number(s.refunds.bank) };
    };
    const before = await read();
    const a = await moneyBooking(db);
    await addPayment(db, a, 1000);
    const credit = (await issueCredit(db, viewer, a, "Parcels returned", KEPT))[0].id as string;
    const mid = await read(); // 350 is owed back, not paid yet
    assert.deepEqual([mid.invoiced - before.invoiced, mid.collected - before.collected, mid.outstanding - before.outstanding, mid.refunded - before.refunded, mid.due_count - before.due_count, mid.due_amount - before.due_amount], [650, 1000, 0, 0, 1, 350]);
    await refundIt(db, viewer, a, credit, 350, "bank_transfer");
    const after = await read();
    assert.deepEqual([after.invoiced - before.invoiced, after.collected - before.collected, after.outstanding - before.outstanding, after.refunded - before.refunded, after.due_count - before.due_count, after.due_amount - before.due_amount, after.bank - before.bank, after.cash - before.cash], [650, 650, 0, 350, 0, 0, 350, 0]);
  });
});

test("accounts_invoices shows current values, a credited note, and a Refund due filter; sorting still works", { skip }, async () => {
  await inTransaction(async (db) => {
    const viewer = await db.person(["accounts.view", "bookings.view", "refunds.issue"], "viewer");
    const a = await moneyBooking(db);
    await addPayment(db, a, 1000);
    const credit = (await issueCredit(db, viewer, a, "x", KEPT))[0].id as string;
    const owed = await invoiceOf(db, a);
    const find = async (status: string) => (await db.as(viewer, "select * from accounts_invoices($1, $2, 25, 0)", [status, owed])) as Record<string, unknown>[];
    const due = (await find("refund_due"))[0];
    assert.deepEqual([due.r_pay_status, Number(due.r_amount), Number(due.r_paid), Number(due.r_balance), Number(due.r_credited)], ["refund_due", 650, 1000, 0, 350]);
    assert.equal((await find("outstanding")).length, 0); // owed back is not "outstanding"
    await refundIt(db, viewer, a, credit, 350);
    assert.equal((await find("refund_due")).length, 0);
    const paid = (await find("paid"))[0];
    assert.deepEqual([paid.r_pay_status, Number(paid.r_amount), Number(paid.r_paid), Number(paid.r_balance), Number(paid.r_credited)], ["paid", 650, 650, 0, 350]);
    for (const sort of ["invoice", "customer", "amount", "paid", "balance", "status"]) {
      assert.equal((await db.as(viewer, "select count(*)::int n from accounts_invoices('all', null, 5, 0, $1, 'asc')", [sort]))[0].n >= 1, true, sort);
    }
  });
});

test("search shows the same payment state as Accounts", { skip }, async () => {
  await inTransaction(async (db) => {
    const viewer = await db.person(["accounts.view", "bookings.view", "refunds.issue"], "viewer");
    const a = await moneyBooking(db);
    await addPayment(db, a, 1000);
    await issueCredit(db, viewer, a, "x", KEPT);
    const code = (await db.owner("select code from bookings where id = $1", [a]))[0].code as string;
    const hit = ((await db.as(viewer, "select global_search($1) r", [code]))[0].r.bookings as { code: string; pay_status: string }[]).find((b) => b.code === code);
    assert.equal(hit?.pay_status, "refund_due");
  });
});

test("cancel_booking is blocked once a payment exists", { skip }, async () => {
  await inTransaction(async (db) => {
    const canceller = await db.person(["bookings.cancel", "bookings.view"], "canceller");
    const paid = await moneyBooking(db);
    await addPayment(db, paid, 200);
    assert.match((await db.error(() => db.as(canceller, "select cancel_booking($1, 'customer changed mind')", [paid]))) ?? "NOT REFUSED", /Payments exist/);
    const unpaid = await moneyBooking(db);
    assert.equal(await db.error(() => db.as(canceller, "select cancel_booking($1, 'customer changed mind')", [unpaid])), null);
    assert.equal((await db.owner("select status from bookings where id = $1", [unpaid]))[0].status, "cancelled");
  });
});

// ---------------- stage 3: the customer timeline lists credit notes and refunds ----------------

test("customer timeline lists credit notes and refunds, and their voiding", { skip }, async () => {
  await inTransaction(async (db) => {
    const issuer = await db.person([...ISSUER, "customers.view", "refunds.void"], "issuer");
    const booking = await moneyBooking(db);
    await addPayment(db, booking, 1000);
    const credit = (await issueCredit(db, issuer, booking, "Parcels returned", KEPT))[0].id as string;
    const refund = (await refundIt(db, issuer, booking, credit, 350))[0].id as string;
    const customer = (await db.owner("select customer_id from booking_contacts where booking_id = $1 and role = 'customer'", [booking]))[0].customer_id as string;
    const rows = async () => (await db.as(issuer, "select r_kind, r_title from customer_timeline($1, 100, 0)", [customer])) as { r_kind: string; r_title: string }[];
    const titles = async (kind: string) => (await rows()).filter((r) => r.r_kind === kind).map((r) => r.r_title);
    assert.match((await titles("credit_note"))[0], /^Credit note CR-\S+ issued$/);
    assert.match((await titles("refund"))[0], /^Refund RF-\S+ paid$/);
    await db.as(issuer, "select void_refund($1, 'Wrong amount')", [refund]);
    await db.as(issuer, "select void_credit_note($1, 'Issued in error')", [credit]);
    assert.ok((await titles("refund")).some((t) => /^Refund RF-\S+ voided$/.test(t)));
    assert.ok((await titles("credit_note")).some((t) => /^Credit note CR-\S+ voided$/.test(t)));
    assert.ok((await rows()).some((r) => r.r_kind === "booking"), "the existing branches are still there");
  });
});

// ---------------- final review: the payment-before-loading gate knows about credit notes and refunds ----------------

test("payment before loading: a credit note settles the balance, and a refund reopens it", { skip }, async () => {
  await inTransaction(async (db) => {
    const warehouseUser = await db.person(["warehouse.view", "warehouse.manage", "containers.view", "containers.manage"]);
    const booking = await db.booking({ invoice_no: "T-GATE-1" });
    await db.owner("update bookings set status = 'collected', invoice_amount = 1000 where id = $1", [booking]);
    const wh = (await db.owner("select id from warehouses order by code limit 1"))[0].id;
    await db.as(warehouseUser, "select split_booking($1, $2, $3::jsonb)", [booking, wh, JSON.stringify([{ description: "A", weight_kg: 5 }, { description: "B", weight_kg: 5 }])]);
    const barcodes = (await db.owner("select barcode from parcels where booking_id = $1 and status = 'in_warehouse' order by seq", [booking])).map((r) => r.barcode as string);
    const container = (await db.owner("insert into containers (destination) values ('Test') returning id"))[0].id;
    await db.owner("update app_settings set value = 'true'::jsonb where key = 'require_payment_before_loading'");
    await addPayment(db, booking, 400);
    const load = (code: string) => db.error(() => db.as(warehouseUser, "select load_parcel($1, $2, null)", [container, code]));
    assert.match((await load(barcodes[0])) ?? "", /PAYMENT_REQUIRED/); // 400 of 1000
    await addCredit(db, booking, 1000, 400); // partly returned: the invoice is now 400
    assert.equal(await load(barcodes[0]), null, "paid in full after the credit note");
    await addRefund(db, booking, 100, null); // 100 handed back: 300 of 400 is now paid
    assert.match((await load(barcodes[1])) ?? "", /PAYMENT_REQUIRED/);
  });
});

// ---------------- parcel edits: add, merge and split ----------------


/** A collected booking received into a warehouse as three parcels (P1, P2, P3), and a person who may edit parcels. */
async function receivedBooking(db: Db) {
  const worker = await db.person(["warehouse.view", "warehouse.manage"], "parcel-worker");
  const booking = await db.booking({ invoice_no: "T-PE-" + Math.floor(Math.random() * 1e6) });
  await db.owner("update bookings set status = 'collected', collected_at = now() - interval '3 days' where id = $1", [booking]);
  const wh = (await db.owner("select id from warehouses where active order by code limit 1"))[0].id as string;
  await db.as(worker, "select split_booking($1, $2, $3::jsonb)", [booking, wh, JSON.stringify([
    { description: "Box A", weight_kg: 10 }, { description: "Box B", weight_kg: 12 }, { description: "Box C", weight_kg: 8 },
  ])]);
  const code = (await db.owner("select code from bookings where id = $1", [booking]))[0].code as string;
  const parcelIds = (await db.owner("select id from parcels where booking_id = $1 order by seq", [booking])).map((r) => r.id as string);
  return { worker, booking, code, wh, parcelIds };
}
const editParcels = (db: Db, who: string, booking: string, retire: string[], news: object[], date: string | null = null) =>
  db.as(who, "select edit_parcels($1, $2::uuid[], $3::jsonb, $4::date) n", [booking, retire, JSON.stringify(news), date]);
const parcelRows = (db: Db, booking: string) => db.owner("select barcode, status, round, seq, description, weight_kg::float w, warehouse_id from parcels where booking_id = $1 order by seq", [booking]);
const editEvents = (db: Db, booking: string) => db.owner("select reason, actor_name from booking_events where booking_id = $1 and kind = 'parcels_edited' order by ctid", [booking]);

test("edit_parcels: merge retires the chosen parcels and makes one new parcel", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, code, parcelIds } = await receivedBooking(db);
    const made = (await editParcels(db, worker, booking, [parcelIds[0], parcelIds[1]], [{ description: "Boxes A and B", weight_kg: 22 }]))[0].n;
    assert.equal(made, 1);
    const rows = await parcelRows(db, booking);
    assert.deepEqual(rows.map((r) => [r.barcode, r.status, r.round]), [
      [`${code}-P1`, "repacked", 1], [`${code}-P2`, "repacked", 1], [`${code}-P3`, "in_warehouse", 1], [`${code}-R2-P1`, "in_warehouse", 2],
    ]);
    const fresh = rows[3];
    assert.deepEqual([fresh.seq, fresh.description, fresh.w], [4, "Boxes A and B", 22]);
    assert.equal(fresh.warehouse_id, rows[0].warehouse_id);
    const events = await editEvents(db, booking);
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, "Merged parcels P1 and P2 into new parcel R2-P1");
    assert.equal(events[0].actor_name, "Test parcel-worker");
  });
});

test("edit_parcels: split retires one parcel and makes several", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, code, parcelIds } = await receivedBooking(db);
    assert.equal((await editParcels(db, worker, booking, [parcelIds[1]], [{ description: "B1", weight_kg: 6 }, { description: "B2", weight_kg: 6 }]))[0].n, 2);
    const rows = await parcelRows(db, booking);
    assert.deepEqual(rows.map((r) => [r.barcode, r.status]), [
      [`${code}-P1`, "in_warehouse"], [`${code}-P2`, "repacked"], [`${code}-P3`, "in_warehouse"], [`${code}-R2-P1`, "in_warehouse"], [`${code}-R2-P2`, "in_warehouse"],
    ]);
    assert.equal((await editEvents(db, booking))[0].reason, "Split parcel P2 into new parcels R2-P1 and R2-P2");
    // three new parcels: the labels are joined with commas and "and" before the last
    assert.equal((await editParcels(db, worker, booking, [parcelIds[0]], [{ weight_kg: 3 }, { weight_kg: 3 }, { weight_kg: 4 }]))[0].n, 3);
    assert.equal((await editEvents(db, booking))[1].reason, "Split parcel P1 into new parcels R3-P1, R3-P2 and R3-P3");
  });
});

test("edit_parcels: two edits in a row use rounds 2 and 3 with unique barcodes, and untouched parcels keep their label", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, code, parcelIds } = await receivedBooking(db);
    await editParcels(db, worker, booking, [parcelIds[0], parcelIds[1]], [{ weight_kg: 22 }]);
    const merged = (await db.owner("select id from parcels where booking_id = $1 and round = 2", [booking]))[0].id as string;
    await editParcels(db, worker, booking, [merged], [{ weight_kg: 11 }, { weight_kg: 11 }]);
    const rows = await parcelRows(db, booking);
    const labels = rows.map((r) => r.barcode as string);
    assert.equal(new Set(labels).size, labels.length, "every barcode is unique");
    assert.deepEqual(labels.slice(-3), [`${code}-R2-P1`, `${code}-R3-P1`, `${code}-R3-P2`]);
    const p3 = rows.find((r) => r.barcode === `${code}-P3`);
    assert.deepEqual([p3?.status, p3?.round], ["in_warehouse", 1]);
  });
});

/** Everything an edit could change, to prove a refused edit changed nothing. */
const editState = async (db: Db, booking: string) => JSON.stringify([await parcelRows(db, booking), (await editEvents(db, booking)).length]);
const refusedEdit = async (db: Db, who: string, booking: string, retire: string[], news: object[], pattern: RegExp, date: string | null = null) => {
  const before = await editState(db, booking);
  assert.match((await db.error(() => editParcels(db, who, booking, retire, news, date))) ?? "NOT REFUSED", pattern);
  assert.equal(await editState(db, booking), before, "a refused edit changes nothing");
};

test("edit_parcels: the shape of the edit must be merge or split", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, parcelIds } = await receivedBooking(db);
    const one = [{ weight_kg: 1 }];
    const two = [{ weight_kg: 1 }, { weight_kg: 1 }];
    // adding a parcel is not offered: extra cargo is a new booking
    await refusedEdit(db, worker, booking, [], two, /Choose the parcels to change/);
    await refusedEdit(db, worker, booking, [], one, /Choose the parcels to change/);
    await refusedEdit(db, worker, booking, [], [], /Choose the parcels to change/);
    await refusedEdit(db, worker, booking, [parcelIds[0]], one, /Splitting needs two or more new parcels/);
    await refusedEdit(db, worker, booking, [parcelIds[0], parcelIds[1]], two, /Merging makes exactly one new parcel/);
    await refusedEdit(db, worker, booking, [parcelIds[0], parcelIds[1]], [], /Merging makes exactly one new parcel/);
    await refusedEdit(db, worker, booking, [parcelIds[0], parcelIds[0]], one, /The same parcel was chosen twice/);
    await refusedEdit(db, worker, booking, [parcelIds[0], parcelIds[0]], two, /The same parcel was chosen twice/); // the duplicate is named first, whatever the number of new parcels
  });
});

test("edit_parcels: only parcels of this booking that are in the warehouse can be changed", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, wh, parcelIds } = await receivedBooking(db);
    const other = await db.booking({ invoice_no: "T-PE-OTHER" });
    await db.owner("update bookings set status = 'collected' where id = $1", [other]);
    await db.as(worker, "select split_booking($1, $2, $3::jsonb)", [other, wh, JSON.stringify([{ weight_kg: 1 }, { weight_kg: 1 }])]);
    const foreign = (await db.owner("select id from parcels where booking_id = $1 order by seq", [other])).map((r) => r.id as string);
    const msg = /Only parcels of this booking that are in the warehouse can be changed/;
    const split = [{ weight_kg: 1 }, { weight_kg: 1 }];
    await refusedEdit(db, worker, booking, [foreign[0]], split, msg);
    await refusedEdit(db, worker, booking, [parcelIds[0], foreign[0]], [{ weight_kg: 2 }], msg);
    await refusedEdit(db, worker, booking, [randomUuid()], split, msg);
    await db.owner("update parcels set status = 'loaded' where id = $1", [parcelIds[0]]);
    await refusedEdit(db, worker, booking, [parcelIds[0]], split, msg);
    await db.owner("update parcels set status = 'in_transit' where id = $1", [parcelIds[0]]);
    await refusedEdit(db, worker, booking, [parcelIds[0], parcelIds[1]], [{ weight_kg: 2 }], msg);
    await db.as(worker, "select prepare_return($1, $2::uuid[])", [booking, [parcelIds[1]]]); // ready for return: on a return form
    await refusedEdit(db, worker, booking, [parcelIds[1]], split, msg);
    await db.owner("update parcels set status = 'repacked' where id = $1", [parcelIds[2]]);
    await refusedEdit(db, worker, booking, [parcelIds[2]], split, msg);
  });
});
const randomUuid = () => "00000000-0000-4000-8000-" + String(Math.floor(Math.random() * 1e12)).padStart(12, "0");

test("edit_parcels: booking, weights, warehouse, dates and permission", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, code, wh, parcelIds } = await receivedBooking(db);
    const two = [{ weight_kg: 1 }, { weight_kg: 1 }];
    assert.match((await db.error(() => editParcels(db, worker, randomUuid(), [parcelIds[0]], two))) ?? "", /Booking not found/);
    const fresh = await db.booking({ invoice_no: "T-PE-BOOKED" }); // still booked, not collected
    assert.match((await db.error(() => editParcels(db, worker, fresh, [parcelIds[0]], two))) ?? "", /has not been collected yet/);
    await refusedEdit(db, worker, booking, [parcelIds[0]], [{ weight_kg: 1 }, { weight_kg: -0.5 }], /A parcel weight cannot be negative/);
    await db.owner("update warehouses set active = false where id = $1", [wh]);
    await refusedEdit(db, worker, booking, [parcelIds[0]], two, /is not active/);
    await db.owner("update warehouses set active = true where id = $1", [wh]);
    const collected = (await db.owner("select ((collected_at at time zone 'Asia/Dubai')::date)::text d from bookings where id = $1", [booking]))[0].d as string;
    const day = await daysFromToday(db, 0);
    assert.ok(collected, "the fixture has a collection day");
    await refusedEdit(db, worker, booking, [parcelIds[0]], two, /Received cannot be before the collection date/, "2000-01-01");
    await refusedEdit(db, worker, booking, [parcelIds[0]], two, /future|cannot be in the/i, await daysFromToday(db, 5));
    // weight 0 and no description are fine, and so is today's date
    assert.equal((await editParcels(db, worker, booking, [parcelIds[0]], [{ weight_kg: 0 }, { weight_kg: 0 }], day))[0].n, 2);
    assert.equal((await parcelRows(db, booking)).at(-1)?.barcode, `${code}-R2-P2`);
    // permission
    const viewer = await db.person(["warehouse.view"], "viewer-only");
    assert.match((await db.error(() => editParcels(db, viewer, booking, [parcelIds[1]], two))) ?? "", /permission/i);
    assert.match((await db.error(() => db.anonymous("select edit_parcels($1, '{}'::uuid[], '[]'::jsonb, null)", [booking]))) ?? "", /permission denied/i);
  });
});

test("edit_parcels: the customer timeline labels parcel edits, and still lists credit notes", { skip }, async () => {
  await inTransaction(async (db) => {
    const { worker, booking, parcelIds } = await receivedBooking(db);
    await db.owner("update bookings set invoice_amount = 1000 where id = $1", [booking]);
    await addCredit(db, booking, 1000, 400);
    await editParcels(db, worker, booking, [parcelIds[0], parcelIds[1]], [{ weight_kg: 22 }]);
    const viewer = await db.person(["customers.view"], "timeline-viewer");
    const customer = (await db.owner("select customer_id from booking_contacts where booking_id = $1 and role = 'customer'", [booking]))[0].customer_id as string;
    const rows = (await db.as(viewer, "select r_kind, r_title, r_detail from customer_timeline($1, 100, 0)", [customer])) as { r_kind: string; r_title: string; r_detail: string }[];
    const edit = rows.find((r) => r.r_title === "Parcels changed");
    assert.ok(edit, "the parcel edit is on the customer's history");
    assert.match(edit.r_detail, /^Merged parcels P1 and P2 into new parcel R2-P1$/);
    assert.ok(!rows.some((r) => r.r_title === "Cancelled"), "never shown as Cancelled");
    assert.ok(rows.some((r) => r.r_kind === "credit_note" && /^Credit note .* issued$/.test(r.r_title)), "credit notes are still listed");
  });
});

// ---------------- packing list: item order and move up / down ----------------
const PACKING_MIGRATION = "supabase/migrations/0060_packing_list.sql";

test("packing list: existing items keep today's order and new items go last", { skip }, async () => {
  await inTransaction(async (db) => {
    const booking = await db.booking({ invoice_no: "T-PL-A" });
    const other = await db.booking({ invoice_no: "T-PL-B" });
    // go back to the state before the migration (this also works once it is live), then add items in a mixed insert order
    await db.owner("set local lock_timeout = '3s'"); // these tests change the table inside a transaction that is rolled back: never wait long for a lock
    await db.owner("drop trigger if exists booking_items_set_position on booking_items"); // the live trigger needs the column
    await db.owner("alter table booking_items drop column if exists position");
    const add = (id: string, b: string, name: string) => db.owner("insert into booking_items (id, booking_id, description, quantity, weight_kg) values ($1, $2, $3, 1, 5)", [id, b, name]);
    await add("00000000-0000-4000-8000-000000000003", booking, "third by id");
    await add("00000000-0000-4000-8000-000000000001", booking, "first by id");
    await add("00000000-0000-4000-8000-000000000002", booking, "second by id");
    await add("00000000-0000-4000-8000-000000000009", other, "other booking");
    await db.owner(readFileSync(PACKING_MIGRATION, "utf8"));
    const order = async (b: string) => (await db.owner("select description, position from booking_items where booking_id = $1 order by position, id", [b])).map((r) => [r.description, r.position]);
    assert.deepEqual(await order(booking), [["first by id", 1], ["second by id", 2], ["third by id", 3]]);
    assert.deepEqual(await order(other), [["other booking", 1]]);
    // the numbering is housekeeping, not a change anyone made: it must not flood the Activity log
    const logged = await db.owner("select count(*)::int n from audit_log where table_name = 'booking_items' and action = 'update' and booking_id in ($1, $2)", [booking, other]);
    assert.equal(logged[0].n, 0, "the backfill writes no change-log entries");
    // a new item goes last, without anyone giving it a position
    await db.owner("insert into booking_items (booking_id, description, quantity, weight_kg) values ($1, 'newest', 1, 5)", [booking]);
    assert.deepEqual((await order(booking)).at(-1), ["newest", 4]);
    // a removed item leaves a gap, which is fine: the order is what counts
    await db.owner("delete from booking_items where id = '00000000-0000-4000-8000-000000000002'");
    assert.deepEqual((await order(booking)).map((r) => r[1]), [1, 3, 4]);
  });
});

/** A booking with n items named I1..In (positions 1..n), plus a person who may edit items. */
async function packingBooking(db: Db, n = 3, over: Row = {}) {
  const booking = await db.booking({ invoice_no: "T-PL-" + Math.floor(Math.random() * 1e6) });
  if (over.status) await db.owner("update bookings set status = $2 where id = $1", [booking, over.status]);
  for (let i = 1; i <= n; i++) await db.owner("insert into booking_items (booking_id, description, quantity, weight_kg) values ($1, $2, 1, 5)", [booking, `I${i}`]);
  const ids = (await db.owner("select id from booking_items where booking_id = $1 order by position", [booking])).map((r) => r.id as string);
  const editor = await db.person(["bookings.view", "items.edit", "items.edit_after"], "item-editor");
  return { booking, ids, editor };
}
const listOrder = async (db: Db, booking: string) => (await db.owner("select description from booking_items where booking_id = $1 order by position, id", [booking])).map((r) => r.description as string);
const moveItem = (db: Db, who: string, item: string, direction: string) => db.as(who, "select move_booking_item($1, $2)", [item, direction]);

test("move_booking_item: up and down swap with the neighbour", { skip }, async () => {
  await inTransaction(async (db) => {
    const { booking, ids, editor } = await packingBooking(db);
    await moveItem(db, editor, ids[1], "up");
    assert.deepEqual(await listOrder(db, booking), ["I2", "I1", "I3"]);
    await moveItem(db, editor, ids[0], "down"); // I1 is now second
    assert.deepEqual(await listOrder(db, booking), ["I2", "I3", "I1"]);
  });
});

test("move_booking_item: the edges and bad input are refused and change nothing", { skip }, async () => {
  await inTransaction(async (db) => {
    const { booking, ids, editor } = await packingBooking(db);
    const refused = async (item: string, dir: string, pattern: RegExp) => {
      assert.match((await db.error(() => moveItem(db, editor, item, dir))) ?? "NOT REFUSED", pattern);
      assert.deepEqual(await listOrder(db, booking), ["I1", "I2", "I3"]);
    };
    await refused(ids[0], "up", /It is already first/);
    await refused(ids[2], "down", /It is already last/);
    await refused(ids[1], "sideways", /Direction must be up or down/);
    await refused("00000000-0000-4000-8000-0000000000ff", "up", /Item not found/);
  });
});

test("move_booking_item: only people who may edit the items can move them", { skip }, async () => {
  await inTransaction(async (db) => {
    const { booking, ids } = await packingBooking(db);
    const viewer = await db.person(["bookings.view"], "viewer");
    assert.match((await db.error(() => moveItem(db, viewer, ids[1], "up"))) ?? "NOT REFUSED", /You cannot change this packing list/);
    assert.deepEqual(await listOrder(db, booking), ["I1", "I2", "I3"]);
    // before collection (booked): items.edit is enough; after collection it is not
    const before = await db.person(["bookings.view", "items.edit"], "before-only");
    await moveItem(db, before, ids[1], "up");
    assert.deepEqual(await listOrder(db, booking), ["I2", "I1", "I3"]);
    await db.owner("update bookings set status = 'collected' where id = $1", [booking]);
    assert.match((await db.error(() => moveItem(db, before, ids[2], "up"))) ?? "NOT REFUSED", /You cannot change this packing list/);
    assert.deepEqual(await listOrder(db, booking), ["I2", "I1", "I3"]);
    const after = await db.person(["bookings.view", "items.edit_after"], "after-allowed");
    await moveItem(db, after, ids[2], "up");
    assert.deepEqual(await listOrder(db, booking), ["I2", "I3", "I1"]);
    assert.match((await db.error(() => db.anonymous("select move_booking_item($1, 'up')", [ids[1]]))) ?? "NOT REFUSED", /permission denied/i);
  });
});

test("move_booking_item: other bookings are untouched and repeated moves give the expected order", { skip }, async () => {
  await inTransaction(async (db) => {
    const { booking, ids, editor } = await packingBooking(db, 5);
    const other = await db.booking({ invoice_no: "T-PL-OTHER" });
    for (const n of ["O1", "O2"]) await db.owner("insert into booking_items (booking_id, description, quantity, weight_kg) values ($1, $2, 1, 5)", [other, n]);
    const before = await listOrder(db, other);
    await moveItem(db, editor, ids[4], "up");
    await moveItem(db, editor, ids[4], "up");
    assert.deepEqual(await listOrder(db, booking), ["I1", "I2", "I5", "I3", "I4"]);
    assert.deepEqual(await listOrder(db, other), before);
    // positions stay distinct inside the booking
    const positions = (await db.owner("select position from booking_items where booking_id = $1", [booking])).map((r) => r.position);
    assert.equal(new Set(positions).size, positions.length);
  });
});

test("move_booking_item: two items that share a position are renumbered and then move normally", { skip }, async () => {
  await inTransaction(async (db) => {
    const { booking, ids, editor } = await packingBooking(db);
    // two people added an item at the same moment and both got position 2 (simulated)
    await db.owner("update booking_items set position = 2 where id = $1", [ids[2]]);
    const tied = (await db.owner("select id, description from booking_items where booking_id = $1 and position = 2 order by id", [booking])) as { id: string; description: string }[];
    assert.equal(tied.length, 2);
    await moveItem(db, editor, tied[1].id, "up"); // the later of the pair goes before the earlier one
    assert.deepEqual(await listOrder(db, booking), ["I1", tied[1].description, tied[0].description]);
    const positions = (await db.owner("select position from booking_items where booking_id = $1", [booking])).map((r) => r.position);
    assert.equal(new Set(positions).size, positions.length, "positions are distinct again");
  });
});

// ---------------- sales rep (customer owner) ----------------
const newCustomer = async (db: Db, name = "Owned Customer") => (await db.owner("insert into customers (full_name) values ($1) returning id", [name]))[0].id as string;
const repOf = async (db: Db, table: "bookings" | "customers", id: string) => (await db.owner(`select sales_rep_id, sales_rep_name from ${table} where id = $1`, [id]))[0] as { sales_rep_id: string | null; sales_rep_name: string | null };

test("sales rep: the name is copied and cleared", { skip }, async () => {
  await inTransaction(async (db) => {
    const rep = await db.person(["bookings.view"], "Rep One");
    const booking = await db.booking({ invoice_no: "T-SR-1" });
    const customer = await newCustomer(db);
    for (const [table, id] of [["bookings", booking], ["customers", customer]] as const) {
      await db.owner(`update ${table} set sales_rep_id = $2 where id = $1`, [id, rep]);
      assert.deepEqual(await repOf(db, table, id), { sales_rep_id: rep, sales_rep_name: "Test Rep One" });
      await db.owner(`update ${table} set sales_rep_id = null where id = $1`, [id]);
      assert.deepEqual(await repOf(db, table, id), { sales_rep_id: null, sales_rep_name: null });
    }
  });
});

test("sales rep: only active staff can be chosen", { skip }, async () => {
  await inTransaction(async (db) => {
    const gone = await db.person(["bookings.view"], "Inactive Rep");
    await db.owner("update profiles set active = false where id = $1", [gone]);
    const booking = await db.booking({ invoice_no: "T-SR-2" });
    const customer = await newCustomer(db);
    for (const [table, id] of [["bookings", booking], ["customers", customer]] as const) {
      for (const who of [gone, "00000000-0000-4000-8000-0000000000ee"]) {
        assert.match((await db.error(() => db.owner(`update ${table} set sales_rep_id = $2 where id = $1`, [id, who]))) ?? "NOT REFUSED", /That person is not active staff/);
      }
      assert.deepEqual(await repOf(db, table, id), { sales_rep_id: null, sales_rep_name: null });
    }
  });
});

test("sales rep: changing needs the permission, creating does not", { skip }, async () => {
  await inTransaction(async (db) => {
    const rep = await db.person(["bookings.view"], "Chosen Rep");
    const staff = await db.person(["bookings.view", "bookings.create", "bookings.edit", "customers.view", "customers.edit"], "plain-staff");
    const manager = await db.person(["bookings.view", "bookings.edit", "customers.view", "customers.edit", "sales_rep.change"], "a-manager");
    const booking = await db.booking({ invoice_no: "T-SR-3" });
    const customer = await newCustomer(db);
    const refused = /Only managers can change the sales rep/;
    // plain staff: refused on update, for a booking and for a customer
    assert.match((await db.error(() => db.as(staff, "update bookings set sales_rep_id = $2 where id = $1", [booking, rep]))) ?? "NOT REFUSED", refused);
    assert.match((await db.error(() => db.as(staff, "select set_customer_sales_rep($1, $2)", [customer, rep]))) ?? "NOT REFUSED", refused);
    // an update that does not touch the rep is fine
    await db.as(staff, "update bookings set notes = 'hello' where id = $1", [booking]);
    // creating a booking with a rep needs nothing extra
    const created = await db.as(staff, "insert into bookings (sender_name, sender_phone, pickup_area, pickup_address, pickup_date, sales_rep_id) values ('New', '+971500000999', 'Dubai', 'Somewhere', current_date, $1) returning id", [rep]);
    assert.equal((await repOf(db, "bookings", created[0].id)).sales_rep_name, "Test Chosen Rep");
    // a manager can change both
    await db.as(manager, "update bookings set sales_rep_id = $2 where id = $1", [booking, rep]);
    await db.as(manager, "select set_customer_sales_rep($1, $2)", [customer, rep]);
    assert.equal((await repOf(db, "bookings", booking)).sales_rep_id, rep);
    assert.equal((await repOf(db, "customers", customer)).sales_rep_id, rep);
    // and can clear it
    await db.as(manager, "select set_customer_sales_rep($1, null)", [customer]);
    assert.equal((await repOf(db, "customers", customer)).sales_rep_id, null);
    assert.match((await db.error(() => db.anonymous("select set_customer_sales_rep($1, null)", [customer]))) ?? "NOT REFUSED", /permission denied/i);
  });
});

test("sales rep: the permission goes to managers and super admins only", { skip }, async () => {
  await inTransaction(async (db) => {
    const roles = (await db.owner("select role from role_permissions where permission = 'sales_rep.change' order by role")).map((r) => r.role);
    assert.deepEqual(roles, ["manager", "super_admin"]);
    assert.equal((await db.owner("select label from permissions where key = 'sales_rep.change'"))[0].label, "Change the sales rep (owner)");
  });
});

test("sales_rep_choices: active staff only, for people who may pick one", { skip }, async () => {
  await inTransaction(async (db) => {
    const active = await db.person(["bookings.view"], "Zed Active");
    const inactive = await db.person(["bookings.view"], "Alf Inactive");
    await db.owner("update profiles set active = false where id = $1", [inactive]);
    for (const perm of ["bookings.create", "customers.edit", "sales_rep.change"]) {
      const who = await db.person([perm], `picker-${perm}`);
      const list = (await db.as(who, "select sales_rep_choices() c", []))[0].c as { id: string; name: string }[];
      assert.ok(list.some((x) => x.id === active && x.name === "Test Zed Active"), `${perm}: active staff are listed`);
      assert.ok(!list.some((x) => x.id === inactive), `${perm}: inactive staff are not`);
      assert.deepEqual(list.map((x) => x.name), [...list.map((x) => x.name)].sort((a, b) => a.localeCompare(b)), "ordered by name");
    }
    const viewer = await db.person(["bookings.view"], "viewer-only");
    assert.match((await db.error(() => db.as(viewer, "select sales_rep_choices()"))) ?? "NOT REFUSED", /permission/i);
    assert.match((await db.error(() => db.anonymous("select sales_rep_choices()"))) ?? "NOT REFUSED", /permission denied/i);
  });
});

test("sales rep: a removed person leaves the old name on old records", { skip }, async () => {
  await inTransaction(async (db) => {
    const rep = await db.person(["bookings.view"], "Leaver");
    const booking = await db.booking({ invoice_no: "T-SR-6" });
    await db.owner("update bookings set sales_rep_id = $2 where id = $1", [booking, rep]);
    await db.owner("delete from profiles where id = $1", [rep]);
    assert.deepEqual(await repOf(db, "bookings", booking), { sales_rep_id: null, sales_rep_name: "Test Leaver" });
  });
});

/** A booking inserted with a rep and a phone; returns the booking id and the customer the app linked or created for it. */
async function bookingWithRep(db: Db, phone: string, rep: string | null, name = "Rep Test") {
  const b = (await db.owner("insert into bookings (sender_name, sender_phone, pickup_area, pickup_address, pickup_date, sales_rep_id) values ($3, $1, 'Dubai', 'Somewhere', current_date, $2) returning id", [phone, rep, name]))[0].id as string;
  const customer = (await db.owner("select customer_id from booking_contacts where booking_id = $1 and role = 'customer'", [b]))[0].customer_id as string;
  return { booking: b, customer };
}

test("sales rep: a booking for a new customer gives the customer the same owner", { skip }, async () => {
  await inTransaction(async (db) => {
    const rep = await db.person(["bookings.view"], "Rep Alpha");
    const { customer } = await bookingWithRep(db, "+971500777001", rep);
    assert.deepEqual(await repOf(db, "customers", customer), { sales_rep_id: rep, sales_rep_name: "Test Rep Alpha" });
  });
});

test("sales rep: a booking for an existing customer leaves their owner alone", { skip }, async () => {
  await inTransaction(async (db) => {
    const alpha = await db.person(["bookings.view"], "Rep Alpha");
    const beta = await db.person(["bookings.view"], "Rep Beta");
    const first = await bookingWithRep(db, "+971500777002", alpha);
    const second = await bookingWithRep(db, "+971500777002", beta); // same phone: the same customer
    assert.equal(second.customer, first.customer);
    assert.equal((await repOf(db, "customers", first.customer)).sales_rep_id, alpha, "the owner is unchanged");
    assert.equal((await repOf(db, "bookings", second.booking)).sales_rep_id, beta, "the booking keeps its own rep");
    // a customer with no owner is not given one by a later booking
    const { customer } = await bookingWithRep(db, "+971500777003", null);
    await bookingWithRep(db, "+971500777003", alpha);
    assert.equal((await repOf(db, "customers", customer)).sales_rep_id, null);
  });
});

test("sales rep: a customer added by hand, or made from a booking, gets an owner", { skip }, async () => {
  await inTransaction(async (db) => {
    const creator = await db.person(["customers.view", "customers.edit"], "Creator");
    const made = (await db.as(creator, "select create_customer('By Hand', '+971500777004', null, null, null, null, null) id"))[0].id as string;
    assert.deepEqual(await repOf(db, "customers", made), { sales_rep_id: creator, sales_rep_name: "Test Creator" });
    const rep = await db.person(["bookings.view"], "Rep Gamma");
    const { booking } = await bookingWithRep(db, "+971500777005", rep);
    const fresh = (await db.as(creator, "select create_customer_from_booking($1) id", [booking]))[0].id as string;
    assert.equal((await repOf(db, "customers", fresh)).sales_rep_id, rep, "copied from the booking");
  });
});

test("sales rep: changing a customer's owner leaves their old bookings alone", { skip }, async () => {
  await inTransaction(async (db) => {
    const alpha = await db.person(["bookings.view"], "Rep Alpha");
    const beta = await db.person(["bookings.view"], "Rep Beta");
    const manager = await db.person(["customers.view", "sales_rep.change"], "Boss");
    const { booking, customer } = await bookingWithRep(db, "+971500777006", alpha);
    await db.as(manager, "select set_customer_sales_rep($1, $2)", [customer, beta]);
    assert.equal((await repOf(db, "customers", customer)).sales_rep_id, beta);
    assert.equal((await repOf(db, "bookings", booking)).sales_rep_id, alpha, "the old booking keeps the rep who made that sale");
  });
});

test("sales rep: Accounts, global search and customer search carry the rep", { skip }, async () => {
  await inTransaction(async (db) => {
    const rep = await db.person(["bookings.view"], "Rep Delta");
    const viewer = await db.person(["accounts.view", "bookings.view", "customers.view"], "list-viewer");
    const withRep = await bookingWithRep(db, "+971500777011", rep, "Zzowner Qxone");
    const without = await bookingWithRep(db, "+971500777012", null, "Zzowner Qxtwo");
    await db.owner("update bookings set invoice_no = 'T-SR-INV1' where id = $1", [withRep.booking]);
    await db.owner("update bookings set invoice_no = 'T-SR-INV2' where id = $1", [without.booking]);
    // Accounts list
    const inv = (await db.as(viewer, "select r_invoice_no, r_sales_rep, r_amount from accounts_invoices('all', 'T-SR-INV', 10, 0) order by r_invoice_no")) as { r_invoice_no: string; r_sales_rep: string | null }[];
    assert.deepEqual(inv.map((r) => [r.r_invoice_no, r.r_sales_rep]), [["T-SR-INV1", "Test Rep Delta"], ["T-SR-INV2", null]]);
    // the Accounts list sorts by the rep too, people with none last either way
    const byRep = async (dir: string) => ((await db.as(viewer, "select r_invoice_no from accounts_invoices('all', 'T-SR-INV', 10, 0, 'salesrep', $1)", [dir])) as { r_invoice_no: string }[]).map((r) => r.r_invoice_no);
    assert.deepEqual(await byRep("asc"), ["T-SR-INV1", "T-SR-INV2"]);
    assert.deepEqual(await byRep("desc"), ["T-SR-INV1", "T-SR-INV2"]);
    // global search: booking hits and customer hits
    const g = (await db.as(viewer, "select global_search('Zzowner', 10) g"))[0].g as { bookings: Row[]; customers: Row[] };
    assert.deepEqual(g.bookings.map((b) => [b.sender_name, b.sales_rep]).sort(), [["Zzowner Qxone", "Test Rep Delta"], ["Zzowner Qxtwo", null]]);
    assert.deepEqual(g.customers.map((c) => [c.full_name, c.sales_rep]).sort(), [["Zzowner Qxone", "Test Rep Delta"], ["Zzowner Qxtwo", null]]);
    // customer search
    const cs = (await db.as(viewer, "select search_customers('Zzowner', 10) r"))[0].r as { customers: Row[] };
    assert.deepEqual(cs.customers.map((c) => [c.full_name, c.sales_rep_id, c.sales_rep]).sort(), [["Zzowner Qxone", rep, "Test Rep Delta"], ["Zzowner Qxtwo", null, null]]);
    // sorting by the owner (the customers list has a sortable Owner column); people with no owner go last either way
    const alpha = await db.person(["bookings.view"], "Alpha Rep");
    await bookingWithRep(db, "+971500777013", alpha, "Zzowner Qxthree");
    const order = async (dir: string) => ((await db.as(viewer, "select search_customers('Zzowner', 10, 'owner', $1) r", [dir]))[0].r as { customers: Row[] }).customers.map((c) => c.full_name);
    assert.deepEqual(await order("asc"), ["Zzowner Qxthree", "Zzowner Qxone", "Zzowner Qxtwo"]);
    assert.deepEqual(await order("desc"), ["Zzowner Qxone", "Zzowner Qxthree", "Zzowner Qxtwo"]);
  });
});

test("sales rep: the default customers list carries the owner and sorts by it", { skip }, async () => {
  await inTransaction(async (db) => {
    const viewer = await db.person(["customers.view"], "list-viewer-2");
    const alpha = await db.person(["bookings.view"], "Alpha Lister");
    await bookingWithRep(db, "+971500777021", alpha, "Zzlist Qxone");
    await bookingWithRep(db, "+971500777022", null, "Zzlist Qxtwo");
    const all = (await db.as(viewer, "select list_customers(200, 0, 'owner', 'asc') r"))[0].r as { customers: Row[] };
    const mine = all.customers.filter((c) => String(c.full_name).startsWith("Zzlist"));
    assert.deepEqual(mine.map((c) => [c.full_name, c.sales_rep_id, c.sales_rep]), [["Zzlist Qxone", alpha, "Test Alpha Lister"], ["Zzlist Qxtwo", null, null]]);
    const firstOwned = all.customers.findIndex((c) => c.sales_rep != null);
    const firstEmpty = all.customers.findIndex((c) => c.sales_rep == null);
    assert.ok(firstOwned === -1 || firstEmpty === -1 || firstOwned < firstEmpty, "people with no owner come last");
  });
});

test("sales rep: the rep's name cannot be written by hand", { skip }, async () => {
  await inTransaction(async (db) => {
    const editor = await db.person(["bookings.view", "bookings.edit"], "plain-editor");
    const rep = await db.person(["bookings.view"], "Real Rep");
    const booking = await db.booking({ invoice_no: "T-SR-9" });
    await db.owner("update bookings set sales_rep_id = $2 where id = $1", [booking, rep]);
    await db.as(editor, "update bookings set sales_rep_name = 'Somebody Else' where id = $1", [booking]);
    assert.equal((await repOf(db, "bookings", booking)).sales_rep_name, "Test Real Rep", "the name follows the id, nothing else");
    // with no rep, a hand-written name does not stick either
    const bare = await db.booking({ invoice_no: "T-SR-10" });
    await db.as(editor, "update bookings set sales_rep_name = 'Nobody' where id = $1", [bare]);
    assert.equal((await repOf(db, "bookings", bare)).sales_rep_name, null);
  });
});

test("sales rep: merging customers keeps an owner, even for people who may merge but not change owners", { skip }, async () => {
  await inTransaction(async (db) => {
    const merger = await db.person(["customers.view", "customers.manage"], "merger-only");
    const sara = await db.person(["bookings.view"], "Sara Rep");
    const keep = await newCustomer(db, "Keep Me");
    const remove = await newCustomer(db, "Remove Me");
    await db.owner("update customers set sales_rep_id = $2 where id = $1", [remove, sara]);
    await db.as(merger, "select merge_customers($1, $2)", [keep, remove]);
    assert.deepEqual(await repOf(db, "customers", keep), { sales_rep_id: sara, sales_rep_name: "Test Sara Rep" });
    // when the kept customer already has an owner, that owner stays
    const other = await db.person(["bookings.view"], "Other Rep");
    const keep2 = await newCustomer(db, "Keep Two");
    const remove2 = await newCustomer(db, "Remove Two");
    await db.owner("update customers set sales_rep_id = $2 where id = $1", [keep2, other]);
    await db.owner("update customers set sales_rep_id = $2 where id = $1", [remove2, sara]);
    await db.as(merger, "select merge_customers($1, $2)", [keep2, remove2]);
    assert.equal((await repOf(db, "customers", keep2)).sales_rep_id, other);
    // a person who may merge still cannot change an owner by hand
    const target = await newCustomer(db, "No Hand Change");
    assert.match((await db.error(() => db.as(merger, "select set_customer_sales_rep($1, $2)", [target, sara]))) ?? "NOT REFUSED", /Only managers can change the sales rep/);
  });
});

// ---------------- staff rewards (migration 0062) ----------------
// Until the migration is live, each test applies the file inside its own rolled-back transaction.
const REWARDS_MIGRATION = "supabase/migrations/0062_staff_rewards.sql";
const withRewards = (db: Db) => db.owner(readFileSync(REWARDS_MIGRATION, "utf8"));

test("rewards: the tables exist, browser roles cannot write them, and the seed is there", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const staff = await db.person([], "plain staff");
    assert.match((await db.error(() => db.as(staff, "insert into point_log (person_id, rule_key, points, reason) values ($1, 'x', 1, 'x')", [staff]))) ?? "", /permission denied|row-level security/);
    assert.match((await db.error(() => db.as(staff, "insert into person_badges (person_id, badge_key) values ($1, 'x')", [staff]))) ?? "", /permission denied|row-level security/);
    assert.match((await db.error(() => db.as(staff, "update point_rules set points = 999"))) ?? "", /permission denied|row-level security/);
    assert.equal((await db.owner("select count(*)::int n from levels"))[0].n, 8);
    assert.equal((await db.owner("select count(*)::int n from point_rules"))[0].n, 13);
    assert.equal((await db.owner("select count(*)::int n from badges where kind = 'manual'"))[0].n, 1);
    assert.deepEqual((await db.owner("select key from permissions where key like 'rewards.%' order by key")).map((r) => r.key), ["rewards.give", "rewards.manage"]);
    assert.deepEqual((await db.owner("select role from role_permissions where permission = 'rewards.give' order by role")).map((r) => r.role), ["manager", "super_admin"]);
  });
});

test("rewards: update_my_profile changes only the caller's own row and checks the about line", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const me = await db.person([], "me");
    const other = await db.person([], "other");
    await db.as(me, "select update_my_profile(null, 14, 3, true, 'Loves forklifts', '+971500000001')");
    const mine = (await db.owner("select about, phone, birthday_day, birthday_month, hide_birthday from profiles where id = $1", [me]))[0];
    assert.deepEqual(mine, { about: "Loves forklifts", phone: "+971500000001", birthday_day: 14, birthday_month: 3, hide_birthday: true });
    assert.equal((await db.owner("select about from profiles where id = $1", [other]))[0].about, null);
    assert.match((await db.error(() => db.as(me, "select update_my_profile(null, null, null, false, $1, null)", ["x".repeat(201)]))) ?? "", /200/);
    assert.match((await db.error(() => db.as(me, "select update_my_profile(null, 31, 2, false, null, null)"))) ?? "", /birthday/i);
    // a photo path must be inside the caller's own folder
    assert.match((await db.error(() => db.as(me, "select update_my_profile($1, null, null, false, null, null)", [`${other}/me.jpg`]))) ?? "", /your own folder/);
    assert.equal(await db.error(() => db.as(me, "select update_my_profile($1, null, null, false, null, null)", [`${me}/me.jpg`])), null);
  });
});

test("rewards: team, job title and joined date are changed only by people who manage users", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const staff = await db.person([], "staff");
    const boss = await db.person(["users.manage"], "boss");
    assert.match((await db.error(() => db.as(staff, "select set_staff_details($1, 'sales', 'Rep', '2024-03-01')", [staff]))) ?? "", /permission/i);
    await db.as(boss, "select set_staff_details($1, 'sales', 'Sales rep', '2024-03-01')", [staff]);
    const row = (await db.owner("select team, job_title, joined_on::text from profiles where id = $1", [staff]))[0];
    assert.deepEqual(row, { team: "sales", job_title: "Sales rep", joined_on: "2024-03-01" });
    assert.match((await db.error(() => db.as(boss, "select set_staff_details($1, 'pirates', null, null)", [staff]))) ?? "", /team/i);
  });
});

test("rewards: the people directory hides a hidden birthday and other people's phone", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const a = await db.person([], "a");
    const b = await db.person([], "b");
    const manager = await db.person(["rewards.manage"], "mgr");
    await db.as(a, "select update_my_profile(null, 5, 6, true, null, '+971500000111')");
    await db.as(b, "select update_my_profile(null, 7, 8, false, null, '+971500000222')");
    const look = async (who: string, id: string) => (await db.as(who, "select birthday_day, birthday_month, phone from people_directory() where id = $1", [id]))[0];
    assert.deepEqual(await look(b, a), { birthday_day: null, birthday_month: null, phone: null }); // hidden birthday, someone else's phone
    assert.deepEqual(await look(a, b), { birthday_day: 7, birthday_month: 8, phone: null }); // shown birthday, someone else's phone
    assert.deepEqual(await look(a, a), { birthday_day: 5, birthday_month: 6, phone: "+971500000111" }); // my own, hidden from others but not from me
    assert.equal((await look(manager, b)).phone, "+971500000222"); // managers see phones
    assert.deepEqual(await look(manager, a), { birthday_day: null, birthday_month: null, phone: "+971500000111" }); // the hidden birthday stays hidden even from managers
  });
});

// Run a statement as a signed-in person but with the owner's rights (so the test needs no permission setup); triggers see auth.uid().
const actAs = (db: Db, uid: string, sql: string) =>
  db.owner(`select set_config('request.jwt.claim.sub', '${uid}', true), set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); ${sql}`);
const newBookingAs = async (db: Db, uid: string) => {
  await actAs(db, uid, "insert into bookings (sender_name, sender_phone, pickup_area, pickup_address, pickup_date) values ('Rewards Test', '+971500000321', 'Dubai', 'Somewhere', current_date)");
  return (await db.owner("select id, code from bookings where sender_name = 'Rewards Test' order by created_at desc limit 1"))[0] as { id: string; code: string };
};
const lines = (db: Db, who: string) => db.owner("select rule_key, points, reason from point_log where person_id = $1 order by id", [who]);
const total = async (db: Db, who: string) => (await db.as(who, "select (my_rewards()->>'total')::int t"))[0].t as number;

test("rewards: a booking pays its creator once, and paying the same record twice pays nothing", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const me = await db.person([], "creator");
    const b = await newBookingAs(db, me);
    const got = await lines(db, me);
    assert.equal(got.length, 1);
    assert.equal(got[0].rule_key, "booking_created");
    assert.equal(got[0].points, 5);
    assert.match(got[0].reason, new RegExp(b.code));
    assert.equal((await db.owner("select award_points($1, 'booking_created', 'bookings', $2, 'again') p", [me, b.id]))[0].p, 0);
    assert.equal((await lines(db, me)).length, 1);
  });
});

test("rewards: payments, collected pickups and parcel moves pay the person who did them", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const me = await db.person([], "worker");
    const booking = await db.booking({ invoice_no: "T-RW-1" });
    await actAs(db, me, `insert into payments (booking_id, amount, method) values ('${booking}', 10, 'cash')`);
    await actAs(db, me, `update bookings set status = 'collected' where id = '${booking}'`);
    const wh = (await db.owner("select id from warehouses limit 1"))[0]?.id ?? (await db.owner("insert into warehouses (name) values ('RW') returning id"))[0].id;
    await db.owner("insert into parcels (booking_id, seq, barcode, weight_kg, warehouse_id) values ($1, 1, $2, 1, $3)", [booking, `RW-${Math.random()}`, wh]);
    const parcel = (await db.owner("select id from parcels where booking_id = $1", [booking]))[0].id;
    await actAs(db, me, `update parcels set status = 'loaded' where id = '${parcel}'`);
    assert.deepEqual((await lines(db, me)).map((l) => [l.rule_key, l.points]), [["payment_recorded", 3], ["pickup_collected", 5], ["parcel_moved", 1]]);
  });
});

test("rewards: nothing is paid when nobody is signed in, to an inactive person, or past the daily cap, and the work still saves", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const me = await db.person([], "capped");
    await db.booking({ invoice_no: "T-RW-2" }); // owner, nobody signed in
    assert.equal((await db.owner("select count(*)::int n from point_log"))[0].n, 0);
    assert.equal((await db.owner("select award_points(null, 'booking_created', null, null, 'x') p"))[0].p, 0);
    const paid = await db.owner("select count(*) filter (where x > 0)::int n from (select award_points($1, 'parcel_moved', 'parcels', gen_random_uuid(), 'move') x from generate_series(1, 101)) s", [me]);
    assert.equal(paid[0].n, 100); // the rule's cap
    assert.equal((await db.owner("select award_points($1, 'booking_created', 'bookings', gen_random_uuid(), 'x') p", [me]))[0].p, 0); // the total daily cap for work
    const gone = await db.person([], "gone");
    await db.owner("update profiles set active = false where id = $1", [gone]);
    const b = await newBookingAs(db, gone);
    assert.ok(b.id, "the booking saved");
    assert.equal((await lines(db, gone)).length, 0);
  });
});

test("rewards: trying a feature pays once, an unknown feature is refused, and active-today needs real work", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const me = await db.person([], "explorer");
    assert.equal((await db.as(me, "select record_feature_use('use_bookings') p"))[0].p, 10);
    assert.equal((await db.as(me, "select record_feature_use('use_bookings') p"))[0].p, 0);
    assert.equal(await total(db, me), 10); // no real work yet: no active-today points
    assert.match((await db.error(() => db.as(me, "select record_feature_use('booking_created')"))) ?? "", /Unknown feature/);
    assert.match((await db.error(() => db.as(me, "select record_feature_use('made_up')"))) ?? "", /Unknown feature/);
    await newBookingAs(db, me); // +5
    await db.as(me, "select record_feature_use('use_scan')"); // +10, then active-today +2
    assert.equal(await total(db, me), 27);
    await db.as(me, "select record_feature_use('use_scan')");
    assert.equal(await total(db, me), 27);
  });
});

test("rewards: thank-yous need the permission, a message, another person, and stay within the monthly limits", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const boss = await db.person(["rewards.give"], "boss");
    const staff = await db.person([], "staff");
    const gone = await db.person([], "gone");
    await db.owner("update profiles set active = false where id = $1", [gone]);
    await db.as(boss, "select give_thank_you($1, 20, 'Great job on the late rush')", [staff]);
    assert.equal(await total(db, staff), 20);
    assert.deepEqual((await lines(db, staff)).map((l) => [l.rule_key, l.points, l.reason]), [["thank_you", 20, "Great job on the late rush"]]);
    assert.match((await db.error(() => db.as(staff, "select give_thank_you($1, 5, 'hi')", [boss]))) ?? "", /permission/i);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 5, 'me')", [boss]))) ?? "", /yourself/);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 5, '  ')", [staff]))) ?? "", /message/i);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 0, 'x')", [staff]))) ?? "", /between 1 and 100/);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 101, 'x')", [staff]))) ?? "", /between 1 and 100/);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 5, 'x')", [gone]))) ?? "", /not active/);
    await db.owner("update app_settings set value = '2'::jsonb where key = 'rewards_thank_you_monthly_count'");
    await db.as(boss, "select give_thank_you($1, 5, 'second')", [staff]);
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 5, 'third')", [staff]))) ?? "", /thank-yous for this month/);
    await db.owner("update app_settings set value = '10'::jsonb where key = 'rewards_thank_you_monthly_count'");
    await db.owner("update app_settings set value = '30'::jsonb where key = 'rewards_thank_you_monthly_points'");
    assert.match((await db.error(() => db.as(boss, "select give_thank_you($1, 20, 'too much')", [staff]))) ?? "", /points for this month/);
  });
});

test("rewards: the streak counts days in a row, ends today or yesterday, and the level follows lifetime points", { skip }, async () => {
  await inTransaction(async (db) => {
    await withRewards(db);
    const a = await db.person([], "streak a");
    const b = await db.person([], "streak b");
    const add = (who: string, daysAgo: number, pts: number) => db.owner("insert into point_log (person_id, rule_key, points, reason, created_at) values ($1, 'booking_created', $2, 'x', now() - ($3 || ' days')::interval)", [who, pts, String(daysAgo)]);
    await add(a, 0, 5); await add(a, 1, 5); await add(a, 2, 5); // today, yesterday, the day before
    await add(b, 0, 5); await add(b, 3, 5); // a gap
    const r = async (who: string) => (await db.as(who, "select my_rewards() r"))[0].r;
    assert.equal((await r(a)).streak, 3);
    assert.equal((await r(b)).streak, 1);
    const c = await db.person([], "streak c");
    await add(c, 1, 5); // only yesterday: the streak is still alive
    assert.equal((await r(c)).streak, 1);
    const d = await db.person([], "streak d");
    await add(d, 0, 120);
    const rd = await r(d);
    assert.equal(rd.total, 120);
    assert.equal(rd.level_name, "Helper");
    assert.equal(rd.next_level_name, "Handler");
    assert.equal(rd.next_min, 300);
    const pr = (await db.as(a, "select person_rewards($1) r", [d]))[0].r;
    assert.equal(pr.total, 120);
    assert.ok(Array.isArray(pr.recent));
  });
});
