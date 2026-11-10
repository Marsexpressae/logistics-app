"use client";

import { useRef, useState, type FormEvent } from "react";
import { BellRing, Send } from "lucide-react";
import { Button, ErrorMessage, inputClass } from "@/components/ui/form";
import { supabase } from "@/lib/supabase";

const QUICK_MESSAGES = ["Please add the old booking", "Please add the old invoice", "Please request the return"];
const MAX_LENGTH = 300;

/** "Send alert" on a colleague's profile: a short message that lands in their bell, badge and phone. Any task, no booking needed. */
export default function SendAlertButton({ personId, name }: { personId: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const first = name.split(/\s+/)[0] || name;

  const open = () => {
    setError(null);
    setSent(false);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return setError("Type a message first.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("send_alert", { p_to: personId, p_message: text });
    setBusy(false);
    if (error) return setError(error.message);
    setText("");
    setSent(true);
    close();
  }

  return (
    <>
      <span className="flex flex-col items-end gap-1">
        <Button variant="secondary" onClick={open}>
          <BellRing className="h-5 w-5" aria-hidden="true" /> Send alert
        </Button>
        <span role="status" className="text-sm text-green-700">
          {sent ? `Alert sent to ${first}` : ""}
        </span>
      </span>
      <dialog
        ref={dialog}
        aria-labelledby="send-alert-title"
        className="m-auto w-[92vw] max-w-md rounded-xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/50"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h2 id="send-alert-title" className="text-lg font-semibold">
              Send alert to {name}
            </h2>
            <p className="text-sm text-slate-600">{first} gets it in the bell and as a phone alert.</p>
          </div>
          <div>
            <label htmlFor="send-alert-text" className="mb-1 block text-sm font-medium text-slate-700">
              Message
            </label>
            <textarea
              id="send-alert-text"
              rows={3}
              maxLength={MAX_LENGTH}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              placeholder="Please add the old invoice for Mr Khan"
              className={inputClass}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_MESSAGES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setText(m)}
                  className="min-h-11 rounded-full border border-slate-300 px-3 text-sm text-slate-800 hover:bg-slate-50 active:bg-slate-100"
                >
                  {m.replace("Please a", "A").replace("Please r", "R")}
                </button>
              ))}
            </div>
          </div>
          <ErrorMessage message={error} />
          <div className="flex flex-col gap-2">
            <Button type="submit" size="large" disabled={busy}>
              <Send className="h-5 w-5" aria-hidden="true" /> {busy ? "Sending…" : "Send alert"}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
