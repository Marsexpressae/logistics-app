"use client";

import { useState } from "react";

const KEY = "celebrations-off";

/** "Celebrations on this device": anyone can switch the fireworks off for themselves. Kept in this browser only. */
export default function DeviceToggle() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "1";
    } catch {
      return true;
    }
  });

  function change(next: boolean) {
    setOn(next);
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "1");
    } catch {}
  }

  return (
    <div>
      <label className="flex min-h-11 items-center gap-3 text-base text-slate-800">
        <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} className="h-6 w-6" />
        Celebrations on this device
      </label>
      <p className="text-sm text-slate-600">A short firework and a friendly message when you finish a booking, pickup, intake or invoice. Untick it to turn them off here.</p>
    </div>
  );
}
