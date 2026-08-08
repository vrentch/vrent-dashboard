/**
 * Card-face symbol sets.
 *
 * Every mark is drawn procedurally into ONE canvas that becomes ONE texture
 * atlas — no image files, no icon font, no emoji, and never one texture per
 * card (48 textures would blow the Quest's texture budget and the draw-call
 * budget with it).
 *
 * A face is a near-white substrate carrying a single deeply-saturated mark.
 * That reads as a physical printed card and, more importantly, stays legible
 * in both directions the product ships in: against a bright 360 panorama the
 * mark's darkness carries it, and against dark passthrough the substrate
 * itself is the contrast.
 *
 * Hues are derived from the brand palette by subdividing the arcs between the
 * brand's own hues, so a re-skin of `shared/brand.ts` re-skins the card faces
 * with it and the deck never drifts off-brand.
 */

import * as THREE from "three";
import { mulberry32 } from "../../shared/game.ts";
import { hex, palette, seatColors, text as brandText } from "../../shared/brand.ts";

// ── Catalogue ───────────────────────────────────────────────────────────────

export interface SymbolSetSpec {
  id: string;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** Highest-contrast option — surfaced first in the accessibility section. */
  accessible: boolean;
}

export const SYMBOL_SETS: readonly SymbolSetSpec[] = [
  {
    id: "glyphs",
    name: "Glyphs",
    blurb: "Precise geometric marks. The fastest set to read.",
    accessible: false,
  },
  {
    id: "constellations",
    name: "Constellations",
    blurb: "Node-and-line figures, each a small star chart.",
    accessible: false,
  },
  {
    id: "circuits",
    name: "Circuits",
    blurb: "Etched trace patterns with pads and vias.",
    accessible: false,
  },
  {
    id: "numerals",
    name: "Numerals",
    blurb: "Large numbers with a colour band. Easiest to call out loud.",
    accessible: true,
  },
];

export const DEFAULT_SYMBOL_SET_ID = "glyphs";

export function getSymbolSet(id: string): SymbolSetSpec {
  return (
    SYMBOL_SETS.find((s) => s.id === id) ??
    SYMBOL_SETS.find((s) => s.id === DEFAULT_SYMBOL_SET_ID)!
  );
}

/** Largest pair count any preset asks for; every set must cover it. */
export const MAX_SYMBOLS = 26;

