// Applies pending SQL files from supabase/migrations/ to the database in SUPABASE_DB_URL.
// Usage: npm run db:migrate
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// The file is optional (automatic checks have none). A variable set in the environment always wins over the file,
// so `SUPABASE_DB_URL=<test database> npm run db:migrate` targets the test database even when .env.local has the live one.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env.local");
  process.exit(1);
}

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const hadTracking = (await client.query("select to_regclass('public.schema_migrations') as t")).rows[0].t;
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );

  // Databases created before migration tracking already contain 0001.
  if (!hadTracking) {
    const existing = (await client.query("select to_regclass('public.bookings') as t")).rows[0].t;
    if (existing) await client.query("insert into schema_migrations (name) values ($1)", [files[0]]);
  }

  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));

  if (!pending.length) console.log("Database is up to date.");
  for (const file of pending) {
    console.log(`Applying ${file} ...`);
    try {
      await client.query("begin");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      console.error(`FAILED ${file}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
