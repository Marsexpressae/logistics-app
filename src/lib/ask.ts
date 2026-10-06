// One place to ask the user a question: "Are you sure?" or "Type the reason". It replaces the browser's confirm() and prompt(),
// which cannot be styled, show typed passwords in plain text, and are hard to use on a phone.
// The dialog itself is <AskHost /> (mounted once in the app shell). Callers just `await` the answer.

export type AskField = {
  label: string;
  secret?: boolean; // a password: dots instead of letters
  placeholder?: string;
  minLength?: number; // the answer must be at least this long (default 1)
  multiline?: boolean;
};

export type AskOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean; // red button, and the safe choice (Cancel) is focused first
  field?: AskField;
};

export type PendingAsk = AskOptions & { resolve: (answer: string | boolean | null) => void };

let listener: ((queue: PendingAsk[]) => void) | null = null;
let queue: PendingAsk[] = [];

/** The dialog host subscribes here. Returns the function that stops listening. */
export function subscribeAsk(fn: (queue: PendingAsk[]) => void): () => void {
  listener = fn;
  fn(queue);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Called by the host when the person answered; the next question (if any) shows. */
export function answerAsk(pending: PendingAsk, answer: string | boolean | null) {
  queue = queue.filter((q) => q !== pending);
  pending.resolve(answer);
  listener?.(queue);
}

function enqueue<T extends string | boolean | null>(opts: AskOptions): Promise<T> {
  return new Promise<T>((resolve) => {
    // With no dialog on screen (for example in a test) nobody can answer: treat it as "no".
    if (!listener) return resolve((opts.field ? null : false) as T);
    queue = [...queue, { ...opts, resolve: resolve as PendingAsk["resolve"] }];
    listener(queue);
  });
}

/** "Are you sure?": true when they confirm, false when they cancel or press Escape. */
export const confirmAction = (opts: Omit<AskOptions, "field">) => enqueue<boolean>(opts);

/** "Type the reason / the new password": the text they typed, or null when they cancel. */
export const askText = (opts: AskOptions & { field: AskField }) => enqueue<string | null>(opts);