// ── Colour ──────────────────────────────────────────────────────────────────

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(value: string): Hsl {
  const n = hex(value);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function css(c: Hsl, alpha = 1): string {
  const h = ((c.h % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, c.s));
  const l = Math.max(0, Math.min(100, c.l));
  return alpha >= 1
    ? `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`
    : `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha.toFixed(3)})`;
}

/** Shifts a hue's lightness/saturation without leaving the hue. */
function shade(c: Hsl, l: number, s = c.s): Hsl {
  return { h: c.h, s, l };
}

/**
 * The brand's own hues, deduplicated and sorted around the wheel. Everything a
 * card face is ever tinted with is interpolated between two neighbours in this
 * list, which is what keeps 24 symbols on-brand instead of rainbow soup.
 */
function brandAnchors(): Hsl[] {
  const sources = [
    palette.primary,
    palette.accent,
    palette.reward,
    palette.danger,
    ...seatColors,
  ];
  const out: Hsl[] = [];
  for (const src of sources) {
    const c = hexToHsl(src);
    if (c.s < 8) continue; // greys carry no hue to anchor with
    // Anchors closer than this to one already taken would waste a slot in the
    // ramp on a hue nobody can tell apart from its neighbour.
    if (out.some((o) => hueGap(o.h, c.h) < 14)) continue;
    out.push(c);
  }
  out.sort((a, b) => a.h - b.h);
  return out;
}

/** Shortest distance between two hues around the wheel, 0-180. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Builds `count` maximally-separated hues by repeatedly subdividing whichever
 * arc between brand anchors is currently the widest. Greedily splitting the
 * largest remaining interval is the optimal way to maximise the smallest gap,
 * which at 24 symbols lands every face ~13° from its nearest neighbour — close
 * to the 15° ceiling a 24-way split of the wheel allows.
 */
function hueRamp(count: number): Hsl[] {
  const anchors = brandAnchors();
  const a = anchors.length;
  if (a === 0) return new Array(count).fill(null).map(() => ({ h: 0, s: 0, l: 50 }));
  if (count <= a) {
    // Spread the requested few across the whole wheel rather than clustering.
    const picked: Hsl[] = [];
    for (let i = 0; i < count; i++) picked.push(anchors[Math.round((i * a) / count) % a]);
    return picked;
  }

  const gap: number[] = [];
  for (let i = 0; i < a; i++) {
    const next = anchors[(i + 1) % a];
    let d = next.h - anchors[i].h;
    if (d <= 0) d += 360;
    gap.push(d);
  }

  const divs = new Array<number>(a).fill(1);
  let total = a;
  while (total < count) {
    let best = 0;
    let bestWidth = -1;
    for (let i = 0; i < a; i++) {
      const w = gap[i] / divs[i];
      if (w > bestWidth) {
        bestWidth = w;
        best = i;
      }
    }
    divs[best]++;
    total++;
  }

  const out: Hsl[] = [];
  for (let i = 0; i < a && out.length < count; i++) {
    const from = anchors[i];
    const to = anchors[(i + 1) % a];
    for (let k = 0; k < divs[i] && out.length < count; k++) {
      const t = k / divs[i];
      out.push({
        h: from.h + gap[i] * t,
        s: from.s + (to.s - from.s) * t,
        l: from.l + (to.l - from.l) * t,
      });
    }
  }
  return out;
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/**
 * A drawing context for one tile. The canvas is already translated to the tile
 * centre; every coordinate below is a fraction of the tile edge, so the same
 * code produces the same mark at any atlas resolution.
 */
interface Pen {
  ctx: CanvasRenderingContext2D;
  /** Tile edge in device pixels — the unit multiplier. */
  k: number;
  /** The symbol's hue at drawing strength. */
  mark: string;
  /** The same hue, pale, for fills behind strokes. */
  wash: string;
  /** The same hue at full chroma, for accents and bands. */
  pure: string;
  /** Default stroke width, in tile fractions. */
  w: number;
  /** Deterministic per-symbol randomness. */
  rnd: () => number;
}

function begin(p: Pen): void {
  p.ctx.beginPath();
}

function stroke(p: Pen, width = p.w, color = p.mark): void {
  p.ctx.lineWidth = width * p.k;
  p.ctx.strokeStyle = color;
  p.ctx.stroke();
}

function fill(p: Pen, color = p.mark): void {
  p.ctx.fillStyle = color;
  p.ctx.fill();
}

function moveTo(p: Pen, x: number, y: number): void {
  p.ctx.moveTo(x * p.k, y * p.k);
}

function lineTo(p: Pen, x: number, y: number): void {
  p.ctx.lineTo(x * p.k, y * p.k);
}

function circlePath(p: Pen, x: number, y: number, r: number, ccw = false): void {
  p.ctx.arc(x * p.k, y * p.k, r * p.k, 0, Math.PI * 2, ccw);
}

function polyPath(p: Pen, pts: readonly number[], close = true): void {
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) moveTo(p, pts[0], pts[1]);
    else lineTo(p, pts[i], pts[i + 1]);
  }
  if (close) p.ctx.closePath();
}

function regularPath(p: Pen, sides: number, r: number, rotDeg: number): void {
  const rot = (rotDeg * Math.PI) / 180;
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) moveTo(p, x, y);
    else lineTo(p, x, y);
  }
  p.ctx.closePath();
}

/** A rounded capsule between two points — the workhorse for bars and traces. */
function barPath(p: Pen, x1: number, y1: number, x2: number, y2: number): void {
  moveTo(p, x1, y1);
  lineTo(p, x2, y2);
}

function capsule(p: Pen, x1: number, y1: number, x2: number, y2: number, w = p.w): void {
  p.ctx.lineCap = "round";
  begin(p);
  barPath(p, x1, y1, x2, y2);
  stroke(p, w);
}

function roundRectPath(p: Pen, x: number, y: number, w: number, h: number, r: number): void {
  const k = p.k;
  p.ctx.roundRect(x * k, y * k, w * k, h * k, r * k);
}

// ── Set: glyphs ─────────────────────────────────────────────────────────────

type Draw = (p: Pen) => void;

