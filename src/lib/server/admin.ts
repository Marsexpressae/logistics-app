// SERVER ONLY. Uses the service-role key, which bypasses all row-level security.
// Never import this from a client component, and never prefix the key with NEXT_PUBLIC_.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(
      503,
      "User management is not set up. Add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart the server."
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verifies the caller's access token belongs to an active admin. */
export async function requireAdmin(req: Request): Promise<{ admin: SupabaseClient; user: User }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");

  const { data: profile } = await admin.from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  if (!profile?.active || profile.role !== "admin") throw new HttpError(403, "Admins only");
  return { admin, user: data.user };
}

/** Turns thrown errors into JSON responses. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

export const ROLES = ["admin", "staff", "driver", "warehouse"] as const;
