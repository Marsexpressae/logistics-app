"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import BrandMark from "@/components/brand/BrandMark";
import NotificationToast from "@/components/notifications/NotificationToast";
import InstallBanner from "@/components/pwa/InstallBanner";
import CountBadge from "@/components/ui/CountBadge";
import { canAccess, homePath } from "@/config/navigation";
import { site } from "@/config/site";
import { BadgeProvider, useBadgeCounts } from "@/lib/badges";
import { NotificationProvider, useNotificationsState } from "@/lib/notifications";
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
  const isPublic = isPublicPath(pathname);
  const badges = useBadgeCounts(permissions, !!profile);
  const wantsNotifications = !!profile && permissions.includes("notifications.view");
  const notifications = useNotificationsState(session?.user.id, wantsNotifications);

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
      <NotificationProvider value={notifications}>
      <BadgeProvider value={{ ...badges, "/notifications": notifications.unread }}>
      <div className="flex h-full flex-1 flex-col md:flex-row">
        {/* Phone top bar: just the brand. Navigation lives in the bottom bar, within thumb reach. */}
        <header
          className="flex h-14 shrink-0 items-center border-b border-slate-200 bg-white px-4 print:hidden md:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Link href={homePath(permissions)} aria-label={`${site.name} home`} className="flex items-center gap-2">
            <BrandMark size={28} />
            <span className="font-semibold text-slate-900">{site.name}</span>
          </Link>
          {wantsNotifications && (
            <Link
              href="/notifications"
              aria-label={`Notifications${notifications.unread ? `, ${notifications.unread} unread` : ""}`}
              className="relative ml-auto flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
            >
              <Bell className="h-6 w-6" />
              <CountBadge count={notifications.unread} label="unread" className="absolute right-0.5 top-0.5 ring-2 ring-white" />
            </Link>
          )}
        </header>
        <NotificationToast />
        <Sidebar />
        {/* Extra bottom padding on phones keeps the last content clear of the bottom bar. */}
        <main className="flex-1 overflow-y-auto p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:p-8 md:pb-8 print:p-0">
          <InstallBanner className="mb-4" />
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
        <BottomNav />
      </div>
      </BadgeProvider>
      </NotificationProvider>
    </ProfileContext.Provider>
  );
}
