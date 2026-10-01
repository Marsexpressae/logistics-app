"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Package } from "lucide-react";
import { ROLE_LABELS, navItems } from "@/config/navigation";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type SidebarProps = { open: boolean; onClose: () => void; profile: Profile };

export default function Sidebar({ open, onClose, profile }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const items = navItems.filter((i) => i.roles.includes(profile.role));

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform print:hidden md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
          <Package className="h-6 w-6 text-blue-600" />
          <span className="text-lg font-semibold text-slate-900">Logistics</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {items.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive(href)
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-6 py-3">
          <p className="truncate text-sm font-medium text-slate-900">{profile.full_name || "Signed in"}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[profile.role]}</p>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-3 border-t border-slate-200 px-6 py-4 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </aside>
    </>
  );
}
