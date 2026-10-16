"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { ErrorMessage } from "@/components/ui/form";
import { askText } from "@/lib/ask";
import { supabase } from "@/lib/supabase";

/**
 * Voids a credit note or a refund made by mistake. The record stays (marked VOID, with the reason, who and when);
 * only its effect on the numbers is undone. A credit note with an active refund must have the refund voided first.
 */
export default function VoidButton({ kind, id, onDone }: { kind: "credit_note" | "refund"; id: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = kind === "credit_note" ? "credit note" : "refund";

  async function run() {
    const reason = await askText({
      title: `Void this ${what}?`,
      message: "The record stays, marked VOID, and its effect on the invoice and the payments is undone. This cannot be undone.",
      confirmLabel: `Void the ${what}`,
      danger: true,
      field: { label: "Reason (required)", placeholder: "For example: wrong amount" },
    });
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc(kind === "credit_note" ? "void_credit_note" : "void_refund", { p_id: id, p_reason: reason.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <>
      <button type="button" onClick={run} disabled={busy} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-red-700 hover:underline disabled:opacity-50">
        <Ban className="h-3.5 w-3.5" /> Void
      </button>
      <ErrorMessage message={error} />
    </>
  );
}
