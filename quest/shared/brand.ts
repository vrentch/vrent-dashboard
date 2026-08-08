/**
 * The single source of truth for how the product looks.
 *
 * Everything — the 2D entry screen, the in-headset spatial panels, the card
 * materials, the environment lighting, the generated app icons and the
 * vrent.ch showcase — reads its colours from here. Re-skinning the whole
 * product for a customer means editing the two palettes below; nothing else
 * hardcodes a colour.
 *
 * THEMES
 *
 * `palette`, `text` and `seatColors` are **mutated in place** when the theme
 * changes rather than being replaced. That means a module can keep reading
 * `palette.primary` with no indirection, while anything that caches a derived
 * value — a canvas texture, a Three.js material, a parsed hex — subscribes to
 * `onThemeChange` and rebuilds. Swapping the objects instead would silently
 * strand every cached reference on the old colours.
 */

export type ThemeId = "dark" | "light";

export interface Palette {
  /** Deepest background. Behind everything, and the VR void colour. */
  ink: string;
  /** Raised panel surface. */
  surface: string;
  /** Surface one step further from `ink` — inputs, card backs, hovered rows. */
  surfaceAlt: string;
  /** Primary brand colour. Buttons, active states, player 1. */
  primary: string;
  /** Secondary/energy accent. Highlights, rays, matched pairs. */
  accent: string;
  /** Reward colour. Leaderboard, win states, streaks. */
  reward: string;
  /** Error / miss / disconnect. */
  danger: string;
}

export interface TextColors {
  primary: string;
  secondary: string;
  muted: string;
  onAccent: string;
  onPrimary: string;
}

export interface SceneTokens {
  /** Multiplies every environment's `ambient`. Light rooms need much more. */
  ambientScale: number;
  /** Multiplies every environment's `key`. */
  keyScale: number;
  /** Panel fill alpha. Light panels need to be near-opaque to stay readable. */
  panelAlpha: number;
  /** Panel border alpha. */
  borderAlpha: number;
  /** Drop-shadow alpha under spatial panels. */
  shadowAlpha: number;
  /** Card face brightness multiplier — faces are light, so a light room needs
   *  them pulled back to keep the printed symbol legible. */
  cardFaceScale: number;
  /** Rim-light strength on cards, 0-1. */
  rimScale: number;
}

export interface Theme {
  id: ThemeId;
  name: string;
  palette: Palette;
  text: TextColors;
  /** Per-player seat colours, hue-separated and legible on this theme's ink. */
  seats: readonly string[];
  scene: SceneTokens;
}

// ── The two themes ──────────────────────────────────────────────────────────

const DARK: Theme = {
  id: "dark",
  name: "Dark",
  palette: {
    ink: "#05070F",
    surface: "#0C1222",
    surfaceAlt: "#151E36",
    primary: "#1E6BFF",
    accent: "#00E5C7",
    reward: "#FFB020",
    danger: "#FF4D6A",
  },
  text: {
    primary: "#EAF0FF",
    secondary: "#9CADD1",
    muted: "#61729A",
    onAccent: "#04121A",
    onPrimary: "#FFFFFF",
  },
  seats: [
    "#1E6BFF", // blue
    "#00E5C7", // teal
    "#FFB020", // amber
    "#C77DFF", // violet
    "#FF6B9D", // pink
    "#6EE787", // mint
    "#FF8A3D", // orange
    "#8FD3FF", // ice
  ],
  scene: {
    ambientScale: 1,
    keyScale: 1,
    panelAlpha: 0.92,
    borderAlpha: 0.14,
    shadowAlpha: 0.45,
    cardFaceScale: 1,
    rimScale: 1,
  },
};

/**
 * Not an inversion of the dark theme. The accent and reward hues are darkened
 * hard because #00E5C7 and #FFB020 fail contrast against white, and the seat
 * colours are re-picked for the same reason — a pale seat chip on a light
 * panel is unreadable at three metres.
 */
