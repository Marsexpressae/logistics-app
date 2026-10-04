import { timingSafeEqual } from "node:crypto";
import { HttpError, adminClient, errorResponse } from "@/lib/server/admin";
import { sendPushToUser } from "@/lib/server/push";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// POST /api/push: called by the database whenever a notification is created. Delivers it to the person's phones.
// The caller proves it is the database with a secret kept in a private table (never in the code).
export async function POST(req: Request) {
  try {
    const admin = adminClient();
    const sent = req.headers.get("x-push-secret") ?? "";
    const { data: cfg } = await admin.from("private_config").select("value").eq("key", "push_secret").maybeSingle();
    if (!cfg?.value || !same(sent, cfg.value)) throw new HttpError(401, "Not allowed");

    const { notification_id } = (await req.json().catch(() => ({}))) as { notification_id?: string };
    if (!notification_id) throw new HttpError(400, "Missing notification");
    const { data: n } = await admin.from("notifications").select("user_id, kind, title, body").eq("id", notification_id).maybeSingle();
    if (!n) throw new HttpError(404, "Notification not found");

    const devices = await sendPushToUser(admin, n.user_id, { title: n.title, body: n.body, tag: n.kind });
    return Response.json({ devices });
  } catch (e) {
    return errorResponse(e);
  }
}
