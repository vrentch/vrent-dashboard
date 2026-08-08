/**
 * The widget set drawn onto a `Panel`.
 *
 * Every widget is a pure function: read its interaction state, draw, register a
 * hit region, return what the user did. No widget holds state and no widget
 * knows what the game is — screens own that.
 *
 * Conventions that keep the set coherent:
 *   • Sizes are design px at `PX_PER_METER`. `CONTROL.h` is the standard control
 *     height and sits well above the 44 CSS-px minimum target.
 *   • Hover lifts the surface and brightens the hairline. Press sinks it.
 *     Focus draws an accent ring *outside* the control, so it never reads as
 *     hover on a second glance.
 *   • State is never colour alone: a toggle spells "On"/"Off", a lock shows a
 *     padlock and the edition that unlocks it, a failed code shows a cross.
 */

import { palette, rgba, seatColors, text as ink, tokens } from "../../shared/brand.ts";
import type { Gfx, Rect, Radii } from "./panel.ts";
import { centreRect, colsIn, cutLeft, cutRight, gridIn, inset, theme } from "./panel.ts";

// ── Metrics ─────────────────────────────────────────────────────────────────

export const CONTROL = {
  /** Standard control height. ~0.045 m — a very generous ray target. */
  h: 72,
  hSmall: 58,
  hLarge: 92,
  gap: 16,
  gapLg: 28,
  pad: 22,
  radius: tokens.radius.md,
  radiusLg: tokens.radius.lg,
} as const;

// ── Icons ───────────────────────────────────────────────────────────────────

export type IconName =
  | "back"
  | "forward"
  | "up"
  | "down"
  | "check"
  | "cross"
  | "lock"
  | "plus"
  | "minus"
  | "person"
  | "ai"
  | "globe"
  | "grid"
  | "cards"
  | "timer"
  | "sound"
  | "haptics"
  | "refresh"
  | "home"
  | "trophy"
  | "settings"
  | "spark"
  | "upload"
  | "signal"
  | "backspace"
  | "play"
  | "exit"
  | "eye"
  | "layers";

/**
 * Icons are drawn, not typed — a 20-glyph geometric set costs nothing, stays
 * pin-sharp at any panel resolution and keeps emoji out of a product that will
 * be re-skinned for other brands.
 */
export function icon(
  g: Gfx,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
  width = Math.max(2, size * 0.11),
): void {
  const s = size / 2;
  const p = (pts: number[], closed = false) => g.path(pts, color, width, closed);

  switch (name) {
    case "back":
      p([cx + s * 0.5, cy - s * 0.8, cx - s * 0.45, cy, cx + s * 0.5, cy + s * 0.8]);
      break;
    case "forward":
      p([cx - s * 0.5, cy - s * 0.8, cx + s * 0.45, cy, cx - s * 0.5, cy + s * 0.8]);
      break;
    case "up":
      p([cx - s * 0.8, cy + s * 0.4, cx, cy - s * 0.45, cx + s * 0.8, cy + s * 0.4]);
      break;
    case "down":
      p([cx - s * 0.8, cy - s * 0.4, cx, cy + s * 0.45, cx + s * 0.8, cy - s * 0.4]);
      break;
    case "check":
      p([cx - s * 0.75, cy + s * 0.05, cx - s * 0.2, cy + s * 0.6, cx + s * 0.78, cy - s * 0.6]);
      break;
    case "cross":
      p([cx - s * 0.62, cy - s * 0.62, cx + s * 0.62, cy + s * 0.62]);
      p([cx + s * 0.62, cy - s * 0.62, cx - s * 0.62, cy + s * 0.62]);
      break;
    case "lock": {
      const bw = s * 1.18;
      const bh = s * 0.94;
      g.fillRound({ x: cx - bw / 2, y: cy - s * 0.1, w: bw, h: bh }, size * 0.11, color);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.arc(cx, cy - s * 0.14, s * 0.46, Math.PI, 0);
      g.ctx.strokeStyle = color;
      g.ctx.lineWidth = width;
      g.ctx.stroke();
      g.ctx.restore();
      break;
    }
    case "plus":
      p([cx - s * 0.7, cy, cx + s * 0.7, cy]);
      p([cx, cy - s * 0.7, cx, cy + s * 0.7]);
      break;
    case "minus":
      p([cx - s * 0.7, cy, cx + s * 0.7, cy]);
      break;
    case "person":
      g.ring(cx, cy - s * 0.34, s * 0.4, color, width);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.arc(cx, cy + s * 0.82, s * 0.78, Math.PI * 1.12, Math.PI * 1.88);
      g.ctx.strokeStyle = color;
      g.ctx.lineWidth = width;
      g.ctx.stroke();
      g.ctx.restore();
      break;
    case "ai":
      g.strokeRound({ x: cx - s * 0.66, y: cy - s * 0.6, w: s * 1.32, h: s * 1.2 }, size * 0.16, color, width);
      g.circle(cx - s * 0.24, cy - s * 0.08, width * 0.85, color);
      g.circle(cx + s * 0.24, cy - s * 0.08, width * 0.85, color);
      p([cx, cy - s * 0.6, cx, cy - s * 0.92]);
      break;
    case "globe":
      g.ring(cx, cy, s * 0.78, color, width);
      p([cx - s * 0.78, cy, cx + s * 0.78, cy]);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.ellipse(cx, cy, s * 0.36, s * 0.78, 0, 0, Math.PI * 2);
      g.ctx.strokeStyle = color;
      g.ctx.lineWidth = width;
      g.ctx.stroke();
      g.ctx.restore();
      break;
    case "grid":
      for (let i = 0; i < 4; i++) {
        const dx = (i % 2 === 0 ? -1 : 1) * s * 0.38;
        const dy = (i < 2 ? -1 : 1) * s * 0.38;
        g.strokeRound({ x: cx + dx - s * 0.3, y: cy + dy - s * 0.3, w: s * 0.6, h: s * 0.6 }, size * 0.08, color, width);
      }
      break;
    case "cards":
      g.strokeRound({ x: cx - s * 0.82, y: cy - s * 0.62, w: s * 1.1, h: s * 1.34 }, size * 0.1, color, width);
      g.strokeRound({ x: cx - s * 0.24, y: cy - s * 0.82, w: s * 1.1, h: s * 1.34 }, size * 0.1, color, width);
      break;
    case "timer":
      g.ring(cx, cy + s * 0.1, s * 0.72, color, width);
      p([cx, cy + s * 0.1, cx, cy - s * 0.38]);
      p([cx, cy + s * 0.1, cx + s * 0.36, cy + s * 0.24]);
      p([cx - s * 0.34, cy - s * 0.86, cx + s * 0.34, cy - s * 0.86]);
      break;
    case "sound":
      p([cx - s * 0.72, cy - s * 0.28, cx - s * 0.34, cy - s * 0.28, cx + s * 0.06, cy - s * 0.72,
         cx + s * 0.06, cy + s * 0.72, cx - s * 0.34, cy + s * 0.28, cx - s * 0.72, cy + s * 0.28], true);
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.arc(cx + s * 0.14, cy, s * 0.52, -Math.PI / 3, Math.PI / 3);
      g.ctx.strokeStyle = color;
      g.ctx.lineWidth = width;
      g.ctx.stroke();
      g.ctx.restore();
      break;
    case "haptics":
      g.fillRound({ x: cx - s * 0.26, y: cy - s * 0.66, w: s * 0.52, h: s * 1.32 }, size * 0.12, color);
      p([cx - s * 0.66, cy - s * 0.3, cx - s * 0.66, cy + s * 0.3]);
      p([cx + s * 0.66, cy - s * 0.3, cx + s * 0.66, cy + s * 0.3]);
      break;
    case "refresh":
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.arc(cx, cy, s * 0.7, Math.PI * 0.35, Math.PI * 1.8);
      g.ctx.strokeStyle = color;
      g.ctx.lineWidth = width;
      g.ctx.stroke();
      g.ctx.restore();
      p([cx + s * 0.66, cy - s * 0.62, cx + s * 0.66, cy - s * 0.02, cx + s * 0.06, cy - s * 0.02]);
      break;
    case "home":
      p([cx - s * 0.78, cy - s * 0.02, cx, cy - s * 0.76, cx + s * 0.78, cy - s * 0.02]);
      p([cx - s * 0.52, cy - s * 0.12, cx - s * 0.52, cy + s * 0.72, cx + s * 0.52, cy + s * 0.72, cx + s * 0.52, cy - s * 0.12]);
      break;
    case "trophy":
      p([cx - s * 0.46, cy - s * 0.72, cx + s * 0.46, cy - s * 0.72, cx + s * 0.38, cy + s * 0.06,
         cx - s * 0.38, cy + s * 0.06], true);
      p([cx - s * 0.46, cy - s * 0.56, cx - s * 0.82, cy - s * 0.56, cx - s * 0.7, cy - s * 0.12]);
      p([cx + s * 0.46, cy - s * 0.56, cx + s * 0.82, cy - s * 0.56, cx + s * 0.7, cy - s * 0.12]);
      p([cx, cy + s * 0.06, cx, cy + s * 0.46]);
      p([cx - s * 0.44, cy + s * 0.76, cx + s * 0.44, cy + s * 0.76]);
      break;
    case "settings":
      g.ring(cx, cy, s * 0.34, color, width);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p([cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55,
           cx + Math.cos(a) * s * 0.84, cy + Math.sin(a) * s * 0.84]);
      }
      break;
    case "spark":
      p([cx, cy - s * 0.86, cx + s * 0.24, cy - s * 0.24, cx + s * 0.86, cy,
         cx + s * 0.24, cy + s * 0.24, cx, cy + s * 0.86, cx - s * 0.24, cy + s * 0.24,
         cx - s * 0.86, cy, cx - s * 0.24, cy - s * 0.24], true);
      break;
    case "upload":
      p([cx, cy + s * 0.6, cx, cy - s * 0.7]);
      p([cx - s * 0.44, cy - s * 0.26, cx, cy - s * 0.74, cx + s * 0.44, cy - s * 0.26]);
      p([cx - s * 0.76, cy + s * 0.5, cx - s * 0.76, cy + s * 0.84, cx + s * 0.76, cy + s * 0.84, cx + s * 0.76, cy + s * 0.5]);
      break;
    case "signal":
      for (let i = 0; i < 3; i++) {
        const h = s * (0.32 + i * 0.32);
        g.fillRound({ x: cx - s * 0.72 + i * s * 0.56, y: cy + s * 0.62 - h, w: s * 0.3, h }, width * 0.6, color);
      }
      break;
    case "backspace":
      p([cx + s * 0.86, cy - s * 0.62, cx - s * 0.24, cy - s * 0.62, cx - s * 0.86, cy,
         cx - s * 0.24, cy + s * 0.62, cx + s * 0.86, cy + s * 0.62], true);
      p([cx - s * 0.02, cy - s * 0.28, cx + s * 0.54, cy + s * 0.28]);
      p([cx + s * 0.54, cy - s * 0.28, cx - s * 0.02, cy + s * 0.28]);
      break;
    case "play":
      p([cx - s * 0.5, cy - s * 0.74, cx + s * 0.74, cy, cx - s * 0.5, cy + s * 0.74], true);
      break;
    case "exit":
      p([cx + s * 0.1, cy - s * 0.74, cx - s * 0.74, cy - s * 0.74, cx - s * 0.74, cy + s * 0.74, cx + s * 0.1, cy + s * 0.74]);
      p([cx - s * 0.1, cy, cx + s * 0.78, cy]);
      p([cx + s * 0.36, cy - s * 0.36, cx + s * 0.8, cy, cx + s * 0.36, cy + s * 0.36]);
      break;
    case "eye":
      p([cx - s * 0.86, cy, cx - s * 0.4, cy - s * 0.52, cx + s * 0.4, cy - s * 0.52, cx + s * 0.86, cy,
         cx + s * 0.4, cy + s * 0.52, cx - s * 0.4, cy + s * 0.52], true);
      g.circle(cx, cy, s * 0.24, color);
      break;
    case "layers":
      p([cx - s * 0.8, cy - s * 0.24, cx, cy - s * 0.72, cx + s * 0.8, cy - s * 0.24, cx, cy + s * 0.24], true);
      p([cx - s * 0.8, cy + s * 0.3, cx, cy + s * 0.78, cx + s * 0.8, cy + s * 0.3]);
      break;
  }
}