/**
 * 26 marks chosen so no two share a silhouette. Solid/outline, curved/straight
 * and radial/axial are all mixed deliberately — colour alone is never the only
 * thing separating two faces.
 */
const GLYPHS: readonly Draw[] = [
  // 0 disc
  (p) => {
    begin(p);
    circlePath(p, 0, 0, 0.27);
    fill(p);
  },
  // 1 ring
  (p) => {
    begin(p);
    circlePath(p, 0, 0, 0.25);
    stroke(p, 0.095);
  },
  // 2 triangle, up, solid
  (p) => {
    begin(p);
    regularPath(p, 3, 0.32, -90);
    fill(p);
  },
  // 3 triangle, down, outline
  (p) => {
    p.ctx.lineJoin = "miter";
    begin(p);
    regularPath(p, 3, 0.33, 90);
    stroke(p, 0.085);
  },
  // 4 square, solid
  (p) => {
    begin(p);
    p.ctx.rect(-0.25 * p.k, -0.25 * p.k, 0.5 * p.k, 0.5 * p.k);
    fill(p);
  },
  // 5 diamond, outline
  (p) => {
    begin(p);
    regularPath(p, 4, 0.34, 0);
    stroke(p, 0.085);
  },
  // 6 plus
  (p) => {
    capsule(p, 0, -0.29, 0, 0.29, 0.13);
    capsule(p, -0.29, 0, 0.29, 0, 0.13);
  },
  // 7 saltire
  (p) => {
    capsule(p, -0.22, -0.22, 0.22, 0.22, 0.13);
    capsule(p, 0.22, -0.22, -0.22, 0.22, 0.13);
  },
  // 8 hexagon, outline, flat-top
  (p) => {
    begin(p);
    regularPath(p, 6, 0.31, 0);
    stroke(p, 0.085);
  },
  // 9 hexagon, solid, point-top
  (p) => {
    begin(p);
    regularPath(p, 6, 0.3, 90);
    fill(p);
  },
  // 10 six-spoke asterisk
  (p) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      capsule(p, -Math.cos(a) * 0.29, -Math.sin(a) * 0.29, Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.09);
    }
  },
  // 11 chevron, up
  (p) => {
    p.ctx.lineCap = "round";
    p.ctx.lineJoin = "round";
    begin(p);
    polyPath(p, [-0.27, 0.1, 0, -0.17, 0.27, 0.1], false);
    stroke(p, 0.115);
  },
  // 12 double chevron, right
  (p) => {
    p.ctx.lineCap = "round";
    p.ctx.lineJoin = "round";
    for (const dx of [-0.14, 0.12]) {
      begin(p);
      polyPath(p, [dx, -0.22, dx + 0.19, 0, dx, 0.22], false);
      stroke(p, 0.095);
    }
  },
  // 13 crescent
  (p) => {
    begin(p);
    circlePath(p, -0.02, 0, 0.29);
    circlePath(p, 0.13, 0, 0.25, true);
    fill(p);
  },
  // 14 semicircle, flat side down
  (p) => {
    begin(p);
    p.ctx.arc(0, 0.11 * p.k, 0.3 * p.k, Math.PI, 0);
    p.ctx.closePath();
    fill(p);
  },
  // 15 quartered square, two solid
  (p) => {
    const s = 0.25;
    begin(p);
    p.ctx.rect(-s * p.k, -s * p.k, s * p.k, s * p.k);
    p.ctx.rect(0, 0, s * p.k, s * p.k);
    fill(p);
    begin(p);
    p.ctx.rect(-s * p.k, -s * p.k, 2 * s * p.k, 2 * s * p.k);
    stroke(p, 0.055);
  },
  // 16 nested squares
  (p) => {
    begin(p);
    p.ctx.rect(-0.3 * p.k, -0.3 * p.k, 0.6 * p.k, 0.6 * p.k);
    stroke(p, 0.08);
    begin(p);
    p.ctx.rect(-0.14 * p.k, -0.14 * p.k, 0.28 * p.k, 0.28 * p.k);
    stroke(p, 0.08);
  },
  // 17 three concentric rings
  (p) => {
    for (const r of [0.3, 0.195, 0.09]) {
      begin(p);
      circlePath(p, 0, 0, r);
      stroke(p, 0.065);
    }
  },
  // 18 three vertical bars
  (p) => {
    for (const x of [-0.2, 0, 0.2]) capsule(p, x, -0.27, x, 0.27, 0.105);
  },
  // 19 three horizontal bars
  (p) => {
    for (const y of [-0.2, 0, 0.2]) capsule(p, -0.29, y, 0.29, y, 0.105);
  },
  // 20 arrow, up
  (p) => {
    capsule(p, 0, 0.3, 0, -0.02, 0.105);
    begin(p);
    polyPath(p, [0, -0.32, 0.21, -0.02, -0.21, -0.02]);
    fill(p);
  },
  // 21 pentagon, outline
  (p) => {
    begin(p);
    regularPath(p, 5, 0.33, -90);
    stroke(p, 0.085);
  },
  // 22 octagon with a centre stud
  (p) => {
    begin(p);
    regularPath(p, 8, 0.31, 22.5);
    stroke(p, 0.075);
    begin(p);
    circlePath(p, 0, 0, 0.1);
    fill(p);
  },
  // 23 quincunx of four dots
  (p) => {
    for (const x of [-0.18, 0.18]) {
      for (const y of [-0.18, 0.18]) {
        begin(p);
        circlePath(p, x, y, 0.105);
        fill(p);
      }
    }
  },
  // 24 notched disc
  (p) => {
    begin(p);
    p.ctx.moveTo(0, 0);
    p.ctx.arc(0, 0, 0.3 * p.k, -Math.PI * 0.72, Math.PI * 0.72);
    p.ctx.closePath();
    fill(p);
  },
  // 25 square crossed by a diagonal
  (p) => {
    begin(p);
    p.ctx.rect(-0.28 * p.k, -0.28 * p.k, 0.56 * p.k, 0.56 * p.k);
    stroke(p, 0.08);
    capsule(p, -0.28, 0.28, 0.28, -0.28, 0.08);
  },
];

