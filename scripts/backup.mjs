// Saves a copy of all the app's data to a dated folder on this computer.
// Usage: npm run db:backup            (saves next to the project, in ..\Backups\backup-DATE)
//        npm run db:backup -- D:\path (saves into the folder you give)
//
// What it saves: every table in the public schema, one JSON file each, plus a summary with row counts.
// What it does NOT save: login passwords (kept by Supabase Auth), and the private push-alert secret.
// The structure of the database is rebuilt from supabase/migrations, so it is not part of the data copy.
// The files contain customer names, phone numbers and payments: keep the folder private.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

process.loadEnvFile(".env.local");
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env.local");
  process.exit(1);
}

const SKIP = new Set(["private_config"]); // secrets
const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
const root = resolve(process.argv[2] ?? join("..", "Backups"));
const dir = join(root, `backup-${stamp}`);
mkdirSync(dir, { recursive: true });

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows: tables } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
  );
  const counts = {};
  for (const { table_name } of tables) {
    if (SKIP.has(table_name)) continue;
    const { rows } = await client.query(`select * from public."${table_name}"`);
    writeFileSync(join(dir, `${table_name}.json`), JSON.stringify(rows, null, 1));
    counts[table_name] = rows.length;
  }

  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  writeFileSync(
    join(dir, "_summary.json"),
    JSON.stringify({ saved_at: new Date().toISOString(), last_migration: migrations.at(-1), rows_per_table: counts }, null, 2)
  );

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  console.log(`Saved ${Object.keys(counts).length} tables, ${total} rows, to:\n${dir}`);
} finally {
  await client.end();
}
