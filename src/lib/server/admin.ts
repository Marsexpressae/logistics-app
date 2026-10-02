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

export type Caller = { admin: SupabaseClient; user: User; role: string; isSuperAdmin: boolean };

/** Verifies the caller's access token belongs to an active user holding the given permission. */
export async function requirePermission(req: Request, permission: string): Promise<Caller> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");

  const { data: profile } = await admin.from("profiles").select("role, active").eq("id", data.user.id).maybeSingle();
  if (!profile?.active) throw new HttpError(403, "No access");

  const { data: grant } = await admin
    .from("role_permissions")
    .select("permission")
    .eq("role", profile.role)
    .eq("permission", permission)
    .maybeSingle();
  if (!grant) throw new HttpError(403, "You do not have permission to do this");

  return { admin, user: data.user, role: profile.role, isSuperAdmin: profile.role === "super_admin" };
}

/** Rules for who may hand out or change the super admin role (managers must not be able to promote anyone to it). */
export async function assertCanAssignRole(caller: Caller, targetRole: string, targetUserId?: string) {
  const { data: role } = await caller.admin.from("roles").select("key").eq("key", targetRole).maybeSingle();
  if (!role) throw new HttpError(400, "Unknown role");

  if (caller.isSuperAdmin) return;
  if (targetRole === "super_admin") throw new HttpError(403, "Only a super admin can assign the super admin role");
  if (targetUserId) {
    const { data: current } = await caller.admin.from("profiles").select("role").eq("id", targetUserId).maybeSingle();
    if (current?.role === "super_admin") throw new HttpError(403, "Only a super admin can change a super admin");
  }
}

/** Turns thrown errors into JSON responses. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