// ── Set: constellations ─────────────────────────────────────────────────────

/**
 * Each figure is a deterministic little star chart: 4-7 nodes on a jittered
 * ring, joined into an open path plus one chord. The node count and the ring
 * eccentricity both cycle, so no two figures come out with the same skeleton.
 */
function drawConstellation(p: Pen, index: number): void {
  const nodes = 4 + (index % 4);
  const squash = 0.62 + ((index * 7) % 5) * 0.09;
  const spin = ((index * 137.5) % 360) * (Math.PI / 180);
  const xs = new Array<number>(nodes);
  const ys = new Array<number>(nodes);

  for (let i = 0; i < nodes; i++) {
    const a = spin + (i / nodes) * Math.PI * 2 + (p.rnd() - 0.5) * 0.5;
    const r = 0.13 + p.rnd() * 0.19;
    xs[i] = Math.cos(a) * r;
    ys[i] = Math.sin(a) * r * squash;
  }

  p.ctx.lineCap = "round";
  p.ctx.lineJoin = "round";
  begin(p);
  for (let i = 0; i < nodes; i++) {
    if (i === 0) moveTo(p, xs[0], ys[0]);
    else lineTo(p, xs[i], ys[i]);
  }
  stroke(p, 0.032, p.mark);

  // One chord across the figure gives it a recognisable interior shape.
  const chord = 2 + Math.floor(p.rnd() * Math.max(1, nodes - 3));
  begin(p);
  moveTo(p, xs[0], ys[0]);
  lineTo(p, xs[chord % nodes], ys[chord % nodes]);
  stroke(p, 0.024, p.wash);

  for (let i = 0; i < nodes; i++) {
    const primary = i === (index % nodes);
    const r = primary ? 0.062 : 0.04 + p.rnd() * 0.014;
    if (primary) {
      begin(p);
      circlePath(p, xs[i], ys[i], r * 2.1);
      stroke(p, 0.02, p.wash);
    }
    begin(p);
    circlePath(p, xs[i], ys[i], r);
    fill(p, primary ? p.pure : p.mark);
  }
}

// ── Set: circuits ───────────────────────────────────────────────────────────

/**
 * A rectilinear trace walked across a lattice with 45° corners, terminated by
 * solder pads and punctuated with vias. Reads as etched copper rather than as
 * decoration, and the pad positions alone separate the figures.
 */
