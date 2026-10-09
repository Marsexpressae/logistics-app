"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { NavItem } from "@/config/navigation";

export const NAV_SETTINGS_CHANGED = "mars:nav-settings-changed";

type MenuSwitch = (item: NavItem) => boolean;

// Everything shown by default: a missing or "on" switch means shown, so the menu is never empty by accident.
const MenuSwitchContext = createContext<MenuSwitch>(() => true);
export const MenuSwitchProvider = MenuSwitchContext.Provider;

/** The menu switches, for the Sidebar and the BottomNav. They read what AppShell loaded once, so the menu costs one request. */
export const useMenuSwitches = () => useContext(MenuSwitchContext);

/**
 * Loads the menu switches ("Show Tracking in the menu" and any future ones) once, for the whole signed-in app, and again
 * when Settings saves a change. Hiding only removes the menu link; the page still opens by address. Used by AppShell.
 */
export function useMenuSwitchState(enabled: boolean): MenuSwitch {
  const [rows, setRows] = useState<{ key: string; value: unknown }[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      supabase
        .from("app_settings")
        .select("key, value")
        .then(({ data }) => {
          if (!cancelled && data) setRows(data as { key: string; value: unknown }[]);
        });
    load();
    window.addEventListener(NAV_SETTINGS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(NAV_SETTINGS_CHANGED, load);
    };
  }, [enabled]);

  return useMemo<MenuSwitch>(() => (item) => !item.setting || rows.find((r) => r.key === item.setting)?.value !== false, [rows]);
}
