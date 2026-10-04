// SERVER ONLY. Sends a push message to every phone/browser a person has turned alerts on for.
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/server/admin";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let ready = false;
function setup() {
  if (ready) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new HttpError(503, "Phone alerts are not set up on the server (VAPID keys are missing).");
  webpush.setVapidDetails("https://app.marsexpress.ae", publicKey, privateKey);
  ready = true;
}

/** Returns how many devices were reached. Devices that no longer exist are removed. */
export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload): Promise<number> {
  setup();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let sent = 0;
  const message = JSON.stringify({ url: "/notifications", ...payload });
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); // the phone is gone
      }
    })
  );
  return sent;
}
