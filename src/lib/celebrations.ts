// Celebrations: the settings, the style choice and the dots to draw. Pure code with no browser calls, so it can be tested directly.
// The five styles are ported from docs/design/firework-styles.html.

export type CelebrationEvent = "booking_created" | "pickup_collected" | "intake_received" | "invoice_raised";
export type StyleKey = "salvo" | "confetti" | "classic" | "rings" | "willow";
export type Celebrations = { enabled: boolean; style: StyleKey; events: Record<CelebrationEvent, boolean> };

export const EVENT_KEYS: CelebrationEvent[] = ["booking_created", "pickup_collected", "intake_received", "invoice_raised"];
export const EVENT_LABEL: Record<CelebrationEvent, string> = {
  booking_created: "A booking is created",
  pickup_collected: "A pickup is collected",
  intake_received: "An intake is received in the warehouse",
  invoice_raised: "An invoice is raised",
};

export const DEFAULT_CELEBRATIONS: Celebrations = {
  enabled: true,
  style: "salvo",
  events: { booking_created: true, pickup_collected: true, intake_received: true, invoice_raised: true },
};

/** How long one animation plays, and the quiet time before the next animation (a second event in that time shows only the message). */
export const DURATION_MS = 2500;
export const COOLDOWN_MS = 4000;

export const STYLES: { key: StyleKey; label: string; description: string; cost: number }[] = [
  { key: "salvo", label: "Triple salvo", description: "Three rockets launch one after another and burst in different colours.", cost: 210 },
  { key: "confetti", label: "Confetti pop", description: "Coloured paper pieces pop up and flutter down. Softer and friendly.", cost: 70 },
  { key: "classic", label: "Classic burst", description: "One big round burst of many colours. Closest to the Samsung Health one.", cost: 110 },
  { key: "rings", label: "Double ring", description: "Two clean rings, one inside the other, in rainbow colours.", cost: 96 },
  { key: "willow", label: "Golden willow", description: "Gold sparks that rise, then droop down like a weeping willow.", cost: 90 },
];

const isStyle = (v: unknown): v is StyleKey => STYLES.some((s) => s.key === v);

/** The saved setting, made safe: any missing or wrong part falls back to its default. Never throws. */
export function normalizeCelebrations(raw: unknown): Celebrations {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ev = o.events && typeof o.events === "object" && !Array.isArray(o.events) ? (o.events as Record<string, unknown>) : {};
  const events = { ...DEFAULT_CELEBRATIONS.events };
  for (const k of EVENT_KEYS) if (typeof ev[k] === "boolean") events[k] = ev[k] as boolean;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_CELEBRATIONS.enabled,
    style: isStyle(o.style) ? o.style : DEFAULT_CELEBRATIONS.style,
    events,
  };
}

export const shouldCelebrate = (s: Celebrations, event: CelebrationEvent, deviceOff: boolean): boolean => s.enabled && s.events[event] === true && !deviceOff;

/** A slow device gets the confetti pop in place of any style that draws more than 100 dots. */
export function chooseStyle(style: StyleKey, light: boolean): StyleKey {
  const cost = STYLES.find((s) => s.key === style)?.cost ?? 0;
  return light && cost > 100 ? "confetti" : style;
}

export function isLightDevice(n: { hardwareConcurrency?: number; deviceMemory?: number; connection?: { saveData?: boolean } }): boolean {
  return (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 4) || (n.deviceMemory !== undefined && n.deviceMemory <= 2) || n.connection?.saveData === true;
}

const MESSAGES: Record<CelebrationEvent, string> = {
  booking_created: "Booking created. Nice work!",
  pickup_collected: "Pickup collected. Great job!",
  intake_received: "Intake received. Well done!",
  invoice_raised: "Invoice raised. Nice one!",
};

/** The friendly line under the fireworks. A booking number, when there is one, goes into the booking message. */
export function messageFor(event: CelebrationEvent, detail?: string): string {
  if (event === "booking_created" && detail) return `Booking ${detail} created. Nice work!`;
  return MESSAGES[event];
}

export type Dot = {
  x: number; y: number; vx: number; vy: number; drag: number; g: number; life: number; fade: number; r: number; c: string;
  rect?: boolean; rot?: number; vr?: number;
  /** milliseconds to wait before this dot starts to move (the three rockets of the salvo) */
  delay: number;
};

const COLORS = ["#ff4d4f", "#ffa940", "#fadb14", "#73d13d", "#36cfc9", "#597ef7", "#b37feb", "#ff85c0"];
const SALVO_COLORS = [["#ff4d4f", "#ffa940", "#fadb14"], ["#36cfc9", "#597ef7", "#b37feb"], ["#73d13d", "#fadb14", "#ff85c0"]];
const TAU = Math.PI * 2;

function dot(x: number, y: number, angle: number, speed: number, c: string, over: Partial<Dot> = {}): Dot {
  return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: 0.975, g: 0.04, life: 1, fade: 0.012, r: 2.3, c, delay: 0, ...over };
}

/** The dots for one celebration: exactly the style's `cost` of them. `random` returns numbers from 0 up to (not including) 1. */
export function spawn(style: StyleKey, width: number, height: number, random: () => number): Dot[] {
  const out: Dot[] = [];
  if (style === "classic") {
    for (let i = 0; i < 110; i++) out.push(dot(width / 2, height * 0.45, (TAU * i) / 110 + random() * 0.1, 1.5 + random() * 3, COLORS[i % COLORS.length]));
  } else if (style === "rings") {
    for (let i = 0; i < 48; i++) {
      const t = (TAU * i) / 48;
      out.push(dot(width / 2, height * 0.45, t, 3.6, COLORS[i % COLORS.length], { drag: 0.965, fade: 0.011 }));
      out.push(dot(width / 2, height * 0.45, t, 2, COLORS[(i + 3) % COLORS.length], { drag: 0.965, fade: 0.011 }));
    }
  } else if (style === "willow") {
    for (let i = 0; i < 90; i++) out.push(dot(width / 2, height * 0.4, (TAU * i) / 90, 1 + random() * 3.2, i % 3 ? "#ffd666" : "#ffc53d", { drag: 0.97, g: 0.075, fade: 0.007, r: 1.8 }));
  } else if (style === "confetti") {
    for (let i = 0; i < 70; i++) {
      const t = -Math.PI / 2 + (random() - 0.5) * 1.5;
      out.push(dot(width / 2, height * 0.8, t, 3 + random() * 4, COLORS[i % COLORS.length], { rect: true, rot: random() * 6, vr: (random() - 0.5) * 0.4, drag: 0.97, g: 0.09, fade: 0.008 }));
    }
  } else {
    // salvo: three rockets, one after another, each bursting in its own colours
    ([[0.25, 0.4, 0], [0.75, 0.35, 450], [0.5, 0.3, 900]] as const).forEach(([fx, fy, delay], k) => {
      for (let i = 0; i < 70; i++) out.push(dot(width * fx, height * fy, (TAU * i) / 70, 1.2 + random() * 2.8, SALVO_COLORS[k][i % 3], { delay }));
    });
  }
  return out;
}
