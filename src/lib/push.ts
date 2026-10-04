"use client";

import { isMock, supabase } from "./supabase";

// Phone alerts (web push): this device asks for permission once, and the server then sends it every new notification.
export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const toKey = (base64Url: string) => {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function pushState(): Promise<PushState> {
  if (isMock || !publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iPhones only allow alerts for an app that was added to the Home Screen
    return isIos() && !isStandalone() && !isMock ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Alerts were not allowed. You can allow them in the browser or phone settings.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey!) }));
  const json = sub.toJSON();
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); // re-enabling replaces the old row
  const { error } = await supabase.from("push_subscriptions").insert({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** Sends a test alert to this person's own devices. Returns how many were reached. */
export async function sendTestAlert(): Promise<number> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/push/test", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json.devices as number;
}
