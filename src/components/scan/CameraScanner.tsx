"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, X } from "lucide-react";
import { Button, inputClass } from "@/components/ui/form";
import { parseParcelCode } from "@/lib/barcode";

export type ScanOutcome = { ok: boolean; text: string } | void;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the parcel barcode. In `continuous` mode the camera stays on, and what you return is shown as the last result. */
  onCode: (code: string) => Promise<ScanOutcome> | ScanOutcome;
  continuous?: boolean;
  title?: string;
};

// The browser's own barcode reader, where it exists (Chrome on Android). Everything else uses the ZXing reader.
type NativeDetector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: { new (opts: { formats: string[] }): NativeDetector };
  }
}

/**
 * Scan a parcel barcode with the phone camera, or type it. It works on iPhone and Android (the camera needs the https address).
 * The same barcode is ignored for a couple of seconds, so holding the phone still does not load a parcel twice.
 */
export default function CameraScanner({ open, onClose, onCode, continuous = false, title = "Scan a parcel" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  const closer = useRef(onClose);
  const [problem, setProblem] = useState<string | null>(null);
  const [last, setLast] = useState<{ code: string; outcome: ScanOutcome } | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    handler.current = onCode;
    closer.current = onClose;
  }, [onCode, onClose]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Start the camera while the scanner is open, and always switch it off again.
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let cleanup = () => {};
    const recent = { code: "", at: 0 };

    const accept = async (raw: string) => {
      const code = parseParcelCode(raw);
      if (!code) return;
      if (code === recent.code && Date.now() - recent.at < 2500) return; // the same barcode, still in front of the camera
      recent.code = code;
      recent.at = Date.now();
      navigator.vibrate?.(60);
      const outcome = await handler.current(code);
      if (stopped) return;
      setLast({ code, outcome });
      if (!continuous) closer.current();
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera-api");
        const v = video.current;
        if (!v) return;
        if (window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code"] });
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          v.srcObject = stream;
          await v.play();
          const timer = setInterval(async () => {
            if (v.readyState < 2) return;
            const found = await detector.detect(v).catch(() => []);
            if (found[0]) accept(found[0].rawValue);
          }, 250);
          cleanup = () => {
            clearInterval(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });
          const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, v, (result) => {
            if (result) accept(result.getText());
          });
          if (stopped) controls.stop();
          cleanup = () => controls.stop();
        }
      } catch (e) {
        const name = (e as Error).name;
        setProblem(
          name === "NotAllowedError"
            ? "The camera is blocked. Allow the camera for this website in your phone's settings, or type the barcode below."
            : name === "NotFoundError"
              ? "No camera was found on this device. Type the barcode below."
              : "The camera could not start here. Type the barcode below."
        );
      }
    })();

    return () => {
      stopped = true;
      cleanup();
    };
  }, [open, continuous]);

  async function submitTyped(e: FormEvent) {
    e.preventDefault();
    const code = parseParcelCode(typed);
    if (!code) return setProblem("That does not look like a parcel barcode. It looks like BK-1004-P1.");
    setProblem(null);
    setTyped("");
    const outcome = await handler.current(code);
    setLast({ code, outcome });
    if (!continuous) onClose();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="scan-title"
      onClose={onClose}
      className="m-auto w-[96vw] max-w-lg rounded-xl border border-slate-300 bg-white p-4 text-slate-900 shadow-xl backdrop:bg-black/60"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="scan-title" className="flex items-center gap-2 text-lg font-semibold">
          <Camera className="h-5 w-5" aria-hidden="true" /> {title}
        </h2>
        <button type="button" aria-label="Close the scanner" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-600 active:bg-slate-100">
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" aria-hidden="true" />
      </div>
      <p className="mt-2 text-sm text-slate-700">Point the camera at the barcode on the parcel label. Keep it steady.</p>

      <div aria-live="polite" className="mt-2">
        {problem && (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {problem}
          </p>
        )}
        {last && (
          <p className={`rounded-md px-3 py-2 text-sm ${last.outcome && !last.outcome.ok ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
            <span className="font-mono font-semibold">{last.code}</span>
            {last.outcome ? `: ${last.outcome.text}` : " scanned"}
          </p>
        )}
      </div>

      <form onSubmit={submitTyped} className="mt-3 flex gap-2">
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type it: BK-1004-P1" aria-label="Type the barcode" autoCapitalize="characters" className={`${inputClass} font-mono`} />
        <Button type="submit" variant="secondary">
          Go
        </Button>
      </form>

      <Button type="button" size="large" variant="secondary" className="mt-3" onClick={onClose}>
        {continuous ? "Done" : "Cancel"}
      </Button>
    </dialog>
  );
}
