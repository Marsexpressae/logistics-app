"use client";

import { useEffect } from "react";
import "@/lib/pwa"; // starts listening for the browser's install event immediately

/** Registers the offline-page service worker (production only, so it never interferes with development). */
export default function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not critical: the app works the same without it.
    });
  }, []);

  return null;
}
