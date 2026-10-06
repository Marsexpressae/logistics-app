"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, Ellipsis, LogOut, UserCog, X } from "lucide-react";
import CountBadge from "@/components/ui/CountBadge";
import { navItems } from "@/config/navigation";
import { useMenuSwitches } from "@/lib/nav-settings";
import { useBadges } from "@/lib/badges";
import { useInstall } from "@/lib/pwa";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";
import { supabase } from "@/lib/supabase";

// Phone navigation, following the usual mobile-app pattern (Instagram, LinkedIn, TikTok):
//   * a bar fixed at the bottom, in easy thumb reach
//   * at most 4 main destinations + a "More" tab (5 targets is the comfortable maximum)
//   * big targets (56px tall), icon + short label, clear active state
//   * respects the phone's home-indicator area, and hides while the keyboard is open
const MAX_TABS = 4;

export default function BottomNav() {
  const pathname = usePathname();
  const profile = useCurrentProfile();
  const { canAny } = usePermissions();
  const { canPrompt, install } = useInstall();
  const badges = useBadges();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const shown = useMenuSwitches();
  const items = navItems.filter((i) => canAny(...i.anyOf) && shown(i));
  const tabs = items.slice(0, MAX_TABS);
  const overflow = items.slice(MAX_TABS);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const moreActive = sheetOpen || overflow.some((i) => isActive(i.href));
  const hiddenCount = overflow.reduce((sum, i) => sum + (badges[i.href] ?? 0), 0); // waiting items inside "More"

  // A bar floating above the on-screen keyboard steals form space, so hide it while typing.
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.matches("textarea, select, [contenteditable='true']") ||
        (el.matches("input") && !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => isField(e.target) && setTyping(true);
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  // The "More" menu is a dialog: focus moves into it, Tab stays inside it, Escape closes it, and focus goes back to the button.
  useEffect(() => {
    if (!sheetOpen) {
      if (wasOpen.current) moreButton.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const focusable = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter((el) => el.getClientRects().length);
    requestAnimationFrame(() => focusable().find((el) => el.getAttribute("aria-label") === "Close")?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setSheetOpen(false);
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const tabClass = (active: boolean) =>
    `flex min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors active:bg-slate-100 ${
      active ? "text-brand-700" : "text-slate-500"
    }`;

  return (
    <>
      <nav
        aria-label="Main"
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden print:hidden ${
          typing ? "hidden" : ""
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex">
          {tabs.map(({ href, shortLabel, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                  <span className="relative">
                    <Icon className="h-6 w-6" strokeWidth={active ? 2.5 : 2} />
                    <CountBadge count={badges[href] ?? 0} className="absolute -right-3 -top-1.5 ring-2 ring-white" />
                  </span>
                  <span>{shortLabel}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              ref={moreButton}
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              className={tabClass(moreActive)}
            >
              <span className="relative">
                <Ellipsis className="h-6 w-6" strokeWidth={moreActive ? 2.5 : 2} />
                <CountBadge count={hiddenCount} variant="dot" className="absolute -right-1 -top-0.5" />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setSheetOpen(false)} />
          <div
            ref={sheet}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
            <div className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{profile.full_name || "Signed in"}</p>
                <p className="text-sm text-slate-500">{profile.roleLabel}</p>
              </div>
              <button
                aria-label="Close"
                onClick={() => setSheetOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 active:bg-slate-100"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <ul className="border-t border-slate-100 py-1">
              {overflow.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setSheetOpen(false)}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={`flex min-h-14 items-center gap-4 px-5 text-base font-medium active:bg-slate-100 ${
                      isActive(href) ? "text-brand-700" : "text-slate-800"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                    {label}
                    <CountBadge count={badges[href] ?? 0} className="ml-auto" />
                  </Link>
                </li>
              ))}
              {canPrompt && (
                <li>
                  <button
                    onClick={() => {
                      setSheetOpen(false);
                      install();
                    }}
                    className="flex min-h-14 w-full items-center gap-4 px-5 text-base font-medium text-brand-700 active:bg-slate-100"
                  >
                    <Download className="h-6 w-6" />
                    Install app
                  </button>
                </li>
              )}
            </ul>

            <Link
              href="/account"
              onClick={() => setSheetOpen(false)}
              className="flex min-h-14 w-full items-center gap-4 border-t border-slate-100 px-5 text-base font-medium text-slate-800 active:bg-slate-100"
            >
              <UserCog className="h-6 w-6" aria-hidden="true" />
              My account and password
            </Link>
            <button
              onClick={() => supabase.auth.signOut()}
              className="flex min-h-14 w-full items-center gap-4 border-t border-slate-100 px-5 text-base font-medium text-slate-600 active:bg-slate-100"
            >
              <LogOut className="h-6 w-6" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
