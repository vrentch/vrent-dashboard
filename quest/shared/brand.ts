/**
 * The single source of truth for how the product looks.
 *
 * Everything — the 2D entry screen, the in-headset spatial panels, the card
 * materials, the environment lighting tints, the generated app icons and the
 * vrent.ch showcase page — reads its colours from here. Re-skinning the whole
 * product for a customer means editing this one object; nothing else hardcodes
 * a colour.
 *
 * The values below are the VRENT house palette. To match vrent.ch exactly,
 * replace the seven `palette` hexes and run `npm run icons`.
 */

export interface Palette {
  /** Deepest background. Used behind everything, and as the VR void colour. */
  ink: string;
  /** Raised panel surface. */
  surface: string;
  /** Surface one step lighter — inputs, card backs, hovered rows. */
  surfaceAlt: string;
  /** Primary brand colour. Buttons, active states, player 1. */
  primary: string;
  /** Secondary/energy accent. Highlights, rays, matched pairs. */
  accent: string;
  /** Reward colour. Leaderboard gold, win states, streaks. */
  reward: string;
  /** Error / miss / disconnect. */
  danger: string;
}

export const palette: Palette = {
  ink: "#05070F",
  surface: "#0C1222",
  surfaceAlt: "#151E36",
  primary: "#1E6BFF",
  accent: "#00E5C7",
  reward: "#FFB020",
  danger: "#FF4D6A",
};

/** Text colours derive from the palette so a re-skin stays legible. */
export const text = {
  primary: "#EAF0FF",
  secondary: "#9CADD1",
  muted: "#61729A",
  onAccent: "#04121A",
  onPrimary: "#FFFFFF",
} as const;

/**
 * Per-player seat colours. Deliberately hue-separated so eight people in one
 * room can tell their own ray and score chip apart at a glance, and readable
 * for the most common colour-vision deficiencies (no red/green-only pairing).
 */
export const seatColors = [
  "#1E6BFF", // blue
  "#00E5C7", // teal
  "#FFB020", // amber
  "#C77DFF", // violet
  "#FF6B9D", // pink
  "#6EE787", // mint
  "#FF8A3D", // orange
  "#8FD3FF", // ice
] as const;

export const brand = {
  name: "VRENT",
  productName: "VRENT Memory XR",
  shortName: "Memory XR",
  tagline: "Mixed-reality memory, built for your room.",
  website: "https://vrent.ch",
  contactEmail: "info@vrent.ch",
  /** Reverse-DNS root for Android package ids. */
  packageRoot: "ch.vrent",
} as const;

/** Design tokens shared by the DOM UI and the in-headset canvas panels. */
export const tokens = {
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
  /** Panel corner radius in metres, for spatial UI. */
  radiusMeters: 0.02,
  font: {
    display: '"Space Grotesk", "Inter", system-ui, -apple-system, sans-serif',
    body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
  },
  /** Motion durations in ms. Kept short — VR punishes sluggish UI. */
  motion: { fast: 120, base: 220, slow: 380, flip: 300 },
} as const;

/**
 * Injects the palette as CSS custom properties so stylesheets can use
 * `var(--vr-primary)` and stay in sync with a re-skin automatically.
 */
export function applyBrandCssVars(target: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string) => target.style.setProperty(k, v);
  set("--vr-ink", palette.ink);
  set("--vr-surface", palette.surface);
  set("--vr-surface-alt", palette.surfaceAlt);
  set("--vr-primary", palette.primary);
  set("--vr-accent", palette.accent);
  set("--vr-reward", palette.reward);
  set("--vr-danger", palette.danger);
  set("--vr-text", text.primary);
  set("--vr-text-2", text.secondary);
  set("--vr-text-muted", text.muted);
  set("--vr-font-display", tokens.font.display);
  set("--vr-font-body", tokens.font.body);
  set("--vr-font-mono", tokens.font.mono);
  seatColors.forEach((c, i) => set(`--vr-seat-${i}`, c));
}

/** `#RRGGBB` → `0xRRGGBB`, for Three.js colour constructors. */
export function hex(color: string): number {
  return parseInt(color.replace("#", ""), 16);
}

/** `#RRGGBB` + alpha → `rgba(...)`, for canvas-drawn spatial panels. */
export function rgba(color: string, alpha: number): string {
  const n = hex(color);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
