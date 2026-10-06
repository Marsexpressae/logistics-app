"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, inputClass } from "@/components/ui/form";
import { answerAsk, subscribeAsk, type PendingAsk } from "@/lib/ask";

/**
 * The one dialog behind confirmAction() and askText(). It is the browser's own <dialog>, so keyboard focus stays inside it,
 * Escape cancels, and screen readers announce it. Big full-width buttons, because many people use it on a phone.
 */
export default function AskHost() {
  const [queue, setQueue] = useState<PendingAsk[]>([]);
  const [text, setText] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = queue[0];

  useEffect(() => subscribeAsk(setQueue), []);

  // Open the dialog for the first question in the line, and start with an empty answer.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (current && !el.open) el.showModal();
    if (!current && el.open) el.close();
  }, [current]);

  if (!current) return <dialog ref={dialog} />;

  const need = current.field ? (current.field.minLength ?? 1) : 0;
  const finish = (answer: string | boolean | null) => {
    setText("");
    setTooShort(false);
    answerAsk(current, answer);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (current.field) {
      if (text.trim().length < need) return setTooShort(true);
      finish(text.trim());
    } else finish(true);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="ask-title"
      aria-describedby={current.message ? "ask-message" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        finish(current.field ? null : false);
      }}
      className="m-auto w-[92vw] max-w-md rounded-xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="space-y-4">
        <h2 id="ask-title" className="text-lg font-semibold">
          {current.title}
        </h2>
        {current.message && (
          <p id="ask-message" className="whitespace-pre-line text-base text-slate-700">
            {current.message}
          </p>
        )}
        {current.field && (
          <div>
            <label htmlFor="ask-field" className="mb-1 block text-sm font-medium text-slate-700">
              {current.field.label}
            </label>
            {current.field.multiline ? (
              <textarea id="ask-field" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={current.field.placeholder} className={inputClass} />
            ) : (
              <input
                id="ask-field"
                autoFocus
                type={current.field.secret ? "password" : "text"}
                autoComplete={current.field.secret ? "new-password" : "off"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={current.field.placeholder}
                aria-invalid={tooShort}
                aria-describedby={tooShort ? "ask-error" : undefined}
                className={inputClass}
              />
            )}
            {tooShort && (
              <p id="ask-error" role="alert" className="mt-1 text-sm text-red-700">
                {need > 1 ? `Please enter at least ${need} characters.` : "Please type an answer first."}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button type="submit" size="large" variant={current.danger ? "danger" : "primary"} autoFocus={!current.field && !current.danger}>
            {current.confirmLabel ?? (current.field ? "Save" : "Yes, continue")}
          </Button>
          <Button type="button" variant="secondary" className="w-full" autoFocus={!current.field && !!current.danger} onClick={() => finish(current.field ? null : false)}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>
  );
}