// ── Shared interaction chrome ───────────────────────────────────────────────

function focusRing(g: Gfx, r: Rect, radius: Radii, on: number): void {
  if (on <= 0.01) return;
  g.save();
  g.alpha(on);
  const spread = 7 + 3 * on;
  g.strokeRound(inset(r, -spread), addRadii(radius, spread), theme.focusRing, 3);
  g.restore();
}

function addRadii(radius: Radii, n: number): Radii {
  return Array.isArray(radius)
    ? [radius[0] + n, radius[1] + n, radius[2] + n, radius[3] + n]
    : radius + n;
}

/** Hover/press geometry shared by every pressable surface. */
function pressBox(g: Gfx, id: string, r: Rect, disabled: boolean): { box: Rect; hover: number; press: number; focus: number } {
  const st = g.state(id);
  const hover = disabled ? 0 : g.anim(`${id}#h`, st.hover ? 1 : 0, tokens.motion.fast);
  const press = disabled ? 0 : g.anim(`${id}#p`, st.active ? 1 : 0, 90);
  const focus = disabled ? 0 : g.anim(`${id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
  const sink = press * 2;
  return { box: inset(r, sink, sink * 0.6, sink * 1.4, sink * 0.6), hover, press, focus };
}

// ── Lock affordance ─────────────────────────────────────────────────────────

export interface LockInfo {
  /** Edition that unlocks it — "Pro" or "Enterprise". */
  requires: string;
  /** One line on what it does, shown in the upgrade sheet. */
  reason: string;
}

/** Compact "Pro"/"Enterprise" pill with a padlock. Returns its width. */
export function lockBadge(g: Gfx, x: number, cy: number, requires: string, align: "left" | "right" = "left"): number {
  const label = requires.toUpperCase();
  const tw = g.measure(label, { role: "label", size: 19 });
  const w = tw + 46;
  const h = 34;
  const bx = align === "right" ? x - w : x;
  const box = { x: bx, y: cy - h / 2, w, h };
  g.fillRound(box, tokens.radius.pill, rgba(palette.reward, 0.14));
  g.strokeRound(box, tokens.radius.pill, rgba(palette.reward, 0.4));
  icon(g, "lock", bx + 17, cy, 17, palette.reward, 2);
  g.text(label, bx + 30, cy + 1, { role: "label", size: 19, color: palette.reward, tracking: 1.6 });
  return w;
}

// ── Header ──────────────────────────────────────────────────────────────────

export interface HeaderOptions {
  title: string;
  subtitle?: string;
  /** Renders a back control and returns true from `headerBack` when tapped. */
  backId?: string;
  backLabel?: string;
  /** Small right-aligned status text. */
  meta?: string;
  metaColor?: string;
}

/** Draws the screen header and returns the remaining content rect. */
export function header(g: Gfx, r: Rect, o: HeaderOptions): Rect {
  let cursor = r.x;
  const titleY = r.y + 34;

  if (o.backId) {
    const w = 116;
    const box = { x: r.x, y: r.y, w, h: CONTROL.hSmall };
    const { box: b, hover, press, focus } = pressBox(g, o.backId, box, false);
    focusRing(g, box, tokens.radius.pill, focus);
    g.fillRound(b, tokens.radius.pill, hover > 0 ? theme.cardHover : theme.card);
    g.strokeRound(b, tokens.radius.pill, hover > 0 ? theme.lineStrong : theme.line);
    icon(g, "back", b.x + 28, b.y + b.h / 2, 20, hover > 0 ? theme.fg : theme.fg2, 3);
    g.text(o.backLabel ?? "Back", b.x + 46, b.y + b.h / 2 + 1, {
      role: "caption",
      color: hover > 0 ? theme.fg : theme.fg2,
      alpha: 1 - press * 0.2,
    });
    g.hit({ id: o.backId, rect: box });
    cursor = r.x + w + 26;
  }

  g.text(o.title, cursor, titleY, { role: "h1", color: theme.fg, maxWidth: r.w - (cursor - r.x) - 260 });

  if (o.meta) {
    g.text(o.meta, r.x + r.w, titleY, {
      role: "caption",
      align: "right",
      color: o.metaColor ?? theme.fgMuted,
    });
  }

  let bottom = r.y + 72;
  if (o.subtitle) {
    g.text(o.subtitle, cursor, r.y + 86, { role: "body", color: theme.fg2, maxWidth: r.w - (cursor - r.x) });
    bottom = r.y + 112;
  }

  g.hairline(r.x, bottom + 18, r.x + r.w, bottom + 18);
  return { x: r.x, y: bottom + 46, w: r.w, h: r.h - (bottom + 46 - r.y) };
}

export function headerBack(g: Gfx, backId: string): boolean {
  return g.clicked(backId);
}

// ── Section label & divider ─────────────────────────────────────────────────

export function sectionLabel(g: Gfx, x: number, y: number, s: string, trailing?: string, width?: number): void {
  g.text(s, x, y, { role: "label", color: theme.fgMuted, upper: true });
  if (trailing && width !== undefined) {
    g.text(trailing, x + width, y, { role: "caption", color: theme.fgMuted, align: "right" });
  }
}

export function divider(g: Gfx, x: number, y: number, w: number): void {
  g.hairline(x, y, x + w, y);
}

// ── Button ──────────────────────────────────────────────────────────────────

export type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "accent";

export interface ButtonOptions {
  id: string;
  label: string;
  sublabel?: string;
  kind?: ButtonKind;
  disabled?: boolean;
  locked?: LockInfo;
  icon?: IconName;
  align?: "left" | "centre";
  radius?: number;
  /** Right-aligned trailing text, e.g. a count. */
  trailing?: string;
  busy?: boolean;
}

interface Skin {
  fill: string;
  fillHover: string;
  border: string;
  borderHover: string;
  fg: string;
  fgSub: string;
}

function skinFor(kind: ButtonKind, disabled: boolean): Skin {
  if (disabled) {
    return {
      fill: rgba(palette.ink, 0.3),
      fillHover: rgba(palette.ink, 0.3),
      border: theme.lineFaint,
      borderHover: theme.lineFaint,
      fg: theme.disabledFg,
      fgSub: theme.disabledFg,
    };
  }
  switch (kind) {
    case "primary":
      return {
        fill: palette.primary,
        fillHover: rgba(palette.primary, 0.86),
        border: rgba(ink.onPrimary, 0.24),
        borderHover: rgba(ink.onPrimary, 0.42),
        fg: ink.onPrimary,
        fgSub: rgba(ink.onPrimary, 0.78),
      };
    case "accent":
      return {
        fill: palette.accent,
        fillHover: rgba(palette.accent, 0.86),
        border: rgba(ink.onAccent, 0.2),
        borderHover: rgba(ink.onAccent, 0.36),
        fg: ink.onAccent,
        fgSub: rgba(ink.onAccent, 0.76),
      };
    case "danger":
      return {
        fill: rgba(palette.danger, 0.16),
        fillHover: rgba(palette.danger, 0.26),
        border: rgba(palette.danger, 0.46),
        borderHover: rgba(palette.danger, 0.7),
        fg: palette.danger,
        fgSub: rgba(palette.danger, 0.8),
      };
    case "ghost":
      return {
        fill: rgba(palette.ink, 0),
        fillHover: theme.cardHover,
        border: theme.line,
        borderHover: theme.lineStrong,
        fg: theme.fg2,
        fgSub: theme.fgMuted,
      };
    case "secondary":
    default:
      return {
        fill: theme.card,
        fillHover: theme.cardHover,
        border: theme.line,
        borderHover: theme.lineStrong,
        fg: theme.fg,
        fgSub: theme.fg2,
      };
  }
}

export function button(g: Gfx, r: Rect, o: ButtonOptions): boolean {
  const disabled = !!o.disabled;
  const locked = !!o.locked;
  const kind = o.kind ?? "secondary";
  const skin = skinFor(locked ? "secondary" : kind, disabled);
  const radius = o.radius ?? CONTROL.radius;
  const { box, hover, press, focus } = pressBox(g, o.id, r, disabled);

  focusRing(g, r, radius, focus);

  const fill = hover > 0 ? mix(skin.fill, skin.fillHover, hover) : skin.fill;
  g.fillRound(box, radius, fill);
  g.strokeRound(box, radius, hover > 0 ? skin.borderHover : skin.border);

  // A single top-edge highlight reads as a lit surface without a glow.
  if (!disabled && (kind === "primary" || kind === "accent")) {
    g.save();
    g.clip(box, radius);
    g.hairline(box.x + radius, box.y + 1, box.x + box.w - radius, box.y + 1, rgba(ink.onPrimary, 0.28));
    g.restore();
  }

  const centred = (o.align ?? "centre") === "centre";
  const fg = locked ? theme.fg2 : skin.fg;
  const contentX = box.x + CONTROL.pad;
  let iconW = 0;
  if (o.icon && !centred) {
    iconW = 34;
    icon(g, o.icon, contentX + 12, box.y + box.h / 2, 24, fg, 2.6);
  }

  const lockW = locked && o.locked ? 130 : 0;
  const availW = box.w - CONTROL.pad * 2 - iconW - lockW;

  if (o.sublabel) {
    const tx = centred ? box.x + box.w / 2 : contentX + iconW;
    g.text(o.label, tx, box.y + box.h * 0.36, {
      role: "h3",
      color: fg,
      align: centred ? "centre" : "left",
      maxWidth: availW,
      alpha: 1 - press * 0.15,
    });
    g.text(o.sublabel, tx, box.y + box.h * 0.68, {
      role: "caption",
      color: locked ? theme.fgMuted : skin.fgSub,
      align: centred ? "centre" : "left",
      maxWidth: availW,
    });
  } else {
    const tx = centred ? box.x + box.w / 2 - (o.icon && centred ? 18 : 0) : contentX + iconW;
    if (o.icon && centred) {
      const lw = g.measure(o.label, { role: "h3" });
      icon(g, o.icon, box.x + box.w / 2 - lw / 2 - 22, box.y + box.h / 2, 24, fg, 2.6);
    }
    g.text(o.label, tx, box.y + box.h / 2 + 1, {
      role: "h3",
      color: fg,
      align: centred ? "centre" : "left",
      maxWidth: availW,
      alpha: 1 - press * 0.15,
    });
  }

  if (o.trailing) {
    g.text(o.trailing, box.x + box.w - CONTROL.pad, box.y + box.h / 2 + 1, {
      role: "caption",
      color: locked ? theme.fgMuted : skin.fgSub,
      align: "right",
    });
  }

  if (locked && o.locked) {
    lockBadge(g, box.x + box.w - CONTROL.pad, box.y + box.h / 2, o.locked.requires, "right");
  }

  if (o.busy) {
    const dots = 3;
    for (let i = 0; i < dots; i++) {
      const a = 0.3 + 0.7 * g.anim(`${o.id}#busy${i}`, 1, 400 + i * 160);
      g.circle(box.x + box.w - CONTROL.pad - 8 - i * 18, box.y + box.h / 2, 4, rgba(skin.fg, a * 0.5));
    }
  }

  g.hit({ id: o.id, rect: r, disabled });
  return !disabled && g.clicked(o.id);
}

