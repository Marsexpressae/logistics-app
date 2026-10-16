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
    await db.owner(readFileSync("supabase/migrations/0053_sortable_lists.sql", "utf8"));
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
const MONEY_MIGRATION = "supabase/migrations/0054_credit_notes_refunds.sql";

test("credit notes and refunds: tables are protected, permissions and series exist", { skip }, async () => {
  await inTransaction(async (db) => {
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
    await db.owner(readFileSync(MONEY_MIGRATION, "utf8"));
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
