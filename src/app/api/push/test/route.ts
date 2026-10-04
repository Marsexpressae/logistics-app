import { HttpError, adminClient, errorResponse } from "@/lib/server/admin";
import { sendPushToUser } from "@/lib/server/push";

export const dynamic = "force-dynamic";

// POST /api/push/test: sends a test alert to the signed-in person's own phones, so they can check it works.
export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Not signed in");
    const admin = adminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "Not signed in");

    const devices = await sendPushToUser(admin, data.user.id, { title: "Mars Express", body: "Phone alerts are working.", tag: "test" });
    return Response.json({ devices });
  } catch (e) {
    return errorResponse(e);
  }
}
