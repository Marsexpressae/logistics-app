"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { onCelebrate, onPreview } from "@/lib/celebrate";
import {
  COOLDOWN_MS, DEFAULT_CELEBRATIONS, DURATION_MS, chooseStyle, isLightDevice, messageFor, normalizeCelebrations, shouldCelebrate, spawn,
  type Celebrations, type Dot, type StyleKey,
} from "@/lib/celebrations";
import { supabase } from "@/lib/supabase";

const OFF_KEY = "celebrations-off";

const deviceOff = () => {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Mounted once in the app shell. Listens for celebrations (a booking created, a pickup collected ...), shows a short message and,
 * when allowed, plays one firework on a single canvas that never takes a tap. The loop stops when the animation ends, when the tab
 * is hidden, and when the host is removed. Every browser call is allowed to fail quietly: this can never get in the way of the work.
 */
export default function CelebrationHost() {
  const [settings, setSettings] = useState<Celebrations>(DEFAULT_CELEBRATIONS);
  const [message, setMessage] = useState<string | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  const stopRef = useRef<() => void>(() => {});
  const lastPlayed = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the listeners below read the latest choice through this ref
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // the saved choice, read once; a missing or damaged value means the defaults
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "celebrations").maybeSingle();
        if (!cancelled) setSettings(normalizeCelebrations((data as { value?: unknown } | null)?.value));
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function say(text: string) {
      setMessage(text);
      if (messageTimer.current) clearTimeout(messageTimer.current);
      messageTimer.current = setTimeout(() => setMessage(null), 3000);
    }

    function play(style: StyleKey) {
      try {
        stopRef.current();
        const box = layer.current;
        if (!box || document.hidden) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w * ratio;
        canvas.height = h * ratio;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        box.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          canvas.remove();
          return;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const dots: Dot[] = spawn(style, w, h, Math.random);
        const started = performance.now();
        let last = started;
        let raf = 0;
        const stop = () => {
          cancelAnimationFrame(raf);
          document.removeEventListener("visibilitychange", onHide);
          canvas.remove();
          stopRef.current = () => {};
        };
        const onHide = () => {
          if (document.hidden) stop();
        };
        document.addEventListener("visibilitychange", onHide);
        const frame = (now: number) => {
          try {
            const elapsed = now - started;
            const step = Math.min((now - last) / 16.7, 2.5);
            last = now;
            // fade what was drawn before, so the dots leave short trails on the see-through canvas
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = "source-over";
            let alive = 0;
            for (const p of dots) {
              if (elapsed < p.delay) {
                alive++;
                continue;
              }
              p.x += p.vx * step;
              p.y += p.vy * step;
              p.vx *= p.drag;
              p.vy = p.vy * p.drag + p.g * step;
              p.life -= p.fade * step;
              if (p.life <= 0) continue;
              alive++;
              ctx.globalAlpha = Math.max(p.life, 0);
              ctx.fillStyle = p.c;
              if (p.rect) {
                p.rot = (p.rot ?? 0) + (p.vr ?? 0) * step;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillRect(-3, -2, 6, 4);
                ctx.restore();
              } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, 7);
                ctx.fill();
              }
            }
            ctx.globalAlpha = 1;
            if (elapsed > DURATION_MS || alive === 0) return stop();
            raf = requestAnimationFrame(frame);
          } catch {
            stop();
          }
        };
        stopRef.current = stop;
        lastPlayed.current = Date.now();
        raf = requestAnimationFrame(frame);
      } catch {}
    }

    const reduced = () => {
      try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch {
        return false;
      }
    };

    const offCelebrate = onCelebrate((event, detail) => {
      try {
        if (!shouldCelebrate(settingsRef.current, event, deviceOff())) return;
        say(messageFor(event, detail));
        if (reduced() || document.hidden || Date.now() - lastPlayed.current < COOLDOWN_MS) return;
        const light = isLightDevice(navigator as unknown as Parameters<typeof isLightDevice>[0]);
        play(chooseStyle(settingsRef.current.style, light));
      } catch {}
    });

    const offPreview = onPreview((style) => {
      try {
        if (reduced()) return say("Reduced motion is on, so the preview does not move.");
        play(style);
      } catch {}
    });

    return () => {
      offCelebrate();
      offPreview();
      stopRef.current();
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  return (
    <>
      <div ref={layer} aria-hidden="true" className="pointer-events-none fixed inset-0 z-(--z-toast) print:hidden" />
      {message && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-(--z-toast) mx-auto flex max-w-md items-center gap-2 rounded-lg border border-green-600 bg-green-50 py-1 pl-4 pr-1 text-base font-medium text-green-900 print:hidden md:bottom-6"
        >
          <span className="flex-1">{message}</span>
          <button type="button" aria-label="Close" className="flex min-h-11 w-11 shrink-0 items-center justify-center" onClick={() => setMessage(null)}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
