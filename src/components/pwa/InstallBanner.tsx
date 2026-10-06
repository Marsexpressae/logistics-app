"use client";

import { useState } from "react";
import { Download, Share, X } from "lucide-react";
import { site } from "@/config/site";
import { dismissInstall, installDismissed, useInstall } from "@/lib/pwa";

/**
 * A visible "install this app" prompt. Android/Chrome gets a one-tap Install button; iPhone gets the
 * manual steps. Dismissing hides it for two weeks. Never shown once the app is installed.
 */
export default function InstallBanner({ className = "" }: { className?: string }) {
  const { canPrompt, showIosHelp, install } = useInstall();
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? true : installDismissed()));

  if (hidden || (!canPrompt && !showIosHelp)) return null;

  return (
    <div
      role="region"
      aria-label={`Install ${site.name}`}
      className={`flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 print:hidden ${className}`}
    >
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
      <div className="flex-1">
        <p className="font-medium">Install {site.name} on this device</p>
        {canPrompt ? (
          <p className="text-brand-800">Open it like an app from your home screen, full-screen and one tap away.</p>
        ) : (
          <p className="text-brand-800">
            Tap <Share className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-label="Share" /> in Safari, then choose{" "}
            <span className="font-medium">Add to Home Screen</span>.
          </p>
        )}
        {canPrompt && (
          <button
            onClick={install}
            className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Install app
          </button>
        )}
      </div>
      <button
        aria-label="Dismiss"
        onClick={() => {
          dismissInstall();
          setHidden(true);
        }}
        className="text-brand-700 hover:text-brand-900"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