/** Square icon-only control. */
export function iconButton(
  g: Gfx,
  r: Rect,
  o: { id: string; icon: IconName; label: string; disabled?: boolean; tone?: string },
): boolean {
  const disabled = !!o.disabled;
  const { box, hover, focus } = pressBox(g, o.id, r, disabled);
  focusRing(g, r, CONTROL.radius, focus);
  g.fillRound(box, CONTROL.radius, hover > 0 ? theme.cardHover : theme.card);
  g.strokeRound(box, CONTROL.radius, hover > 0 ? theme.lineStrong : theme.line);
  const col = disabled ? theme.disabledFg : o.tone ?? (hover > 0 ? theme.fg : theme.fg2);
  icon(g, o.icon, box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.42, col, 2.8);
  g.hit({ id: o.id, rect: r, disabled });
  return !disabled && g.clicked(o.id);
}

// ── Toggle ──────────────────────────────────────────────────────────────────

export interface ToggleOptions {
  id: string;
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  locked?: LockInfo;
  icon?: IconName;
}

/** Returns true when tapped — the caller owns the value. */
export function toggle(g: Gfx, r: Rect, o: ToggleOptions): boolean {
  const disabled = !!o.disabled;
  const locked = !!o.locked;
  const { box, hover, focus } = pressBox(g, o.id, r, disabled);
  focusRing(g, r, CONTROL.radius, focus);

  g.fillRound(box, CONTROL.radius, hover > 0 ? theme.cardHover : theme.card);
  g.strokeRound(box, CONTROL.radius, hover > 0 ? theme.lineStrong : theme.line);

  let tx = box.x + CONTROL.pad;
  if (o.icon) {
    icon(g, o.icon, tx + 12, box.y + box.h / 2, 24, disabled ? theme.disabledFg : theme.fg2, 2.4);
    tx += 44;
  }

  const switchW = 84;
  const stateW = 62;
  const rightEdge = box.x + box.w - CONTROL.pad;
  const textW = rightEdge - stateW - switchW - 28 - tx;

  const fg = disabled || locked ? theme.disabledFg : theme.fg;
  if (o.hint) {
    g.text(o.label, tx, box.y + box.h * 0.34, { role: "bodyStrong", color: fg, maxWidth: textW });
    g.text(o.hint, tx, box.y + box.h * 0.68, { role: "caption", color: theme.fgMuted, maxWidth: textW });
  } else {
    g.text(o.label, tx, box.y + box.h / 2 + 1, { role: "bodyStrong", color: fg, maxWidth: textW });
  }

  if (locked && o.locked) {
    lockBadge(g, rightEdge, box.y + box.h / 2, o.locked.requires, "right");
    g.hit({ id: o.id, rect: r, disabled: false });
    return g.clicked(o.id);
  }

  // The word matters as much as the switch: state is never colour alone.
  const on = g.anim(`${o.id}#v`, o.value ? 1 : 0, tokens.motion.base);
  g.text(o.value ? "On" : "Off", rightEdge, box.y + box.h / 2 + 1, {
    role: "caption",
    align: "right",
    color: o.value ? palette.accent : theme.fgMuted,
  });

  const track: Rect = { x: rightEdge - stateW - 18 - switchW, y: box.y + box.h / 2 - 21, w: switchW, h: 42 };
  g.fillRound(track, tokens.radius.pill, disabled ? rgba(palette.ink, 0.4) : mix(rgba(palette.ink, 0.6), rgba(palette.accent, 0.9), on));
  g.strokeRound(track, tokens.radius.pill, on > 0.5 ? rgba(palette.accent, 0.6) : theme.line);
  const knobX = track.x + 21 + on * (track.w - 42);
  g.circle(knobX, track.y + track.h / 2, 15, disabled ? theme.disabledFg : on > 0.5 ? ink.onAccent : theme.fg2);
  if (on > 0.55) icon(g, "check", knobX, track.y + track.h / 2, 15, palette.accent, 2.6);

  g.hit({ id: o.id, rect: r, disabled });
  return !disabled && g.clicked(o.id);
}

