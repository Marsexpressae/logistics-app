import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// GET /api/health: "is the app up and can it reach its database?". Meant for an uptime monitor (checks every few
// minutes and emails you if it fails). It shows no data: only ok or not, and the time.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let database = false;
  if (url && key) {
    try {
      // the public tracking function is the one thing the public key may run; an unknown code simply returns nothing
      const { error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("track_booking", { p_code: "HEALTH-CHECK" });
      database = !error;
    } catch {
      database = false;
    }
  }
  return Response.json({ ok: database, database, at: new Date().toISOString() }, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
