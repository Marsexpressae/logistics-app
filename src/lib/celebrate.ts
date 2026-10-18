import type { CelebrationEvent, StyleKey } from "./celebrations.ts";

type Handler = (event: CelebrationEvent, detail?: string) => void;
type PreviewHandler = (style: StyleKey) => void;

const handlers = new Set<Handler>();
const previewHandlers = new Set<PreviewHandler>();

/**
 * Say that something good just happened (a booking was created, a pickup collected ...). Call it only after the work saved.
 * It never throws: a celebration problem must not stop the work.
 */
export function celebrate(event: CelebrationEvent, detail?: string): void {
  for (const h of [...handlers]) {
    try {
      h(event, detail);
    } catch {}
  }
}

/** Listen for celebrations (the host in the app shell does). Returns a function that stops listening. */
export function onCelebrate(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Play one style on request (the Preview buttons in Settings). It ignores the on/off switches and the quiet time. */
export function previewCelebration(style: StyleKey): void {
  for (const h of [...previewHandlers]) {
    try {
      h(style);
    } catch {}
  }
}

export function onPreview(handler: PreviewHandler): () => void {
  previewHandlers.add(handler);
  return () => previewHandlers.delete(handler);
}