// ── Segmented control ───────────────────────────────────────────────────────

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  locked?: LockInfo;
  disabled?: boolean;
}

/** Returns the newly-picked option id, or null. Locked picks return too. */
export function segmented<T extends string>(
  g: Gfx,
  r: Rect,
  o: { id: string; options: readonly SegmentOption<T>[]; value: T; compact?: boolean },
): T | null {
  const n = o.options.length;
  if (n === 0) return null;
  const radius = tokens.radius.md;
  g.fillRound(r, radius, rgba(palette.ink, 0.42));
  g.strokeRound(r, radius, theme.line);

  const pad = 5;
  const inner = inset(r, pad);
  const segW = inner.w / n;
  const activeIndex = Math.max(0, o.options.findIndex((s) => s.id === o.value));

  // The indicator slides rather than blinks — it shows *where* selection moved.
  const pos = g.anim(`${o.id}#i`, activeIndex, tokens.motion.base);
  const indicator: Rect = { x: inner.x + pos * segW, y: inner.y, w: segW, h: inner.h };
  g.fillRound(indicator, radius - 2, rgba(palette.primary, 0.9));
  g.strokeRound(indicator, radius - 2, rgba(ink.onPrimary, 0.22));

  let picked: T | null = null;
  o.options.forEach((seg, i) => {
    const cell: Rect = { x: inner.x + i * segW, y: inner.y, w: segW, h: inner.h };
    const id = `${o.id}:${seg.id}`;
    const st = g.state(id);
    const selected = i === activeIndex;
    const locked = !!seg.locked;
    const fg = seg.disabled
      ? theme.disabledFg
      : selected
        ? ink.onPrimary
        : st.hover
          ? theme.fg
          : locked
            ? theme.fgMuted
            : theme.fg2;

    const focus = g.anim(`${id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
    focusRing(g, inset(cell, 2), radius - 2, focus);

    const role = o.compact ? "caption" : "bodyStrong";
    let lx = cell.x + cell.w / 2;
    if (locked) {
      // Shift the label left to make room for a padlock inside the segment.
      const tw = Math.min(g.measure(seg.label, { role }), cell.w - 54);
      lx -= 15;
      icon(g, "lock", lx + tw / 2 + 13, cell.y + cell.h / 2, 18, palette.reward, 2.2);
    }
    g.text(seg.label, lx, cell.y + cell.h / 2 + 1, {
      role,
      color: fg,
      align: "centre",
      maxWidth: cell.w - (locked ? 54 : 20),
    });

    // Selected segment also carries a mark, so the choice survives greyscale.
    if (selected && !o.compact) {
      g.hairline(cell.x + cell.w / 2 - 12, cell.y + cell.h - 9, cell.x + cell.w / 2 + 12, cell.y + cell.h - 9, rgba(ink.onPrimary, 0.55));
    }

    g.hit({ id, rect: cell, disabled: !!seg.disabled });
    if (!seg.disabled && g.clicked(id)) picked = seg.id;
  });

  return picked;
}

// ── Slider ──────────────────────────────────────────────────────────────────

export interface SliderOptions {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  hint?: string;
}

/**
 * Slider with explicit − / + steppers. Dragging a 2 mm knob with a controller
 * ray across a room is a coin flip; the steppers make the control exact, and
 * the track still gives the fast coarse adjustment.
 */
export function slider(g: Gfx, r: Rect, o: SliderOptions): number | null {
  const disabled = !!o.disabled;
  const quant = (v: number) => Math.round(clamp(v, o.min, o.max) / o.step) * o.step;

  const labelH = 34;
  g.text(o.label, r.x, r.y + 12, { role: "bodyStrong", color: disabled ? theme.disabledFg : theme.fg });
  g.text(o.format(o.value), r.x + r.w, r.y + 12, {
    role: "mono",
    align: "right",
    color: disabled ? theme.disabledFg : palette.accent,
  });
  if (o.hint) g.text(o.hint, r.x, r.y + r.h - 6, { role: "caption", color: theme.fgMuted });

  const row: Rect = { x: r.x, y: r.y + labelH, w: r.w, h: CONTROL.hSmall };
  const btn = CONTROL.hSmall;
  const [minusR, rest] = cutLeft(row, btn, 14);
  const [plusR, trackR] = cutRight(rest, btn, 14);

  let next: number | null = null;

  if (iconButton(g, minusR, { id: `${o.id}#-`, icon: "minus", label: "Decrease", disabled: disabled || o.value <= o.min })) {
    next = quant(o.value - o.step);
  }
  if (iconButton(g, plusR, { id: `${o.id}#+`, icon: "plus", label: "Increase", disabled: disabled || o.value >= o.max })) {
    next = quant(o.value + o.step);
  }

  const trackH = 12;
  const track: Rect = { x: trackR.x, y: trackR.y + trackR.h / 2 - trackH / 2, w: trackR.w, h: trackH };
  const t = (clamp(o.value, o.min, o.max) - o.min) / Math.max(1e-6, o.max - o.min);
  const st = g.state(o.id);
  const hover = disabled ? 0 : g.anim(`${o.id}#h`, st.hover || st.active ? 1 : 0, tokens.motion.fast);

  g.fillRound(track, tokens.radius.pill, rgba(palette.ink, 0.6));
  g.strokeRound(track, tokens.radius.pill, theme.line);
  if (t > 0) {
    g.fillRound({ ...track, w: Math.max(trackH, track.w * t) }, tokens.radius.pill, disabled ? theme.disabledFg : palette.accent);
  }

  // Step ticks give the value a readable scale without a second axis label.
  const steps = Math.round((o.max - o.min) / o.step);
  if (steps > 1 && steps <= 24) {
    for (let i = 0; i <= steps; i++) {
      const x = track.x + (track.w * i) / steps;
      g.hairline(x, track.y + track.h + 8, x, track.y + track.h + 14, theme.lineFaint);
    }
  }

  const knobX = track.x + track.w * t;
  const knobR = 19 + hover * 2;
  g.circle(knobX, track.y + track.h / 2, knobR + 3, rgba(palette.ink, 0.85));
  g.circle(knobX, track.y + track.h / 2, knobR, disabled ? theme.disabledFg : theme.fg);
  if (!disabled) g.ring(knobX, track.y + track.h / 2, knobR, rgba(palette.accent, 0.5 + hover * 0.5), 2);

  const focus = disabled ? 0 : g.anim(`${o.id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
  focusRing(g, inset(track, -14), tokens.radius.pill, focus);

  const hitRect = inset(track, -22);
  g.hit({ id: o.id, rect: hitRect, disabled });

  const d = g.drag(o.id);
  if (d && !disabled) {
    const v = quant(o.min + ((d.x - track.x) / track.w) * (o.max - o.min));
    if (v !== o.value) next = v;
  }

  return next;
}

// ── Stepper ─────────────────────────────────────────────────────────────────

export function stepper(
  g: Gfx,
  r: Rect,
  o: { id: string; label: string; value: number; min: number; max: number; hint?: string; disabled?: boolean },
): number | null {
  const disabled = !!o.disabled;
  g.fillRound(r, CONTROL.radius, theme.card);
  g.strokeRound(r, CONTROL.radius, theme.line);

  const btn = 56;
  const inner = inset(r, (r.h - btn) / 2, 12);
  const [minusR, rest] = cutLeft(inner, btn, 0);
  const [plusR, mid] = cutRight(rest, btn, 0);

  g.text(o.label, mid.x + 8, r.y + (o.hint ? r.h * 0.34 : r.h / 2) + 1, {
    role: "bodyStrong",
    color: disabled ? theme.disabledFg : theme.fg,
  });
  if (o.hint) g.text(o.hint, mid.x + 8, r.y + r.h * 0.68, { role: "caption", color: theme.fgMuted });
  g.text(String(o.value), mid.x + mid.w - 12, r.y + r.h / 2 + 1, {
    role: "h2",
    align: "right",
    color: disabled ? theme.disabledFg : palette.accent,
  });

  let next: number | null = null;
  if (iconButton(g, minusR, { id: `${o.id}#-`, icon: "minus", label: "Fewer", disabled: disabled || o.value <= o.min })) {
    next = o.value - 1;
  }
  if (iconButton(g, plusR, { id: `${o.id}#+`, icon: "plus", label: "More", disabled: disabled || o.value >= o.max })) {
    next = o.value + 1;
  }
  return next;
}

// ── List row ────────────────────────────────────────────────────────────────

export interface ListRowOptions {
  id: string;
  title: string;
  subtitle?: string;
  /** Right-hand value. */
  value?: string;
  selected?: boolean;
  disabled?: boolean;
  locked?: LockInfo;
  icon?: IconName;
  /** Colour swatch on the leading edge, e.g. a seat colour. */
  accent?: string;
  /** Small pills after the title. */
  tags?: readonly { label: string; tone?: "neutral" | "accent" | "reward" | "danger" }[];
  chevron?: boolean;
}

export function listRow(g: Gfx, r: Rect, o: ListRowOptions): boolean {
  const disabled = !!o.disabled;
  const locked = !!o.locked;
  const { box, hover, focus } = pressBox(g, o.id, r, disabled);
  focusRing(g, r, CONTROL.radius, focus);

  const fill = o.selected ? theme.cardSelected : hover > 0 ? theme.cardHover : theme.card;
  g.fillRound(box, CONTROL.radius, fill);
  g.strokeRound(box, CONTROL.radius, o.selected ? rgba(palette.primary, 0.7) : hover > 0 ? theme.lineStrong : theme.line);

  let x = box.x + CONTROL.pad;

  if (o.accent) {
    g.fillRound({ x: box.x + 8, y: box.y + 12, w: 6, h: box.h - 24 }, 3, o.accent);
    x += 8;
  }
  if (o.icon) {
    icon(g, o.icon, x + 14, box.y + box.h / 2, 26, disabled ? theme.disabledFg : theme.fg2, 2.4);
    x += 46;
  }

  const rightPad = CONTROL.pad + (o.chevron ? 34 : 0);
  let rightEdge = box.x + box.w - rightPad;

  if (locked && o.locked) {
    rightEdge -= lockBadge(g, rightEdge, box.y + box.h / 2, o.locked.requires, "right") + 16;
  } else if (o.value) {
    const vw = g.measure(o.value, { role: "bodyStrong" });
    g.text(o.value, rightEdge, box.y + box.h / 2 + 1, {
      role: "bodyStrong",
      align: "right",
      color: disabled ? theme.disabledFg : theme.fg,
    });
    rightEdge -= vw + 18;
  }

  let titleW = rightEdge - x;
  if (o.tags?.length) {
    let tx = x + Math.min(titleW, g.measure(o.title, { role: "bodyStrong" })) + 14;
    for (const t of o.tags) {
      tx += tag(g, tx, box.y + (o.subtitle ? box.h * 0.34 : box.h / 2), t.label, t.tone) + 8;
    }
    titleW = Math.min(titleW, tx - x);
  }

  const fg = disabled || locked ? theme.disabledFg : theme.fg;
  if (o.subtitle) {
    g.text(o.title, x, box.y + box.h * 0.34, { role: "bodyStrong", color: fg, maxWidth: titleW });
    g.text(o.subtitle, x, box.y + box.h * 0.68, { role: "caption", color: theme.fgMuted, maxWidth: rightEdge - x });
  } else {
    g.text(o.title, x, box.y + box.h / 2 + 1, { role: "bodyStrong", color: fg, maxWidth: titleW });
  }

  if (o.chevron) {
    icon(g, "forward", box.x + box.w - 30, box.y + box.h / 2, 18, theme.fgMuted, 2.4);
  }
  if (o.selected) {
    icon(g, "check", box.x + box.w - rightPad - 8, box.y + box.h / 2, 22, palette.accent, 3);
  }

  g.hit({ id: o.id, rect: r, disabled });
  return !disabled && g.clicked(o.id);
}

// ── Tag / chip ──────────────────────────────────────────────────────────────

export function tag(
  g: Gfx,
  x: number,
  cy: number,
  label: string,
  tone: "neutral" | "accent" | "reward" | "danger" = "neutral",
): number {
  const colour =
    tone === "accent" ? palette.accent : tone === "reward" ? palette.reward : tone === "danger" ? palette.danger : ink.secondary;
  const tw = g.measure(label, { role: "label", size: 18, tracking: 1.4 });
  const w = tw + 24;
  const box = { x, y: cy - 15, w, h: 30 };
  g.fillRound(box, tokens.radius.sm, rgba(colour, 0.14));
  g.strokeRound(box, tokens.radius.sm, rgba(colour, 0.34));
  g.text(label, x + 12, cy + 1, { role: "label", size: 18, tracking: 1.4, color: colour, upper: true });
  return w;
}

export function chip(g: Gfx, r: Rect, o: { id: string; label: string; disabled?: boolean }): boolean {
  const disabled = !!o.disabled;
  const { box, hover, focus } = pressBox(g, o.id, r, disabled);
  focusRing(g, r, tokens.radius.pill, focus);
  g.fillRound(box, tokens.radius.pill, hover > 0 ? theme.cardHover : theme.card);
  g.strokeRound(box, tokens.radius.pill, hover > 0 ? rgba(palette.accent, 0.6) : theme.line);
  g.text(o.label, box.x + box.w / 2, box.y + box.h / 2 + 1, {
    role: "body",
    align: "centre",
    color: disabled ? theme.disabledFg : hover > 0 ? theme.fg : theme.fg2,
    maxWidth: box.w - 32,
  });
  g.hit({ id: o.id, rect: r, disabled });
  return !disabled && g.clicked(o.id);
}

// ── Avatar & seat chip ──────────────────────────────────────────────────────

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function seatColor(seat: number): string {
  return seatColors[((seat % seatColors.length) + seatColors.length) % seatColors.length];
}

export interface AvatarOptions {
  seat: number;
  name: string;
  isAi?: boolean;
  connected?: boolean;
  out?: boolean;
  /** Draws the active-turn ring. */
  active?: boolean;
}

export function avatar(g: Gfx, cx: number, cy: number, radius: number, o: AvatarOptions): void {
  const col = seatColor(o.seat);
  const off = o.connected === false || o.out;

  g.circle(cx, cy, radius, rgba(col, off ? 0.1 : 0.2));
  if (off) {
    // Dashed ring, not a faded colour — legible without colour perception.
    g.save();
    g.ctx.setLineDash([7, 7]);
    g.ring(cx, cy, radius - 1, rgba(col, 0.55), 2.5);
    g.ctx.setLineDash([]);
    g.restore();
  } else {
    g.ring(cx, cy, radius - 1, rgba(col, 0.85), 2.5);
  }

  if (o.isAi) {
    icon(g, "ai", cx, cy, radius * 1.05, off ? rgba(col, 0.5) : col, 2.6);
  } else {
    g.text(initialsOf(o.name), cx, cy + 1, {
      role: "bodyStrong",
      size: radius * 0.82,
      align: "centre",
      color: off ? rgba(col, 0.55) : col,
    });
  }

  if (o.active) {
    g.ring(cx, cy, radius + 7, palette.accent, 3);
  }
  if (o.out) {
    g.path([cx - radius * 0.62, cy + radius * 0.62, cx + radius * 0.62, cy - radius * 0.62], palette.danger, 3);
  }
}

// ── Room code ───────────────────────────────────────────────────────────────

/**
 * The hosting screen's headline. Six characters in three pairs, auto-sized to
 * fill the rect — this gets read out loud across a trade-show stand, so it is
 * deliberately the largest thing in the product.
 */
export function codeDisplay(g: Gfx, r: Rect, code: string): void {
  const chars = code.padEnd(6, " ").slice(0, 6).split("");
  const groupGap = r.w * 0.045;
  const tracking = r.w * 0.012;

  // Fit by measurement rather than guesswork so a re-skinned font still works.
  let size = Math.min(r.h * 0.92, 260);
  for (let guard = 0; guard < 12; guard++) {
    const advance = maxCharWidth(g, chars, size);
    const total = advance * 6 + tracking * 5 + groupGap * 2;
    if (total <= r.w) break;
    size *= r.w / total;
  }

  const advance = maxCharWidth(g, chars, size);
  const total = advance * 6 + tracking * 5 + groupGap * 2;
  let x = r.x + (r.w - total) / 2;
  const cy = r.y + r.h / 2;

  for (let i = 0; i < 6; i++) {
    const isBlank = chars[i] === " ";
    g.text(chars[i], x + advance / 2, cy, {
      role: "hero",
      size,
      align: "centre",
      color: isBlank ? theme.lineFaint : theme.fg,
    });
    // A hairline under each pair does the grouping without punctuation noise.
    if (i % 2 === 1) {
      const pairStart = x - advance - tracking;
      g.hairline(pairStart, cy + size * 0.62, x + advance, cy + size * 0.62, rgba(palette.accent, 0.45));
    }
    x += advance + tracking + (i % 2 === 1 ? groupGap : 0);
  }
}

function maxCharWidth(g: Gfx, chars: readonly string[], size: number): number {
  let w = 0;
  for (const c of chars) w = Math.max(w, g.measure(c === " " ? "W" : c, { role: "hero", size, tracking: 0 }));
  return w;
}

/** The join screen's progress display: six slots, filled left to right. */
export function codeSlots(
  g: Gfx,
  r: Rect,
  value: string,
  o: { status: "idle" | "checking" | "invalid" | "joined"; shake?: number },
): void {
  const slots = 6;
  const groupGap = 26;
  const gap = 12;
  const totalGaps = gap * 3 + groupGap * 2;
  const w = (r.w - totalGaps) / slots;
  const h = Math.min(r.h, w * 1.24);
  const y = r.y + (r.h - h) / 2;
  const shake = (o.shake ?? 0) * Math.sin((o.shake ?? 0) * 34) * 10;

  let x = r.x + shake;
  for (let i = 0; i < slots; i++) {
    const ch = value[i];
    const filled = ch !== undefined;
    const isNext = !filled && value.length === i;
    const box: Rect = { x, y, w, h };

    const border =
      o.status === "invalid" ? palette.danger : o.status === "joined" ? palette.accent : isNext ? palette.accent : filled ? theme.lineStrong : theme.line;

    g.fillRound(box, tokens.radius.md, filled ? rgba(palette.ink, 0.6) : rgba(palette.ink, 0.34));
    g.strokeRound(box, tokens.radius.md, border, isNext || o.status !== "idle" ? 3 : 1);

    if (filled) {
      const pop = g.anim(`slot${i}#pop`, 1, 140);
      g.text(ch, box.x + box.w / 2, box.y + box.h / 2 + 2, {
        role: "monoBig",
        size: h * 0.52 * (0.9 + pop * 0.1),
        align: "centre",
        color: o.status === "invalid" ? palette.danger : theme.fg,
        tracking: 0,
      });
    } else {
      g.hairline(box.x + box.w * 0.28, box.y + box.h * 0.72, box.x + box.w * 0.72, box.y + box.h * 0.72, isNext ? rgba(palette.accent, 0.8) : theme.lineStrong);
    }

    x += w + gap + (i % 2 === 1 && i < 5 ? groupGap - gap : 0);
  }
}

// ── Keypad ──────────────────────────────────────────────────────────────────

export interface KeypadOptions {
  id: string;
  /** Characters to offer, in order. */
  alphabet: string;
  cols: number;
  disabled?: boolean;
  /** Extra keys along the bottom. */
  extras?: readonly { id: string; label?: string; icon?: IconName; kind?: ButtonKind; wide?: number; disabled?: boolean }[];
}

export type KeypadPress = { kind: "char"; char: string } | { kind: "extra"; id: string };

/**
 * The on-panel keyboard. `CODE_ALPHABET` has no vowels and no 0/O/1/I/L, so a
 * six-key-wide grid stays uncrowded and no key is confusable with its neighbour.
 */
export function keypad(g: Gfx, r: Rect, o: KeypadOptions): KeypadPress | null {
  const chars = [...o.alphabet];
  const cols = o.cols;
  const rows = Math.ceil(chars.length / cols);
  const extras = o.extras ?? [];
  const extraH = extras.length ? CONTROL.h : 0;
  const gap = 10;

  const gridRect: Rect = { x: r.x, y: r.y, w: r.w, h: r.h - (extraH ? extraH + CONTROL.gap : 0) };
  const cells = gridIn(gridRect, cols, rows, gap);

  let out: KeypadPress | null = null;

  chars.forEach((ch, i) => {
    const cell = cells[i];
    if (!cell) return;
    const id = `${o.id}:${ch}`;
    const disabled = !!o.disabled;
    const { box, hover, press, focus } = pressBox(g, id, cell, disabled);
    focusRing(g, cell, tokens.radius.md, focus);
    g.fillRound(box, tokens.radius.md, hover > 0 ? rgba(palette.primary, 0.24) : theme.card);
    g.strokeRound(box, tokens.radius.md, hover > 0 ? rgba(palette.primary, 0.8) : theme.line);
    g.text(ch, box.x + box.w / 2, box.y + box.h / 2 + 1, {
      role: "mono",
      size: Math.min(38, box.h * 0.5),
      align: "centre",
      tracking: 0,
      color: disabled ? theme.disabledFg : hover > 0 ? theme.fg : theme.fg2,
      alpha: 1 - press * 0.2,
    });
    g.hit({ id, rect: cell, disabled });
    if (!disabled && g.clicked(id)) out = { kind: "char", char: ch };
  });

  if (extras.length) {
    const row: Rect = { x: r.x, y: r.y + r.h - extraH, w: r.w, h: extraH };
    const units = extras.reduce((n, e) => n + (e.wide ?? 1), 0);
    const unitW = (row.w - gap * (extras.length - 1)) / units;
    let x = row.x;
    for (const e of extras) {
      const w = unitW * (e.wide ?? 1);
      const cell: Rect = { x, y: row.y, w, h: row.h };
      const id = `${o.id}!${e.id}`;
      const pressed = e.icon && !e.label
        ? iconButton(g, cell, { id, icon: e.icon, label: e.id, disabled: e.disabled })
        : button(g, cell, { id, label: e.label ?? e.id, icon: e.icon, kind: e.kind ?? "secondary", disabled: e.disabled });
      if (pressed) out = { kind: "extra", id: e.id };
      x += w + gap;
    }
  }

  return out;
}

// ── Stats, pager, empty state ───────────────────────────────────────────────

export function statTile(
  g: Gfx,
  r: Rect,
  o: { label: string; value: string; tone?: string; hint?: string },
): void {
  g.fillRound(r, CONTROL.radius, theme.card);
  g.strokeRound(r, CONTROL.radius, theme.line);
  g.text(o.label, r.x + CONTROL.pad, r.y + 28, { role: "label", color: theme.fgMuted, upper: true });
  g.text(o.value, r.x + CONTROL.pad, r.y + r.h - (o.hint ? 44 : 30), {
    role: "h2",
    color: o.tone ?? theme.fg,
    baseline: "alphabetic",
    maxWidth: r.w - CONTROL.pad * 2,
  });
  if (o.hint) g.text(o.hint, r.x + CONTROL.pad, r.y + r.h - 20, { role: "caption", color: theme.fgMuted });
}

/**
 * Paged lists, not scrolling ones. A ray-driven scrollbar is imprecise and a
 * flick gesture is worse; two big buttons and a position readout never fail.
 */
export function pager(
  g: Gfx,
  r: Rect,
  o: { id: string; page: number; pages: number; caption?: string },
): number | null {
  if (o.pages <= 1) {
    if (o.caption) g.text(o.caption, r.x, r.y + r.h / 2, { role: "caption", color: theme.fgMuted });
    return null;
  }
  let next: number | null = null;
  const btn = CONTROL.hSmall;
  // Right-aligned pair, previous then next.
  const nextBox: Rect = { x: r.x + r.w - btn, y: r.y + (r.h - btn) / 2, w: btn, h: btn };
  const prevBox: Rect = { x: nextBox.x - btn - 12, y: nextBox.y, w: btn, h: btn };

  if (iconButton(g, prevBox, { id: `${o.id}#prev`, icon: "back", label: "Previous page", disabled: o.page <= 0 })) {
    next = o.page - 1;
  }
  if (iconButton(g, nextBox, { id: `${o.id}#next`, icon: "forward", label: "Next page", disabled: o.page >= o.pages - 1 })) {
    next = o.page + 1;
  }
  const caption = o.caption ?? `Page ${o.page + 1} of ${o.pages}`;
  g.text(caption, r.x, r.y + r.h / 2, { role: "caption", color: theme.fgMuted });
  return next;
}

export function emptyState(g: Gfx, r: Rect, o: { title: string; body: string; icon?: IconName }): void {
  const cy = r.y + r.h / 2;
  if (o.icon) icon(g, o.icon, r.x + r.w / 2, cy - 82, 56, theme.lineStrong, 2.6);
  g.text(o.title, r.x + r.w / 2, cy - 12, { role: "h3", align: "centre", color: theme.fg2 });
  g.paragraph(o.body, { x: r.x + r.w / 2 - 320, y: cy + 12, w: 640, h: 90 }, {
    role: "body",
    align: "centre",
    color: theme.fgMuted,
    lines: 2,
  });
}

// ── Notice bar ──────────────────────────────────────────────────────────────

export type Tone = "info" | "success" | "warn" | "danger";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "success":
      return palette.accent;
    case "warn":
      return palette.reward;
    case "danger":
      return palette.danger;
    default:
      return palette.primary;
  }
}

