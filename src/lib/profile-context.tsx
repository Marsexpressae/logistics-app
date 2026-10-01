"use client";

import { createContext, useContext } from "react";
import type { Profile } from "./types";

// Provided by AppShell once the signed-in user's profile (and so their role) is known.
export const ProfileContext = createContext<Profile | null>(null);

/** Current user's profile. Only call inside pages that sit behind AppShell's login gate. */
export function useCurrentProfile(): Profile {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error("useCurrentProfile used outside a signed-in page");
  return profile;
}
