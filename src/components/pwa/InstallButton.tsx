"use client";

import { Download } from "lucide-react";
import { useInstall } from "@/lib/pwa";

// Always-available install shortcut in the sidebar (shown only when the browser can install the app).
export default function InstallButton() {
  const { canPrompt, install } = useInstall();
  if (!canPrompt) return null;

  return (
    <button
      onClick={install}
      className="flex w-full items-center gap-3 border-t border-slate-200 px-6 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
    >
      <Download className="h-5 w-5" />
      Install app
    </button>
  );
}