export function toneIcon(tone: Tone): IconName {
  switch (tone) {
    case "success":
      return "check";
    case "warn":
      return "spark";
    case "danger":
      return "cross";
    default:
      return "eye";
  }
}

/** Inline status bar. Always carries an icon so it never reads as colour alone. */
export function notice(g: Gfx, r: Rect, o: { text: string; tone?: Tone; detail?: string }): void {
  const tone = o.tone ?? "info";
  const col = toneColor(tone);
  g.fillRound(r, CONTROL.radius, rgba(col, 0.12));
  g.strokeRound(r, CONTROL.radius, rgba(col, 0.42));
  icon(g, toneIcon(tone), r.x + 34, r.y + r.h / 2, 24, col, 3);
  const tx = r.x + 62;
  if (o.detail) {
    g.text(o.text, tx, r.y + r.h * 0.36, { role: "bodyStrong", color: col, maxWidth: r.w - 96 });
    g.text(o.detail, tx, r.y + r.h * 0.7, { role: "caption", color: theme.fg2, maxWidth: r.w - 96 });
  } else {
    g.text(o.text, tx, r.y + r.h / 2 + 1, { role: "bodyStrong", color: col, maxWidth: r.w - 96 });
  }
}

// ── Connection pip ──────────────────────────────────────────────────────────

