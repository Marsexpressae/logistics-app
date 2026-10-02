"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

// Chrome/Edge/Android fire this event when the app can be installed. (iOS Safari never does:
// there, use Share > Add to Home Screen.)
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent) return null; // already installed, or the browser cannot install it

  return (
    <button
      onClick={async () => {
        await promptEvent.prompt();
        setPromptEvent(null);
      }}
      className="flex w-full items-center gap-3 border-t border-slate-200 px-6 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
    >
      <Download className="h-5 w-5" />
      Install app
    </button>
  );
}
