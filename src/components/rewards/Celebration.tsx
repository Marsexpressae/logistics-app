"use client";

import Link from "next/link";
import { X } from "lucide-react";
import Medal from "@/components/rewards/Medal";
import type { BadgeView } from "@/lib/rewards";

const COLORS = ["#EF9F27", "#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#D4537E"];
// 18 pieces spread across the card; the delay and colour vary so it looks like a burst, not a curtain
const PIECES = Array.from({ length: 18 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${(i % 6) * 90}ms`, color: COLORS[i % COLORS.length] }));

/**
 * The pop-up for a new badge: the medal, its name, and a short confetti burst. The confetti is CSS only, hidden when the device
 * asks for reduced motion, and it never takes a tap (pointer-events-none).
 */
export default function Celebration({ badge, more = 0, onClose }: { badge: BadgeView; more?: number; onClose: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-24 z-(--z-toast) mx-auto max-w-md rounded-xl border-2 border-green-600 bg-green-50 p-4 print:hidden md:left-auto md:right-4 md:mx-0 md:w-96"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        {PIECES.map((p, i) => (
          <span key={i} className="confetti-piece" style={{ left: p.left, animationDelay: p.delay, background: p.color }} />
        ))}
      </div>
      <div className="relative flex items-start gap-3">
        <div className="shrink-0 origin-top-left scale-75">
          <Medal badge={{ ...badge, earned_at: badge.earned_at ?? new Date().toISOString() }} state="earned" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-green-900">You earned {badge.name}</p>
          <p className="text-sm text-green-900">{badge.message || badge.description}</p>
          {more > 0 && <p className="text-sm font-medium text-green-900">and {more} more {more === 1 ? "badge" : "badges"}</p>}
          <Link href="/account" onClick={onClose} className="inline-flex min-h-11 items-center text-sm font-medium text-green-900 underline">
            See my badges
          </Link>
        </div>
        <button type="button" aria-label="Close" className="flex min-h-11 w-11 shrink-0 items-center justify-center text-green-900" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
