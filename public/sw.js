// Service worker: shows a friendly page when the device is offline, and delivers phone alerts (push).
// It deliberately caches NO app data, API responses or login sessions, so nothing sensitive is stored
// and users never see stale bookings.
const CACHE = "mars-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only page navigations are handled; everything else goes straight to the network.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
  }
});

// Phone alerts (web push). The server sends a small JSON message: { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // an unreadable message still shows a generic alert
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Mars Express", {
      body: data.body || "",
      icon: "/icons/192",
      badge: "/icons/192",
      tag: data.tag || undefined,
      data: { url: data.url || "/notifications" },
    })
  );
});

// Tapping the alert opens (or focuses) the app on the right page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          if ("navigate" in w) w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
