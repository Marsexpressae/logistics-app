import { HttpError, assertCanAssignRole, errorResponse, requirePermission } from "@/lib/server/admin";

// PATCH /api/users/:id: change role, name, active flag, password, or driver link.
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

    // Managers cannot touch a super admin at all (role, password, status).
    if (!caller.isSuperAdmin) {
      const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
      if (target?.role === "super_admin") throw new HttpError(403, "Only a super admin can change a super admin");
    }

    const profileUpdate: Record<string, unknown> = {};
    if (body.role !== undefined) {
      await assertCanAssignRole(caller, String(body.role), id);
      profileUpdate.role = body.role;
    }
    if (body.full_name !== undefined) profileUpdate.full_name = String(body.full_name).trim();
    if (body.active !== undefined) profileUpdate.active = Boolean(body.active);

    if (Object.keys(profileUpdate).length) {
      // upsert: also gives access to someone who has a login but no profile yet
      const { data: existing } = await admin.from("profiles").select("id").eq("id", id).maybeSingle();
      const { error } = existing
        ? await admin.from("profiles").update(profileUpdate).eq("id", id)
        : await admin.from("profiles").insert({ id, full_name: "", role: "staff", ...profileUpdate });
      if (error) throw new HttpError(400, error.message);
    }

    // Deactivating also blocks sign-in at the auth level.
    const authUpdate: { password?: string; ban_duration?: string } = {};
    if (body.active !== undefined) authUpdate.ban_duration = body.active ? "none" : "876000h";
    if (body.password !== undefined) {
      if (String(body.password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
      authUpdate.password = String(body.password);
    }
    if (Object.keys(authUpdate).length) {
      const { error } = await admin.auth.admin.updateUserById(id, authUpdate);
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