function drawCircuit(p: Pen, index: number): void {
  const cell = 0.145;
  const steps = 5 + (index % 3);
  let x = -0.29;
  let y = (index % 3) === 0 ? 0 : (index % 3) === 1 ? -0.145 : 0.145;

  p.ctx.lineCap = "square";
  p.ctx.lineJoin = "round";
  begin(p);
  moveTo(p, x, y);
  const via: number[] = [];
  for (let i = 0; i < steps; i++) {
    const diag = p.rnd() < 0.42;
    const dy = (Math.floor(p.rnd() * 3) - 1) * cell;
    const nx = Math.min(0.29, x + cell * (diag ? 1 : 1.15));
    const ny = Math.max(-0.29, Math.min(0.29, y + (diag ? Math.sign(dy || 1) * cell : dy)));
    if (diag) {
      lineTo(p, nx, ny);
    } else {
      lineTo(p, nx, y);
      lineTo(p, nx, ny);
    }
    x = nx;
    y = ny;
    if (i > 0 && i < steps - 1 && p.rnd() < 0.45) via.push(x, y);
  }
  lineTo(p, 0.29, y);
  stroke(p, 0.05, p.mark);

  // A shorter parallel trace, dimmer, for depth.
  begin(p);
  moveTo(p, -0.29, y + cell * 0.62);
  lineTo(p, -0.05, y + cell * 0.62);
  lineTo(p, 0.06, y + cell * 1.35);
  stroke(p, 0.03, p.wash);

  for (let i = 0; i < via.length; i += 2) {
    begin(p);
    circlePath(p, via[i], via[i + 1], 0.055);
    fill(p, brandText.primary);
    begin(p);
    circlePath(p, via[i], via[i + 1], 0.055);
    stroke(p, 0.028, p.pure);
  }

  for (const pad of [-0.31, 0.31]) {
    const py = pad < 0 ? (index % 3 === 0 ? 0 : index % 3 === 1 ? -0.145 : 0.145) : y;
    begin(p);
    roundRectPath(p, pad - 0.045, py - 0.075, 0.11, 0.15, 0.028);
    fill(p, p.pure);
  }
}

// ── Set: numerals ───────────────────────────────────────────────────────────

const NUMERAL_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function drawNumeral(p: Pen, index: number): void {
  const label = String(index + 1);
  const size = label.length > 1 ? 0.52 : 0.62;
  p.ctx.font = `650 ${size * p.k}px ${NUMERAL_FONT}`;
  p.ctx.textAlign = "center";
  p.ctx.textBaseline = "middle";
  p.ctx.fillStyle = p.mark;
  // Optical centring: digits sit slightly high once the colour band is added.
  p.ctx.fillText(label, 0, -0.045 * p.k);

  begin(p);
  roundRectPath(p, -0.23, 0.245, 0.46, 0.075, 0.0375);
  fill(p, p.pure);
}

// ── Atlas ───────────────────────────────────────────────────────────────────

export interface SymbolAtlas {
  /** The one shared texture every card face samples. */
  texture: THREE.Texture;
  /** Symbols baked in — always equal to the requested count. */
  count: number;
  setId: string;
  /**
   * Writes the tile rectangle for `symbol` as (offsetU, offsetV, scaleU, scaleV)
   * into `target`. Already inset by half a texel so mip levels cannot bleed a
   * neighbouring tile into a card face.
   */
  writeUvRect(symbol: number, target: THREE.Vector4): THREE.Vector4;
  /** The symbol's hue, for scoreboards, intent ghosts and UI chips. */
  color(symbol: number): THREE.Color;
  dispose(): void;
}

export interface SymbolAtlasOptions {
  /** Anisotropic filtering, from `renderer.capabilities.getMaxAnisotropy()`. */
  anisotropy?: number;
  /** Overrides the automatic tile size. Testing hook. */
  tile?: number;
}

/** Keeps the whole atlas around 1280px square whatever the symbol count is. */
function tileSizeFor(cols: number): number {
  const raw = Math.round(1280 / cols / 16) * 16;
  return Math.max(128, Math.min(384, raw));
}

function drawFor(setId: string): (p: Pen, index: number) => void {
  switch (setId) {
    case "constellations":
      return drawConstellation;
    case "circuits":
      return drawCircuit;
    case "numerals":
      return drawNumeral;
    default:
      return (p, index) => GLYPHS[index % GLYPHS.length](p);
  }
}

