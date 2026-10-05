"use client";

import { isNoise } from "./error-noise";
import { supabase } from "./supabase";

let sentThisMinute = 0;
let windowStart = Date.now();

/**
 * Sends one line to the private error log (Settings > Problems). It never throws and never blocks the screen:
 * a problem while reporting a problem must not cause another one. At most 5 reports a minute from one browser.
 */
export async function reportError(error: unknown, where?: string): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    if (!message || isNoise(message)) return;
    if (Date.now() - windowStart > 60_000) {
      windowStart = Date.now();
      sentThisMinute = 0;
    }
    if (++sentThisMinute > 5) return;
    await supabase.rpc("log_client_error", {
      p_message: message,
      p_stack: error instanceof Error ? (error.stack ?? "") : "",
      p_path: where ?? (typeof location === "undefined" ? "" : location.pathname),
      p_agent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    });
  } catch {
    // reporting is best effort
  }
}
