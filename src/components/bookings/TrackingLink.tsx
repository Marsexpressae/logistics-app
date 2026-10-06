"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Button, Card } from "@/components/ui/form";
import { whatsappLink, whatsappNumber } from "@/lib/phone";
import type { Booking } from "@/lib/types";

/** The public tracking link for a job, ready to send to the customer. Tracking works with the invoice number or the booking code. */
export default function TrackingLink({ booking }: { booking: Booking }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const code = booking.invoice_no ?? booking.code;
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/track/${encodeURIComponent(code)}`;
  const wa = whatsappNumber(booking.sender_phone, booking.sender_whatsapp);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true); // the link is shown above: the hint below says to copy it by hand
    }
  }

  const message = `Mars Express: you can track your cargo (${code}) here: ${link}`;

  return (
    <Card title="Customer tracking">
      <p className="break-all font-mono text-sm text-slate-700">{link}</p>
      {copyFailed && (
        <p role="status" className="mt-2 text-sm text-amber-800">
          This phone would not copy it automatically. Press and hold the link above, then choose Copy.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
        </Button>
        {wa && (
          <a
            href={`${whatsappLink(wa)}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <MessageCircle className="h-4 w-4" /> Send on WhatsApp
          </a>
        )}
      </div>
    </Card>
  );
}