const LIGHT: Theme = {
  id: "light",
  name: "Light",
  palette: {
    ink: "#EEF2FA",
    surface: "#FFFFFF",
    surfaceAlt: "#DFE7F5",
    primary: "#1550D8",
    accent: "#00796B",
    reward: "#B26A00",
    danger: "#C62138",
  },
  text: {
    primary: "#0B1220",
    secondary: "#3D4C6B",
    muted: "#6C7C9C",
    onAccent: "#FFFFFF",
    onPrimary: "#FFFFFF",
  },
  seats: [
    "#1550D8", // blue
    "#00796B", // teal
    "#B26A00", // amber
    "#7B3FBF", // violet
    "#C2185B", // pink
    "#2E7D32", // green
    "#D2601A", // orange
    "#0277BD", // cyan
  ],
  scene: {
    ambientScale: 2.1,
    keyScale: 1.25,
    panelAlpha: 0.97,
    borderAlpha: 0.22,
    shadowAlpha: 0.16,
    cardFaceScale: 0.82,
    rimScale: 0.55,
  },
};

export const THEMES: Readonly<Record<ThemeId, Theme>> = { dark: DARK, light: LIGHT };

export const DEFAULT_THEME: ThemeId = "dark";

// ── Live, mutated-in-place values ───────────────────────────────────────────
// Consumers read these directly. They are updated by `setTheme`, never replaced.

export const palette: Palette = { ...DARK.palette };
export const text: TextColors = { ...DARK.text };
export const seatColors: string[] = [...DARK.seats];
export const scene: SceneTokens = { ...DARK.scene };

let currentId: ThemeId = DARK.id;

export function activeTheme(): Theme {
  return THEMES[currentId];
}

export function activeThemeId(): ThemeId {
  return currentId;
}

export function isThemeId(v: unknown): v is ThemeId {
  return v === "dark" || v === "light";
}

type ThemeListener = (theme: Theme) => void;
const listeners = new Set<ThemeListener>();

/**
 * Subscribe to theme changes. Anything holding a *derived* value — a canvas
 * texture, a Three.js material colour, a parsed hex number — must rebuild here.
 * Returns an unsubscribe function.
 */
export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Switches theme. A no-op if `id` is already active. */
export function setTheme(id: ThemeId): void {
  if (id === currentId) return;
  const next = THEMES[id];
  currentId = id;

  Object.assign(palette, next.palette);
  Object.assign(text, next.text);
  Object.assign(scene, next.scene);
  seatColors.length = 0;
  seatColors.push(...next.seats);

  if (typeof document !== "undefined") applyBrandCssVars();

  for (const fn of listeners) {
    try {
      fn(next);
    } catch (err) {
      // One bad subscriber must not leave the rest of the app half-themed.
      console.error("[theme] listener failed", err);
    }
  }
}

// ── Static identity ─────────────────────────────────────────────────────────

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

// ── CSS custom properties ───────────────────────────────────────────────────

/**
 * Injects the active palette as CSS custom properties so stylesheets can use
 * `var(--vr-primary)` and follow a theme switch automatically.
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
  target.dataset.vrTheme = currentId;
}

// ── Colour helpers ──────────────────────────────────────────────────────────

/** `#RRGGBB` → `0xRRGGBB`, for Three.js colour constructors. */
export function hex(color: string): number {
  return parseInt(color.replace("#", ""), 16);
}

/** `#RRGGBB` + alpha → `rgba(...)`, for canvas-drawn spatial panels. */
export function rgba(color: string, alpha: number): string {
  const n = hex(color);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Blends two hex colours in sRGB. `t` of 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const na = hex(a);
  const nb = hex(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (shift: number) => {
    const va = (na >> shift) & 255;
    const vb = (nb >> shift) & 255;
    return Math.round(va + (vb - va) * k);
  };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Relative luminance, 0-1. Used to decide whether a surface needs light or
 * dark text on it — a re-skinned customer palette must not be able to produce
 * an unreadable pairing by accident.
 */
export function luminance(color: string): number {
  const n = hex(color);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Picks whichever of the theme's text colours actually reads on `bg`. */
export function readableOn(bg: string): string {
  return luminance(bg) > 0.45 ? "#0B1220" : "#FFFFFF";
}

/** WCAG contrast ratio between two colours, 1-21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
