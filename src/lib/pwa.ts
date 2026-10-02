"use client";

import { useSyncExternalStore } from "react";

// Chrome fires `beforeinstallprompt` once, early, as soon as the app qualifies for installing.
// It must be caught at page load (not when a menu opens later), so the listener lives at module level
// and components subscribe to the stored result.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own banner instead of Chrome's
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// iPhones and iPads never fire the install event; the user adds the app manually from the Share menu.
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export type InstallState = {
  /** The browser can show its install dialog right now (Chrome, Edge, Android). */
  canPrompt: boolean;
  /** iPhone/iPad: show "Share, then Add to Home Screen" instructions instead. */
  showIosHelp: boolean;
};

// A primitive snapshot keeps useSyncExternalStore stable between renders.
const snapshot = () => {
  if (isStandalone() || installed) return "none";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
};

export function useInstall(): InstallState & { install: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, snapshot, () => "none");

  async function install() {
    if (!deferred) return;
    const event = deferred;
    deferred = null; // the event can only be used once
    notify();
    await event.prompt();
  }

  return { canPrompt: state === "prompt", showIosHelp: state === "ios", install };
}

const DISMISS_KEY = "mars-install-dismissed";
const DISMISS_DAYS = 14;

export const installDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return !!at && Date.now() - at < DISMISS_DAYS * 86400_000;
  } catch {
    return false;
  }
};

export const dismissInstall = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // storage blocked: the banner will simply show again next visit
  }
};
