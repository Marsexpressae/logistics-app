"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button, ErrorMessage } from "@/components/ui/form";

/**
 * Turns a document on the page into a PDF and shares it. On a phone this opens the normal share sheet
 * (WhatsApp, email, Telegram, ...); where sharing files is not possible the PDF is downloaded instead.
 */
export default function ShareButton({ targetId, filename, title }: { targetId: string; filename: string; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    const el = document.getElementById(targetId);
    if (!el) return;
    setBusy(true);
    setError(null);
    try {
      // Loaded only when needed, so the rest of the app stays light.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth() - 20;
      const pageH = pdf.internal.pageSize.getHeight() - 20;
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 10, 10, canvas.width * ratio, canvas.height * ratio);
      const blob = pdf.output("blob");
      const file = new File([blob], `${filename}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: title ?? filename });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      // Closing the share sheet is not an error.
      if ((e as Error).name !== "AbortError") setError("Could not make the PDF. Please try Print instead.");
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={share} disabled={busy}>
        <Share2 className="h-4 w-4" /> {busy ? "Preparing…" : "Share"}
      </Button>
      <ErrorMessage message={error} />
    </span>
  );
}
