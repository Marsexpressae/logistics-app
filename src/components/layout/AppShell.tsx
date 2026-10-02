"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { canAccess, homePath } from "@/config/navigation";
import { site } from "@/config/site";
import { useProfile, useSession } from "@/lib/hooks";
import { ProfileContext } from "@/lib/profile-context";
import { isMock, supabase } from "@/lib/supabase";
import { resetMockData } from "@/lib/mock-supabase";

// Pages that work without signing in.
const isPublicPath = (path: string) => path === "/login" || path.startsWith("/track");

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500">
    {children}
  </div>
);

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const { profile, roleLabel, permissions, loading: profileLoading } = useProfile(session);
  const [menuOpen, setMenuOpen] = useState(false);
  const isPublic = isPublicPath(pathname);

  const allowed = profile ? canAccess(permissions, pathname) : true;

  useEffect(() => {
    if (isPublic) return;
    if (session === null) router.replace("/login");
    else if (profile && !allowed) router.replace(homePath(permissions));
  }, [isPublic, session, profile, allowed, permissions, router]);

  if (isPublic) return <>{children}</>;
  if (!session || profileLoading) return <Centered>Loading…</Centered>;

  if (!profile) {
    return (
      <Centered>
        <p className="text-base font-medium text-slate-900">Your account does not have access yet.</p>
        <p>Ask an administrator to set up your role.</p>
        <button className="font-medium text-blue-700" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Centered>
    );
  }
  if (!allowed) return <Centered>Loading…</Centered>;

  return (
    <ProfileContext.Provider value={{ profile, roleLabel, permissions }}>
      <div className="flex h-full flex-1 flex-col md:flex-row">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 print:hidden md:hidden">
          <button onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="h-6 w-6 text-slate-700" />
          </button>
          <Link href={homePath(permissions)} aria-label={`${site.name} home`} className="font-semibold text-slate-900">
            {site.name}
          </Link>
        </header>
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 print:p-0">
          {isMock && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">
              <span>Mock data mode: changes are saved in this browser only.</span>
              <button className="font-medium underline" onClick={() => confirm("Reset all mock data?") && resetMockData()}>
                Reset
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </ProfileContext.Provider>
  );
}