/** Stable per-set seed so a given symbol looks the same in every match. */
function setSeed(setId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < setId.length; i++) {
    h ^= setId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Draws `count` symbols of `setId` into a single canvas and wraps it as a
 * texture. Called once per match — never per card.
 */
export function buildSymbolAtlas(
  setId: string,
  count: number,
  options: SymbolAtlasOptions = {},
): SymbolAtlas {
  const n = Math.max(1, Math.min(MAX_SYMBOLS, Math.floor(count)));
  const spec = getSymbolSet(setId);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const tile = options.tile ?? tileSizeFor(cols);

  const canvas = document.createElement("canvas");
  canvas.width = cols * tile;
  canvas.height = rows * tile;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("symbols: 2D canvas unavailable");

  const substrate = brandText.primary;
  const vignette = hexToHsl(palette.surfaceAlt);
  const hues = hueRamp(n);
  const colors: THREE.Color[] = [];

  ctx.fillStyle = substrate;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const draw = drawFor(spec.id);

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * tile;
    const oy = row * tile;

    // Alternating lightness gives neighbouring hues a second axis of
    // separation, which matters most on the densest boards.
    const base = hues[i];
    const lift = i % 2 === 0 ? 0 : -4;
    const pure = shade(base, Math.max(38, Math.min(62, base.l + lift)), Math.min(96, base.s + 8));
    const mark = shade(pure, 34, Math.min(88, pure.s));
    const wash = shade(pure, 62, Math.min(70, pure.s));

    // sRGB, to match what the canvas actually painted — `setHSL` would
    // otherwise read the triple as linear-sRGB and shift the hue.
    colors.push(
      new THREE.Color().setHSL(
        (((pure.h % 360) + 360) % 360) / 360,
        Math.max(0, Math.min(1, pure.s / 100)),
        Math.max(0, Math.min(1, pure.l / 100)),
        THREE.SRGBColorSpace,
      ),
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, tile, tile);
    ctx.clip();

    // Substrate, with a whisper of a vignette so the face is not dead flat
    // under the clearcoat.
    ctx.fillStyle = substrate;
    ctx.fillRect(ox, oy, tile, tile);
    const grad = ctx.createRadialGradient(
      ox + tile * 0.5,
      oy + tile * 0.42,
      tile * 0.1,
      ox + tile * 0.5,
      oy + tile * 0.5,
      tile * 0.78,
    );
    grad.addColorStop(0, css(vignette, 0));
    grad.addColorStop(1, css(vignette, 0.13));
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, tile, tile);

    // Keyline in the symbol's own hue: the fastest colour cue at distance,
    // and it frames the mark so the face never looks unfinished.
    ctx.strokeStyle = css(pure, 0.34);
    ctx.lineWidth = Math.max(1, tile * 0.014);
    ctx.beginPath();
    ctx.roundRect(
      ox + tile * 0.085,
      oy + tile * 0.085,
      tile * 0.83,
      tile * 0.83,
      tile * 0.075,
    );
    ctx.stroke();

    ctx.save();
    ctx.translate(ox + tile * 0.5, oy + tile * 0.5);
    const pen: Pen = {
      ctx,
      k: tile,
      mark: css(mark),
      wash: css(wash),
      pure: css(pure),
      w: 0.075,
      rnd: mulberry32(setSeed(spec.id) ^ Math.imul(i + 1, 0x9e3779b1)),
    };
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    draw(pen, i);
    ctx.restore();

    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(1, Math.min(4, options.anisotropy ?? 1));
  texture.needsUpdate = true;

  const insetU = 1 / canvas.width;
  const insetV = 1 / canvas.height;
  const scaleU = tile / canvas.width;
  const scaleV = tile / canvas.height;
  const fallback = new THREE.Color(hex(palette.accent));

  return {
    texture,
    count: n,
    setId: spec.id,
    writeUvRect(symbol, target) {
      const i = ((symbol % n) + n) % n;
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Canvas rows run top-down, texture V runs bottom-up.
      const v = (rows - 1 - row) * scaleV;
      return target.set(
        col * scaleU + insetU,
        v + insetV,
        scaleU - insetU * 2,
        scaleV - insetV * 2,
      );
    },
    color(symbol) {
      return colors[((symbol % n) + n) % n] ?? fallback;
    },
    dispose() {
      texture.dispose();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
