import { HttpError, ROLES, errorResponse, requireAdmin } from "@/lib/server/admin";

// GET /api/users: everyone with a login, their role, and drivers not yet linked to a login.
export async function GET(req: Request) {
  try {
    const { admin } = await requireAdmin(req);

    const [{ data: list, error }, { data: profiles }, { data: drivers }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 200 }),
      admin.from("profiles").select("*"),
      admin.from("drivers").select("id, name, user_id").order("name"),
    ]);
    if (error) throw new HttpError(500, error.message);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const users = list.users.map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        email: u.email,
        full_name: p?.full_name ?? "",
        role: p?.role ?? null, // null = has a login but no access
        active: p?.active ?? false,
        driver: drivers?.find((d) => d.user_id === u.id)?.name ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    });
    return Response.json({ users, unlinkedDrivers: (drivers ?? []).filter((d) => !d.user_id) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/users: create a login + profile (and link/create the driver record for drivers).
export async function POST(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "");
    const driverId: string | null = body.driver_id || null;

    if (!email || !fullName) throw new HttpError(400, "Name and email are required");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (!(ROLES as readonly string[]).includes(role)) throw new HttpError(400, "Invalid role");

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create user");
    const userId = data.user.id;

    try {
      const { error: pErr } = await admin.from("profiles").insert({ id: userId, full_name: fullName, role });
      if (pErr) throw new HttpError(400, pErr.message);

      if (role === "driver") {
        const { error: dErr } = driverId
          ? await admin.from("drivers").update({ user_id: userId }).eq("id", driverId)
          : await admin.from("drivers").insert({ name: fullName, user_id: userId });
        if (dErr) throw new HttpError(400, dErr.message);
      }
    } catch (e) {
      await admin.auth.admin.deleteUser(userId); // roll back, so no half-created accounts
      throw e;
    }
    return Response.json({ id: userId }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
