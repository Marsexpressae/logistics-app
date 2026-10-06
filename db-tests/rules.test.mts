// Tests of the REAL database rules (permissions, row security, triggers, functions), not the sample-data version.
//
// Every test runs inside one transaction that is always rolled back, with throwaway users created on the spot, so nothing
// is ever kept in the database. It needs the database address in SUPABASE_DB_URL (in .env.local, or set by CI);
// without it the tests are skipped. Run with:  npm run test:db
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
