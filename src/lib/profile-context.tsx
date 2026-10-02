"use client";

import { createContext, useContext } from "react";
import type { Profile } from "./types";

type ProfileContextValue = { profile: Profile; roleLabel: string; permissions: string[] };

// Provided by AppShell once the signed-in user's profile and permissions are known.
export const ProfileContext = createContext<ProfileContextValue | null>(null);

function useProfileContext(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("Used outside a signed-in page");
  return value;
}

/** Current user's profile. Only call inside pages that sit behind AppShell's login gate. */
export function useCurrentProfile(): Profile & { roleLabel: string } {
  const { profile, roleLabel } = useProfileContext();
  return { ...profile, roleLabel };
}

/**
 * Permission checks for the current user.
 *   const { can } = usePermissions();  can("bookings.edit")
 * This only shapes the UI; the database enforces the same permissions.
 */
export function usePermissions() {
  const { permissions } = useProfileContext();
  return {
    permissions,
    can: (permission: string) => permissions.includes(permission),
    canAny: (...list: string[]) => list.some((p) => permissions.includes(p)),
  };
}
