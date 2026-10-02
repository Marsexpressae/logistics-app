import { HttpError, assertCanAssignRole, errorResponse, requirePermission } from "@/lib/server/admin";

// PATCH /api/users/:id: change name, email, role, active flag, password, or driver link.
export async function PATCH(req: Request, ctx: RouteContext<"/api/users/[id]">) {
  try {
    const caller = await requirePermission(req, "users.manage");
    const { admin, user: me } = caller;
    const { id } = await ctx.params;
    const body = await req.json();

    const isSelf = id === me.id;
    if (isSelf && (body.role !== undefined || body.active !== undefined)) {
      throw new HttpError(400, "You cannot change your own role or deactivate yourself");
    }

    // Managers cannot touch a super admin at all (name, email, role, password, status).
    if (!caller.isSuperAdmin) {
      const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
      if (target?.role === "super_admin") throw new HttpError(403, "Only a super admin can change a super admin");
    }

    // ---- validate everything first, so a bad value changes nothing ----
    const profileUpdate: Record<string, unknown> = {};
    if (body.role !== undefined) {
      await assertCanAssignRole(caller, String(body.role), id);
      profileUpdate.role = body.role;
    }
    let fullName: string | undefined;
    if (body.full_name !== undefined) {
      fullName = String(body.full_name).trim();
      if (!fullName) throw new HttpError(400, "Name cannot be empty");
      profileUpdate.full_name = fullName;
    }
    if (body.active !== undefined) profileUpdate.active = Boolean(body.active);

    // What changes at the sign-in (auth) level. Deactivating also blocks sign-in.
    const authUpdate: {
      email?: string;
      email_confirm?: boolean;
      password?: string;
      ban_duration?: string;
      user_metadata?: Record<string, unknown>;
    } = {};
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address");
      // Supabase only says "Error updating user" for a duplicate, so check up front and give a clear message.
      const { data: everyone } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (everyone?.users.some((u) => u.id !== id && u.email?.toLowerCase() === email)) {
        throw new HttpError(400, "That email address is already used by someone else");
      }
      authUpdate.email = email;
      authUpdate.email_confirm = true; // no confirmation email: an admin is vouching for the address
    }
    if (fullName !== undefined) authUpdate.user_metadata = { full_name: fullName };
    if (body.active !== undefined) authUpdate.ban_duration = body.active ? "none" : "876000h";
    if (body.password !== undefined) {
      if (String(body.password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
      authUpdate.password = String(body.password);
    }

    // ---- apply: sign-in details first (they can be refused, e.g. email already in use) ----
    if (Object.keys(authUpdate).length) {
      const { error } = await admin.auth.admin.updateUserById(id, authUpdate);
      if (error) {
        const taken = /already|registered|exists|duplicate/i.test(error.message);
        throw new HttpError(400, taken ? "That email address is already used by someone else" : error.message);
      }
    }

    if (Object.keys(profileUpdate).length) {
      // upsert: also gives access to someone who has a login but no profile yet
      const { data: existing } = await admin.from("profiles").select("id").eq("id", id).maybeSingle();
      const { error } = existing
        ? await admin.from("profiles").update(profileUpdate).eq("id", id)
        : await admin.from("profiles").insert({ id, full_name: "", role: "staff", ...profileUpdate });
      if (error) throw new HttpError(400, error.message);
    }

    // A driver's name is also shown on pickups and booking forms, so keep it the same as the person's name.
    if (fullName !== undefined) {
      const { error } = await admin.from("drivers").update({ name: fullName }).eq("user_id", id);
      if (error) throw new HttpError(400, error.message);
    }

    if (body.driver_id) {
      const { error } = await admin.from("drivers").update({ user_id: id }).eq("id", body.driver_id);
      if (error) throw new HttpError(400, error.message);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
