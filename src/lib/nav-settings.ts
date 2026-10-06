"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import type { NavItem } from "@/config/navigation";

export const NAV_SETTINGS_CHANGED = "mars:nav-settings-changed";

/**
 * Menu items that Settings can show or hide (for example "Show Tracking in the menu"). A missing or "on" switch means
 * shown, so the menu is never empty by accident. Hiding only removes the menu link; the page still opens by address.
 */
export function useMenuSwitches() {
  const settings = useQuery<{ key: string; value: unknown }[]>(() => supabase.from("app_settings").select("key, value"));
  const reload = useRef(settings.reload);
  useEffect(() => {
    reload.current = settings.reload;
  });
  useEffect(() => {
    const again = () => reload.current();
    window.addEventListener(NAV_SETTINGS_CHANGED, again);
    return () => window.removeEventListener(NAV_SETTINGS_CHANGED, again);
  }, []);
  return (item: NavItem) => !item.setting || settings.data?.find((s) => s.key === item.setting)?.value !== false;
}