export type PipStatus = "offline" | "connecting" | "online" | "reconnecting" | "failed";

/** Status dot + word + latency. Width returned so callers can lay out around it. */
export function connectionPip(g: Gfx, x: number, cy: number, status: PipStatus, latencyMs: number): number {
  const map: Record<PipStatus, { label: string; col: string; bars: number }> = {
    online: { label: latencyMs > 0 ? `Online · ${Math.round(latencyMs)} ms` : "Online", col: palette.accent, bars: 3 },
    connecting: { label: "Connecting", col: palette.reward, bars: 1 },
    reconnecting: { label: "Reconnecting", col: palette.reward, bars: 1 },
    offline: { label: "Offline", col: ink.muted, bars: 0 },
    failed: { label: "No connection", col: palette.danger, bars: 0 },
  };
  const s = map[status];
  for (let i = 0; i < 3; i++) {
    const h = 8 + i * 6;
    const on = i < s.bars;
    g.fillRound({ x: x + i * 9, y: cy + 10 - h, w: 6, h }, 2, on ? s.col : rgba(ink.muted, 0.32));
  }
  const tx = x + 36;
  g.text(s.label, tx, cy + 1, { role: "caption", color: s.col });
  return 36 + g.measure(s.label, { role: "caption" });
}

// ── Modal sheet ─────────────────────────────────────────────────────────────

