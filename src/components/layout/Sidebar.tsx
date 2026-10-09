"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, UserCog } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { homePath, navItems } from "@/config/navigation";
import { useMenuSwitches } from "@/lib/nav-settings";
import InstallButton from "@/components/pwa/InstallButton";
import CountBadge from "@/components/ui/CountBadge";
import { useBadges } from "@/lib/badges";
import { site } from "@/config/site";
import { supabase } from "@/lib/supabase";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";

// Desktop and tablet navigation. On phones the BottomNav is used instead.
export default function Sidebar() {
  const pathname = usePathname();
  const profile = useCurrentProfile();
  const { canAny, permissions } = usePermissions();
  const badges = useBadges();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const shown = useMenuSwitches();
  const items = navItems.filter((i) => canAny(...i.anyOf) && shown(i));

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white print:hidden md:flex">
      {/* Logo and name go to this person's home page (the Dashboard, or Pickups for drivers). */}
      <Link
        href={homePath(permissions)}
        aria-label={`${site.name} home`}
        className="flex h-16 items-center gap-2 border-b border-slate-200 px-6 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        <BrandMark size={32} />
        <span className="text-lg font-semibold text-slate-900">{site.name}</span>
      </Link>

      <nav className="flex-1 space-y-1 p-3">
        {items.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive(href)
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
            <CountBadge count={badges[href] ?? 0} className="ml-auto" />
          </Link>
        ))}
      </nav>

      <InstallButton />
      <div className="border-t border-slate-200 px-6 py-3">
        <p className="truncate text-sm font-medium text-slate-900">{profile.full_name || "Signed in"}</p>
        <p className="text-xs text-slate-500">{profile.roleLabel}</p>
      </div>
      <Link href="/account" className="flex min-h-11 items-center gap-3 border-t border-slate-200 px-6 text-sm font-medium text-slate-700 hover:text-slate-900">
        <UserCog className="h-5 w-5" aria-hidden="true" />
        My account
      </Link>
      <button
        onClick={() => supabase.auth.signOut()}
        className="flex min-h-11 items-center gap-3 border-t border-slate-200 px-6 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <LogOut className="h-5 w-5" />
        Sign out
      </button>
    </aside>
  );
}