export interface SheetOptions {
  id: string;
  title: string;
  body: string;
  bullets?: readonly string[];
  primary?: { id: string; label: string };
  secondary?: { id: string; label: string };
  footnote?: string;
  tone?: Tone;
}

export type SheetResult = "primary" | "secondary" | "dismiss" | null;

/**
 * The upgrade / confirmation sheet. Reached only by tapping a locked control,
 * so it explains rather than interrupts — and it says what the feature does
 * before it says which edition has it.
 */
export function sheet(g: Gfx, area: Rect, o: SheetOptions): SheetResult {
  g.beginModal();

  g.save();
  g.alpha(0.94);
  g.fillRound(g.bounds, tokens.radius.lg, theme.scrim);
  g.restore();

  const w = Math.min(860, area.w - 80);
  const bulletH = (o.bullets?.length ?? 0) * 46;
  const h = 300 + bulletH + (o.footnote ? 40 : 0);
  const card = centreRect(area, w, Math.min(h, area.h));
  const col = toneColor(o.tone ?? "warn");

  g.fillRound(card, tokens.radius.lg, palette.surface);
  g.strokeRound(card, tokens.radius.lg, rgba(col, 0.42));
  g.save();
  g.clip(card, tokens.radius.lg);
  g.fillRound({ x: card.x, y: card.y, w: card.w, h: 4 }, 0, col);
  g.restore();

  const inner = inset(card, 40);
  let y = inner.y + 6;

  icon(g, o.tone === "warn" || !o.tone ? "lock" : toneIcon(o.tone), inner.x + 18, y + 16, 30, col, 2.8);
  g.text(o.title, inner.x + 48, y + 16, { role: "h2", color: theme.fg, maxWidth: inner.w - 60 });
  y += 58;

  y += g.paragraph(o.body, { x: inner.x, y, w: inner.w, h: 90 }, { role: "body", color: theme.fg2, lines: 3 }) + 22;

  if (o.bullets?.length) {
    for (const b of o.bullets) {
      icon(g, "check", inner.x + 12, y + 14, 18, col, 2.6);
      g.text(b, inner.x + 34, y + 15, { role: "body", color: theme.fg2, maxWidth: inner.w - 40 });
      y += 46;
    }
    y += 8;
  }

  if (o.footnote) {
    g.text(o.footnote, inner.x, y + 12, { role: "caption", color: theme.fgMuted, maxWidth: inner.w });
    y += 40;
  }

  const btnRow: Rect = { x: inner.x, y: card.y + card.h - 40 - CONTROL.h, w: inner.w, h: CONTROL.h };
  let result: SheetResult = null;

  if (o.primary && o.secondary) {
    const [left, right] = colsIn(btnRow, 2, 14);
    if (button(g, left, { id: `${o.id}#2`, label: o.secondary.label, kind: "ghost" })) result = "secondary";
    if (button(g, right, { id: `${o.id}#1`, label: o.primary.label, kind: "primary" })) result = "primary";
  } else if (o.primary) {
    if (button(g, btnRow, { id: `${o.id}#1`, label: o.primary.label, kind: "primary" })) result = "primary";
  }

  return result;
}

// ── Small helpers ───────────────────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Blends two CSS colour strings. Accepts `#RRGGBB` and `rgba(...)`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const k = clamp(t, 0, 1);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const gg = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  const al = ca[3] + (cb[3] - ca[3]) * k;
  return `rgba(${r}, ${gg}, ${bl}, ${al})`;
}

function parseColor(c: string): [number, number, number, number] {
  if (c.startsWith("#")) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
