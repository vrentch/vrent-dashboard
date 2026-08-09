/**
 * One card.
 *
 * The flip is the interaction the whole product is judged on, so it is built
 * as a physical event rather than a texture swap: the card takes a moment to
 * break free (anticipation lift + a touch of scale), turns on its own Y axis
 * under a cubic ease that carries momentum, and sets back down slightly after
 * the rotation has finished. A narrow specular band sweeps the face as it
 * turns, which is what sells the surface as a lit solid instead of a picture.
 *
 * Everything a card can look like — face art, brand back, brushed edge, rim
 * light, hover, match glow, claimed state, AI intent — is one MeshPhysicalMaterial
 * with a region attribute, so a card is a single draw call and every card in
 * the deck shares one geometry and one compiled program.
 *
 * Every colour here is derived from the live palette, so all of it goes stale
 * on a theme switch: the back is a canvas texture, the shared tints are parsed
 * THREE.Colors. `createCardResources` subscribes to `onThemeChange` and repaints
 * the back into the same canvas and rewrites the same uniforms, so a switch
 * never rebuilds the board and never interrupts a turn.
 */

import * as THREE from "three";
import {
  hex,
  luminance,
  mix,
  onThemeChange,
  palette,
  readableOn,
  rgba,
  scene,
  text as brandText,
  tokens,
} from "../../shared/brand.ts";
import type { BoardLayout } from "./layout.ts";
import type { SymbolAtlas } from "./symbols.ts";

// ── Card surfaces ───────────────────────────────────────────────────────────

/**
 * A card is the same physical object in both themes — a light printed face, a
 * dark brand back, a machined metal edge. What changes is which of the theme's
 * colours those are derived from, and how hard the face is driven once the room
 * around it is bright, which is `scene.cardFaceScale`'s job in the shader.
 *
 * These three are the whole vocabulary: `symbols.ts` prints onto `cardPaper()`,
 * the back plate is built out of `cardInk()`, the rim band is `cardEdge()`.
 */

function lightest(candidates: readonly string[]): string {
  let best = candidates[0];
  for (const c of candidates) if (luminance(c) > luminance(best)) best = c;
  return best;
}

function darkest(candidates: readonly string[]): string {
  let best = candidates[0];
  for (const c of candidates) if (luminance(c) < luminance(best)) best = c;
  return best;
}

/** How much brand hue the stock carries: enough to be off-white, not enough to
 *  tint the symbol printed on it. */
const PAPER_TINT = 0.05;

/**
 * The card face. Near-white in both themes — a light face is the only thing
 * that keeps a card legible against unlit passthrough, so a light theme pulls
 * its *brightness* back rather than swapping it for a dark plate.
 */
export function cardPaper(): string {
  return mix(
    lightest([palette.surface, palette.ink, palette.surfaceAlt, brandText.primary, brandText.onPrimary]),
    palette.primary,
    PAPER_TINT,
  );
}

/**
 * The deepest colour the theme owns. Backs stay a dark brand plate in both
 * themes: a light back would dissolve into a bright room, and the face/back
 * pair has to keep reading as two sides of one object.
 */
export function cardInk(): string {
  return darkest([palette.ink, palette.surface, palette.surfaceAlt, brandText.primary, brandText.secondary]);
}

/** Mid-metal luminance — `readableOn`'s own light/dark pivot. */
const EDGE_LUMINANCE = 0.45;

/**
 * Brushed-edge albedo: the theme's neutral, lifted toward the paper until it is
 * a mid metal, so the chamfer catches the key light with the same strength
 * whichever palette is loaded. The dark theme's neutral sits just under the
 * pivot and is nudged; the light theme's is a dark slate and is raised a long
 * way. Taking it straight from `text.secondary`, as this used to, made the edge
 * a near-black line in the light theme — the one part of a card that has to
 * stay bright, because it is the whole silhouette when the card turns edge-on.
 */
export function cardEdge(): string {
  const base = brandText.secondary;
  if (luminance(base) >= EDGE_LUMINANCE) return base;
  const paper = cardPaper();
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const t = (lo + hi) / 2;
    if (luminance(mix(base, paper, t)) < EDGE_LUMINANCE) lo = t;
    else hi = t;
  }
  return mix(base, paper, hi);
}

// ── Claimed cards ───────────────────────────────────────────────────────────

/**
 * A claimed pair has to do two contradictory things at once: leave the game
 * visually, and stay readable — the artwork is how a player checks who owns
 * which pair after the flourish is over.
 *
 * `keep` is the share of the card's own face luminance the claimed plate holds
 * on to, and `tint` is how far that plate travels toward the owner's hue. Both
 * are handed to the shader, which applies the hue as a *multiply* rather than
 * as a pedestal added underneath — see `FRAG_SURFACE`.
 */
export interface ClaimResponse {
  /** Fraction of the face's luminance the plate keeps, after `cardFaceScale`. */
  keep: number;
  /** How far the plate travels toward the seat colour, 0-1. */
  tint: number;
}

/**
 * Share of the face — as the room already dims it — a claimed plate keeps.
 * Measured, not guessed: on the shipping board a claimed plate then renders at
 * roughly half an unclaimed face's luminance, which is where the printed symbol
 * still clears the 3:1 graphics-contrast bar. Everything below ~0.5 puts the
 * darkest marks under it, because a plate that dark is fighting the flat 0.05
 * term in the contrast formula rather than the artwork.
 */
const CLAIM_KEEP = 0.58;
/**
 * Floor on the same plate, measured against an *undimmed* face. A bright room
 * has already pulled every face back through `scene.cardFaceScale`, so keeping
 * a flat share of that would dim a claimed card twice. This is the per-theme
 * half of the response: inert in the dark theme, live in the light one.
 */
const CLAIM_FLOOR = 0.5;
/** A very dark room must not be able to drive the floor into a full-bright plate. */
const CLAIM_KEEP_MAX = 0.75;
/**
 * How much owner hue the plate carries. High enough to name the seat across a
 * table, low enough that the mark keeps its own colour underneath.
 */
const CLAIM_TINT = 0.62;

/** The claimed-state response for the active theme. Derived, so it goes stale. */
export function claimResponse(): ClaimResponse {
  const faceScale = Math.max(0.05, scene.cardFaceScale);
  return {
    keep: Math.min(CLAIM_KEEP_MAX, Math.max(CLAIM_KEEP, CLAIM_FLOOR / faceScale)),
    tint: CLAIM_TINT,
  };
}

// ── Easing ──────────────────────────────────────────────────────────────────

/**
 * A CSS-style cubic bezier, solved with Newton-Raphson and a bisection
 * fallback. Written out rather than approximated because the flip's character
 * lives entirely in the shape of this curve.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;

  const curveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const curveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 5; i++) {
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      const err = curveX(t) - x;
      if (Math.abs(err) < 1e-5) return curveY(t);
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 12; i++) {
      const v = curveX(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v > x) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return curveY(t);
  };
}

/**
 * The flip curve, tuned by the numbers rather than by feel: 11% turned at a
 * quarter of the duration (the card is still breaking inertia), 74% at the
 * halfway point (momentum), 96% at three quarters (friction taking over).
 * Peak angular velocity lands at t≈0.41, just before the card goes edge-on,
 * which is where the specular sweep crosses it. No overshoot — a bounce would
 * read as a toy, and this is sold as a physical object.
 */
export const EASE_FLIP = cubicBezier(0.58, 0.0, 0.17, 1.0);
/** Match lift: immediate, then decelerating. */
export const EASE_OUT = cubicBezier(0.18, 0.72, 0.24, 1.0);
/** Settling back down. */
export const EASE_SETTLE = cubicBezier(0.4, 0.0, 0.18, 1.0);

const FLIP_MS = tokens.motion.flip;
/** The lift outlasts the turn, so the card visibly lands. */
const FLIP_LIFT_MS = FLIP_MS * 1.18;
const MISS_MS = tokens.motion.slow;
const MATCH_MS = 820;
const HOVER_TAU = 0.055;
const INTENT_TAU = 0.11;
const INTENT_PERIOD = 1.15;

// ── Geometry ────────────────────────────────────────────────────────────────

/** Region ids handed to the shader as a vertex attribute. */
const REGION_FACE = 0;
const REGION_BACK = 1;
const REGION_EDGE = 2;

const CORNER_SEGMENTS = 5;

/**
 * A chamfered rounded plate: flat face, flat back, and a three-band rim whose
 * hard creases catch the key light the way a machined edge does. Built once
 * and shared by every card on the board.
 */
export function buildCardGeometry(
  width: number,
  height: number,
  thickness: number,
  radius: number,
  bevel: number,
): THREE.BufferGeometry {
  const hw = width / 2;
  const hh = height / 2;
  const hz = thickness / 2;
  const r = Math.min(radius, Math.min(hw, hh) * 0.5);
  const b = Math.min(bevel, Math.min(r * 0.6, hz * 0.8));

  const segs = CORNER_SEGMENTS;
  const n = segs * 4;

  // Corner arc centres are shared by the full outline and the inset outline,
  // so the two rings correspond one-to-one and the bevel zips up cleanly.
  const ccx = [hw - r, -(hw - r), -(hw - r), hw - r];
  const ccy = [hh - r, hh - r, -(hh - r), -(hh - r)];

  const cosA = new Float64Array(n);
  const sinA = new Float64Array(n);
  const cIdx = new Uint8Array(n);
  for (let c = 0; c < 4; c++) {
    for (let s = 0; s < segs; s++) {
      const i = c * segs + s;
      const a = ((c * 90 + (s * 90) / segs) * Math.PI) / 180;
      cosA[i] = Math.cos(a);
      sinA[i] = Math.sin(a);
      cIdx[i] = c;
    }
  }

  const outerX = new Float64Array(n);
  const outerY = new Float64Array(n);
  const innerX = new Float64Array(n);
  const innerY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = cIdx[i];
    outerX[i] = ccx[c] + cosA[i] * r;
    outerY[i] = ccy[c] + sinA[i] * r;
    innerX[i] = ccx[c] + cosA[i] * (r - b);
    innerY[i] = ccy[c] + sinA[i] * (r - b);
  }

  const vertexCount = 2 * (n + 1) + 6 * n;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const regions = new Float32Array(vertexCount);
  const indices: number[] = [];

  let v = 0;
  const push = (
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    w: number,
    region: number,
  ): number => {
    positions[v * 3] = px;
    positions[v * 3 + 1] = py;
    positions[v * 3 + 2] = pz;
    normals[v * 3] = nx;
    normals[v * 3 + 1] = ny;
    normals[v * 3 + 2] = nz;
    uvs[v * 2] = u;
    uvs[v * 2 + 1] = w;
    regions[v] = region;
    return v++;
  };

  // Face cap — a fan from the centre. UVs span the card so the atlas tile lands
  // exactly inside the bevel.
  const faceCentre = push(0, 0, hz, 0, 0, 1, 0.5, 0.5, REGION_FACE);
  const faceRing = v;
  for (let i = 0; i < n; i++) {
    push(innerX[i], innerY[i], hz, 0, 0, 1, innerX[i] / width + 0.5, innerY[i] / height + 0.5, REGION_FACE);
  }
  for (let i = 0; i < n; i++) {
    indices.push(faceCentre, faceRing + i, faceRing + ((i + 1) % n));
  }

  // Back cap. Mirrored in U so the brand pattern reads correctly once the card
  // is turned over.
  const backCentre = push(0, 0, -hz, 0, 0, -1, 0.5, 0.5, REGION_BACK);
  const backRing = v;
  for (let i = 0; i < n; i++) {
    push(innerX[i], innerY[i], -hz, 0, 0, -1, 0.5 - innerX[i] / width, innerY[i] / height + 0.5, REGION_BACK);
  }
  for (let i = 0; i < n; i++) {
    indices.push(backCentre, backRing + ((i + 1) % n), backRing + i);
  }

  // Rim: front chamfer, straight side, back chamfer. Each band owns its
  // vertices so the creases stay sharp.
  const SQRT_HALF = Math.SQRT1_2;
  const bands: {
    topX: Float64Array;
    topY: Float64Array;
    topZ: number;
    botX: Float64Array;
    botY: Float64Array;
    botZ: number;
    radial: number;
    nz: number;
    v0: number;
    v1: number;
  }[] = [
    {
      topX: innerX,
      topY: innerY,
      topZ: hz,
      botX: outerX,
      botY: outerY,
      botZ: hz - b,
      radial: SQRT_HALF,
      nz: SQRT_HALF,
      v0: 0,
      v1: 0.16,
    },
    {
      topX: outerX,
      topY: outerY,
      topZ: hz - b,
      botX: outerX,
      botY: outerY,
      botZ: -hz + b,
      radial: 1,
      nz: 0,
      v0: 0.16,
      v1: 0.84,
    },
    {
      topX: outerX,
      topY: outerY,
      topZ: -hz + b,
      botX: innerX,
      botY: innerY,
      botZ: -hz,
      radial: SQRT_HALF,
      nz: -SQRT_HALF,
      v0: 0.84,
      v1: 1,
    },
  ];

  for (const band of bands) {
    const top = v;
    for (let i = 0; i < n; i++) {
      push(
        band.topX[i],
        band.topY[i],
        band.topZ,
        cosA[i] * band.radial,
        sinA[i] * band.radial,
        band.nz,
        i / n,
        band.v0,
        REGION_EDGE,
      );
    }
    const bot = v;
    for (let i = 0; i < n; i++) {
      push(
        band.botX[i],
        band.botY[i],
        band.botZ,
        cosA[i] * band.radial,
        sinA[i] * band.radial,
        band.nz,
        i / n,
        band.v1,
        REGION_EDGE,
      );
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(top + i, bot + i, bot + j);
      indices.push(top + i, bot + j, top + j);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("aRegion", new THREE.BufferAttribute(regions, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// ── Card back ───────────────────────────────────────────────────────────────

/**
 * The brand pattern, painted once and shared by all 48 cards. Deliberately
 * quiet: a dark plate, a fine diagonal weave, an inset keyline and a small
 * geometric emblem. Face-down cards form most of the board for most of the
 * game, so this has to survive being looked at for ten minutes.
 *
 * Built from `cardInk()` rather than from `surfaceAlt → surface → ink`, because
 * those three are the theme's *panel* neutrals: in the light theme they are all
 * pale, and a pale back is both invisible in a bright room and indistinguishable
 * from the face. The plate is the theme's deepest colour lifted toward its own
 * primary, which is a dark brand plate in either palette.
 */
function paintCardBack(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const deep = cardInk();
  const plate = mix(deep, palette.primary, 0.09);
  const lit = mix(deep, palette.primary, 0.19);
  // The emblem has to read on the plate whichever palette produced it, so its
  // neutral comes from `readableOn` rather than from a text colour that flips.
  const onPlate = readableOn(plate);

  const grad = ctx.createLinearGradient(0, 0, w * 0.35, h);
  grad.addColorStop(0, lit);
  grad.addColorStop(0.55, plate);
  grad.addColorStop(1, deep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fine diagonal weave — visible as a texture, never as a pattern to read.
  ctx.save();
  ctx.strokeStyle = rgba(mix(plate, palette.primary, 0.3), 0.5);
  ctx.lineWidth = Math.max(1, h * 0.004);
  const step = h / 13;
  ctx.beginPath();
  for (let x = -h; x < w + h; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(deep, 0.45);
  ctx.beginPath();
  for (let x = -h; x < w + h; x += step) {
    ctx.moveTo(x + step * 0.5, 0);
    ctx.lineTo(x + step * 0.5 - h, h);
  }
  ctx.stroke();
  ctx.restore();

  // Corner falloff so the plate reads as slightly domed under the rim light.
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.44, h * 0.1, w * 0.5, h * 0.5, h * 0.85);
  vig.addColorStop(0, rgba(deep, 0));
  vig.addColorStop(1, rgba(deep, 0.55));
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // Inset keyline.
  const inset = h * 0.075;
  ctx.strokeStyle = rgba(palette.primary, 0.42);
  ctx.lineWidth = Math.max(1, h * 0.008);
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, h * 0.06);
  ctx.stroke();

  // Emblem: two nested chevrons over a bar. Geometric, wordless, and small
  // enough that a grid of them stays calm. Both brand hues are lifted a little
  // toward the paper: the light theme's accent is a deep teal that would sink
  // into the plate at this alpha, and the lift is invisible in the dark theme.
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  const u = h * 0.01;
  const paper = cardPaper();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = u * 1.9;
  ctx.strokeStyle = rgba(mix(palette.primary, paper, 0.12), 0.75);
  ctx.beginPath();
  ctx.moveTo(-u * 9, -u * 3.5);
  ctx.lineTo(0, u * 5);
  ctx.lineTo(u * 9, -u * 3.5);
  ctx.stroke();
  ctx.lineWidth = u * 1.4;
  ctx.strokeStyle = rgba(mix(palette.accent, paper, 0.18), 0.45);
  ctx.beginPath();
  ctx.moveTo(-u * 5.2, -u * 7);
  ctx.lineTo(0, u * 0.6);
  ctx.lineTo(u * 5.2, -u * 7);
  ctx.stroke();
  ctx.fillStyle = rgba(onPlate, 0.24);
  ctx.beginPath();
  ctx.roundRect(-u * 9, u * 8, u * 18, u * 1.6, u * 0.8);
  ctx.fill();
  ctx.restore();
}

export interface CardBack {
  /** The one texture every card's back region samples. */
  texture: THREE.Texture;
  /**
   * Repaints the plate into the same canvas and the same texture object. Pass a
   * new aspect when the board resizes, omit it to repaint at the current one —
   * so neither a placement change nor a theme switch churns a GPU texture or
   * invalidates a material that already points at this one.
   */
  redraw(aspect?: number): void;
  dispose(): void;
}

export function createCardBack(aspect: number, size = 512, anisotropy = 1): CardBack {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("card: 2D canvas unavailable");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(1, Math.min(4, anisotropy));

  let ratio = aspect;

  const redraw = (next = ratio): void => {
    ratio = next;
    const w = Math.round(size * Math.max(0.5, Math.min(2, ratio)));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== size) canvas.height = size;
    paintCardBack(ctx, w, size);
    texture.needsUpdate = true;
  };

  redraw(aspect);

  return {
    texture,
    redraw,
    dispose() {
      texture.dispose();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

// ── Material ────────────────────────────────────────────────────────────────

/**
 * Uniforms shared by every card material — one object, 48 references. Every
 * theme-derived colour on a card lives here rather than on the material, so a
 * theme switch is a handful of writes instead of a walk over the deck.
 */
export interface SharedCardUniforms {
  /** The brand pattern. */
  uBack: { value: THREE.Texture };
  /** Rim light colour, set from the active environment's tint. */
  uRim: { value: THREE.Color };
  /** Miss flash colour. */
  uMiss: { value: THREE.Color };
  /** Brushed-metal albedo for the rim band. */
  uEdge: { value: THREE.Color };
  /** (rimStrength, dim, selfLit, faceScale) */
  uEnv: { value: THREE.Vector4 };
  /** Claimed-plate response, `(keep, tint)` from `claimResponse()`. */
  uClaim: { value: THREE.Vector2 };
}

const VERT_HEAD = /* glsl */ `
attribute float aRegion;
varying float vRegion;
varying vec2 vCardUv;
`;

const VERT_BODY = /* glsl */ `
vRegion = aRegion;
vCardUv = uv;
`;

const FRAG_HEAD = /* glsl */ `
varying float vRegion;
varying vec2 vCardUv;
uniform vec4 uUvRect;
uniform vec3 uSeat;
uniform vec4 uStateA; // hover, glow, claimed, sweep
uniform vec4 uStateB; // intent, miss, spare, spare
uniform sampler2D uBack;
uniform vec3 uRim;
uniform vec3 uMiss;
uniform vec3 uEdge;
uniform vec4 uEnv;   // rimStrength, dim, selfLit, faceScale
uniform vec2 uClaim; // plate luminance kept, seat tint
`;

/** Replaces `<map_fragment>`: picks the surface for this fragment's region. */
const FRAG_SURFACE = /* glsl */ `
float rFace = 1.0 - step( 0.5, vRegion );
float rBack = step( 0.5, vRegion ) * ( 1.0 - step( 1.5, vRegion ) );
float rEdge = step( 1.5, vRegion );
float claimed = uStateA.z;
float dimK = 1.0 - 0.45 * uEnv.y;

vec2 atlasUv = uUvRect.xy + clamp( vCardUv, 0.0, 1.0 ) * uUvRect.zw;

// The face is a light plate, which is what carries it against dark passthrough.
// Against a bright room that same plate blows out and the card stops reading as
// an object, so the theme's cardFaceScale (uEnv.w) drives it back here.
// Substrate and printed mark scale together: the artwork's contrast is intact.
vec3 faceCol = texture2D( map, atlasUv ).rgb * uEnv.w;
vec3 backCol = texture2D( uBack, vCardUv ).rgb;

// A claimed pair keeps its artwork — players must still be able to see who
// owns what — but loses most of its luminance and takes on the owner's hue.
//
// The hue arrives as a wash multiplied *over* the print, never as a flat
// pedestal added under it. A pedestal lifts substrate and mark by the same
// absolute amount, so as the plate darkens the two converge and the symbol
// disappears; a multiply scales both by the same factor and the artwork's own
// contrast survives untouched. Dividing the wash by its own luminance lands
// every seat on the same plate brightness (uClaim.x), so seats differ in hue
// and never in legibility — which matters most for the darkest seat colours a
// light palette owns.
vec3 claimWash = mix( vec3( 1.0 ), uSeat, uClaim.y );
float claimLum = max( 0.05, dot( claimWash, vec3( 0.2126, 0.7152, 0.0722 ) ) );
faceCol = mix( faceCol, faceCol * claimWash * ( uClaim.x / claimLum ), claimed );
// The back carries no print to protect — it is a dark plate either way — so it
// keeps the pedestal, which is what shows ownership on a card seen edge-on.
backCol = mix( backCol, mix( backCol * 0.5, uSeat * 0.16, 0.5 ), claimed );

// Brushed metal: fine circumferential grain across the card's thickness.
float grain = 0.5 + 0.5 * sin( vCardUv.y * 44.0 );
vec3 edgeCol = uEdge * ( 0.86 + 0.22 * grain );

diffuseColor.rgb = ( faceCol * rFace + backCol * rBack + edgeCol * rEdge ) * dimK;
diffuseColor.rgb *= 1.0 + 0.10 * uStateA.x;
`;

const FRAG_ROUGHNESS = /* glsl */ `
roughnessFactor = rFace * 0.33 + rBack * 0.44 + rEdge * ( 0.19 + 0.30 * grain );
roughnessFactor = mix( roughnessFactor, 0.72, claimed * ( rFace + rBack ) );
`;

const FRAG_METALNESS = /* glsl */ `
metalnessFactor = rFace * 0.04 + rBack * 0.12 + rEdge * 0.94;
`;

const FRAG_CLEARCOAT = /* glsl */ `
material.clearcoat = ( rFace * 0.60 + rBack * 0.16 ) * ( 1.0 - 0.75 * claimed );
material.clearcoatRoughness = max( 0.0525, rFace * 0.10 + rBack * 0.30 + rEdge * 0.55 );
`;

const FRAG_EMISSIVE = /* glsl */ `
vec3 vDir = normalize( vViewPosition );
float fres = pow( 1.0 - clamp( dot( normal, vDir ), 0.0, 1.0 ), 3.5 );

// Distance to the nearest card edge in UV space — the inlay used by both the
// claimed state and the AI intent outline, so the two read as one language.
float inlay = 1.0 - smoothstep( 0.030, 0.072,
  min( min( vCardUv.x, 1.0 - vCardUv.x ), min( vCardUv.y, 1.0 - vCardUv.y ) ) );
float caps = rFace + rBack;

// Rim light in the environment's own tint — the single cheapest thing that
// makes the board belong to the room instead of sitting on top of it.
totalEmissiveRadiance += uRim * fres * uEnv.x * dimK;

// A self-lit floor keeps faces readable against dark passthrough without
// blowing them out against a bright panorama.
totalEmissiveRadiance += diffuseColor.rgb * uEnv.z * caps;

// Hover: brighter, not different. No colour shift, no scale flourish here.
totalEmissiveRadiance += ( uRim * 0.30 + vec3( 0.055 ) ) * uStateA.x * ( 0.40 + fres ) * dimK;

// Specular sweep across the turning face.
float sweep = uStateA.w;
float band = 1.0 - smoothstep( 0.0, 0.17, abs( vCardUv.x - ( sweep * 1.34 - 0.17 ) ) );
float sweepEnv = sin( 3.141592 * clamp( sweep, 0.0, 1.0 ) );
totalEmissiveRadiance += vec3( 0.80, 0.86, 1.0 ) * band * sweepEnv * ( caps * 0.62 + rEdge * 0.30 ) * dimK;

// Match flourish and the permanent claimed inlay.
totalEmissiveRadiance += uSeat * uStateA.y * ( 0.50 + 0.90 * fres );
totalEmissiveRadiance += uSeat * claimed * ( inlay * 0.38 * caps + rEdge * 0.20 );

// AI intent, and the miss flash.
totalEmissiveRadiance += uSeat * uStateB.x * ( inlay * 0.62 * caps + rEdge * 0.55 + fres * 0.30 );
totalEmissiveRadiance += uMiss * uStateB.y * ( 0.30 + 0.70 * fres );
`;

interface CardUniforms {
  uUvRect: { value: THREE.Vector4 };
  uSeat: { value: THREE.Color };
  uStateA: { value: THREE.Vector4 };
  uStateB: { value: THREE.Vector4 };
}

function createCardMaterial(
  atlas: THREE.Texture,
  shared: SharedCardUniforms,
): { material: THREE.MeshPhysicalMaterial; uniforms: CardUniforms } {
  const uniforms: CardUniforms = {
    uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uSeat: { value: new THREE.Color(hex(palette.primary)) },
    uStateA: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStateB: { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  const material = new THREE.MeshPhysicalMaterial({
    // No base colour: every region substitutes its own in the shader, and the
    // edge reads `uEdge` so a theme switch is one write instead of 48.
    map: atlas,
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.0,
  });
  material.emissive = new THREE.Color(0x000000);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uUvRect = uniforms.uUvRect;
    shader.uniforms.uSeat = uniforms.uSeat;
    shader.uniforms.uStateA = uniforms.uStateA;
    shader.uniforms.uStateB = uniforms.uStateB;
    shader.uniforms.uBack = shared.uBack;
    shader.uniforms.uRim = shared.uRim;
    shader.uniforms.uMiss = shared.uMiss;
    shader.uniforms.uEdge = shared.uEdge;
    shader.uniforms.uEnv = shared.uEnv;
    shader.uniforms.uClaim = shared.uClaim;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <map_fragment>", FRAG_SURFACE)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAG_ROUGHNESS}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${FRAG_METALNESS}`)
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>\n${FRAG_CLEARCOAT}`,
      )
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };

  // Every card compiles to the same program; only the uniforms differ.
  material.customProgramCacheKey = () => "vrent-card-v3";

  return { material, uniforms };
}

// ── Shared resources ────────────────────────────────────────────────────────

export interface CardMetrics {
  width: number;
  height: number;
  thickness: number;
  /** Hover rise toward the player, metres. */
  hoverLift: number;
  /** Peak rise during the flip. */
  flipLift: number;
  /** Peak rise during the match flourish. */
  matchLift: number;
  /** How far a claimed card recedes behind the play plane. */
  claimSink: number;
  /** Lateral amplitude of the miss shake. */
  shakeAmp: number;
}

export interface CardResources {
  geometry: THREE.BufferGeometry;
  atlas: SymbolAtlas;
  back: CardBack;
  shared: SharedCardUniforms;
  metrics: CardMetrics;
  /**
   * How hard the cards answer the room: `rimStrength` 0-1.5, `selfLit` 0-0.5.
   * Both are pre-theme figures describing the *environment* — the theme's
   * `rimScale` and `cardFaceScale` are folded in here and re-folded on a theme
   * change, so no caller ever has to know they exist.
   */
  setEnvResponse(rimStrength: number, selfLit: number): void;
  dispose(): void;
}

export interface CardResourceOptions {
  anisotropy?: number;
  /** Environment tint, drives the rim light. */
  rim?: THREE.ColorRepresentation;
  /** Rim strength, 0-1.5. Passthrough wants more than a lit room. */
  rimStrength?: number;
  /** Self-illumination floor, 0-0.5. Raise for dark passthrough. */
  selfLit?: number;
}

export function createCardResources(
  layout: BoardLayout,
  atlas: SymbolAtlas,
  options: CardResourceOptions = {},
): CardResources {
  const geometry = buildCardGeometry(
    layout.cardWidth,
    layout.cardHeight,
    layout.cardThickness,
    layout.cornerRadius,
    layout.bevel,
  );

  const back = createCardBack(
    layout.cardWidth / layout.cardHeight,
    512,
    options.anisotropy ?? 1,
  );

  const shared: SharedCardUniforms = {
    uBack: { value: back.texture },
    uRim: { value: new THREE.Color(options.rim ?? hex(palette.accent)) },
    uMiss: { value: new THREE.Color(hex(palette.danger)) },
    uEdge: { value: new THREE.Color(hex(cardEdge())) },
    uEnv: { value: new THREE.Vector4(0, 0, 0, 1) },
    // Filled by `applyClaimResponse` below, so the tokens have one home.
    uClaim: { value: new THREE.Vector2() },
  };

  // Kept so a theme change can re-apply the theme multipliers to whatever the
  // environment last asked for.
  let baseRim = options.rimStrength ?? 0.55;
  let baseSelfLit = options.selfLit ?? 0.1;

  const setEnvResponse = (rimStrength: number, selfLit: number): void => {
    baseRim = rimStrength;
    baseSelfLit = selfLit;
    const env = shared.uEnv.value;
    env.x = baseRim * scene.rimScale;
    env.z = baseSelfLit;
    env.w = scene.cardFaceScale;
  };

  /**
   * Purely theme-driven, unlike `setEnvResponse` — but it reads the same
   * `cardFaceScale` that lands in `uEnv.w`, so the two are always re-applied
   * together and a claimed plate can never be dimmed by a stale face scale.
   */
  const applyClaimResponse = (): void => {
    const claim = claimResponse();
    shared.uClaim.value.set(claim.keep, claim.tint);
  };

  setEnvResponse(baseRim, baseSelfLit);
  applyClaimResponse();

  // The back is a canvas texture and the tints are parsed colours: all derived,
  // all stale after a switch. Repainting and rewriting them leaves geometry,
  // materials and every card's animation state exactly where they were.
  const offTheme = onThemeChange(() => {
    back.redraw();
    shared.uMiss.value.setHex(hex(palette.danger));
    shared.uEdge.value.setHex(hex(cardEdge()));
    setEnvResponse(baseRim, baseSelfLit);
    applyClaimResponse();
  });

  const metrics: CardMetrics = {
    width: layout.cardWidth,
    height: layout.cardHeight,
    thickness: layout.cardThickness,
    // 8mm on the big board, proportionally less on a desk-sized one.
    hoverLift: Math.min(0.008, layout.cardHeight * 0.11),
    flipLift: layout.cardHeight * 0.055,
    matchLift: layout.cardHeight * 0.19,
    claimSink: layout.cardThickness * 1.1,
    shakeAmp: layout.cardWidth * 0.05,
  };

  return {
    geometry,
    atlas,
    back,
    shared,
    metrics,
    setEnvResponse,
    dispose() {
      offTheme();
      geometry.dispose();
      back.dispose();
    },
  };
}

// ── Card ────────────────────────────────────────────────────────────────────

export interface CardView {
  readonly index: number;
  /** Positioned by the layout; the card animates inside it. */
  readonly pivot: THREE.Group;
  readonly mesh: THREE.Mesh;

  setSymbol(symbol: number): void;
  /** `animate: false` snaps — used when the animation budget is spent. */
  setFaceUp(up: boolean, animate?: boolean): void;
  faceUp(): boolean;
  matched(): boolean;
  /** True while anything other than hover is in flight. */
  busy(): boolean;

  setHover(on: boolean): void;
  hovered(): boolean;
  /** `animate: false` lands straight in the claimed state, for state restore. */
  markMatched(seat: THREE.Color, animate?: boolean): void;
  /**
   * Re-tints the owner colour without touching pose or animation state. Seat
   * colours are parsed from the palette, so a theme switch has to push the new
   * ones into every claimed card — mid-flourish included.
   */
  setSeatColor(seat: THREE.Color): void;
  markMissed(): void;
  setIntent(on: boolean, seat: THREE.Color): void;
  /** Back to a fresh, face-down, unclaimed card. */
  reset(): void;

  update(dt: number, now: number): void;
  dispose(): void;
}

export function createCard(res: CardResources, index: number): CardView {
  const { material, uniforms } = createCardMaterial(res.atlas.texture, res.shared);

  const mesh = new THREE.Mesh(res.geometry, material);
  mesh.matrixAutoUpdate = true;
  mesh.frustumCulled = false; // the board is one cluster; per-card culling costs more than it saves
  mesh.renderOrder = 0;

  const pivot = new THREE.Group();
  pivot.add(mesh);

  const m = res.metrics;
  const stateA = uniforms.uStateA.value;
  const stateB = uniforms.uStateB.value;

  // Face-down is a half turn: the geometry's face points at +Z.
  let flipValue = 0; // 0 = down, 1 = up
  let flipFrom = 0;
  let flipTarget = 0;
  let flipElapsed = -1;
  let flipDuration: number = FLIP_MS;

  let hoverTarget = 0;
  let hoverValue = 0;

  let intentTarget = 0;
  let intentValue = 0;

  let matchElapsed = -1;
  let isMatched = false;
  let claimValue = 0;

  let missElapsed = -1;

  const applyStatic = (): void => {
    mesh.rotation.y = Math.PI * (1 - flipValue);
    mesh.position.set(0, 0, isMatched ? -m.claimSink : 0);
    mesh.scale.setScalar(isMatched ? 0.88 : 1);
    stateA.set(hoverValue, 0, claimValue, 0);
    stateB.set(0, 0, 0, 0);
  };

  applyStatic();

  const view: CardView = {
    index,
    pivot,
    mesh,

    setSymbol(symbol) {
      res.atlas.writeUvRect(symbol, uniforms.uUvRect.value);
    },

    setFaceUp(up, animate = true) {
      const target = up ? 1 : 0;
      // Already there, or already on the way there. Re-issuing a flip must not
      // restart it — that would show as a hitch mid-turn.
      if (target === flipTarget && (flipElapsed >= 0 || flipValue === target)) return;
      flipTarget = target;
      if (!animate) {
        flipValue = target;
        flipFrom = target;
        flipElapsed = -1;
        applyStatic();
        return;
      }
      flipFrom = flipValue;
      flipElapsed = 0;
      // A partial flip finishes in proportionally less time, so interrupting
      // never produces a slow-motion turn.
      flipDuration = Math.max(FLIP_MS * 0.45, FLIP_MS * Math.abs(target - flipFrom));
    },

    faceUp() {
      return flipTarget === 1;
    },

    matched() {
      return isMatched;
    },

    busy() {
      return flipElapsed >= 0 || matchElapsed >= 0 || missElapsed >= 0;
    },

    setHover(on) {
      hoverTarget = on ? 1 : 0;
    },

    hovered() {
      return hoverTarget === 1;
    },

    markMatched(seat, animate = true) {
      uniforms.uSeat.value.copy(seat);
      isMatched = true;
      hoverTarget = 0;
      intentTarget = 0;
      intentValue = 0;
      if (animate) {
        matchElapsed = 0;
        return;
      }
      // Restoring a match already in the state (rejoin, placement change):
      // land in the claimed pose without replaying the flourish.
      matchElapsed = -1;
      claimValue = 1;
      hoverValue = 0;
      flipValue = 1;
      flipFrom = 1;
      flipTarget = 1;
      flipElapsed = -1;
      applyStatic();
    },

    setSeatColor(seat) {
      uniforms.uSeat.value.copy(seat);
    },

    markMissed() {
      missElapsed = 0;
    },

    setIntent(on, seat) {
      if (isMatched) return;
      if (on) uniforms.uSeat.value.copy(seat);
      intentTarget = on ? 1 : 0;
    },

    reset() {
      flipValue = 0;
      flipFrom = 0;
      flipTarget = 0;
      flipElapsed = -1;
      hoverTarget = 0;
      hoverValue = 0;
      intentTarget = 0;
      intentValue = 0;
      matchElapsed = -1;
      missElapsed = -1;
      isMatched = false;
      claimValue = 0;
      uniforms.uSeat.value.setHex(hex(palette.primary));
      applyStatic();
    },

    update(dt, now) {
      // Exponential smoothing — frame-rate independent, no springs to ring.
      hoverValue += (hoverTarget - hoverValue) * (1 - Math.exp(-dt / HOVER_TAU));
      intentValue += (intentTarget - intentValue) * (1 - Math.exp(-dt / INTENT_TAU));

      let z = 0;
      let x = 0;
      let scale = 1;
      let glow = 0;
      let sweep = 0;
      let miss = 0;

      // Hover: rise toward the player and grow a hair. Nothing else.
      z += m.hoverLift * hoverValue;
      scale += 0.012 * hoverValue;

      if (flipElapsed >= 0) {
        flipElapsed += dt * 1000;
        const tr = Math.min(1, flipElapsed / flipDuration);
        flipValue = flipFrom + (flipTarget - flipFrom) * EASE_FLIP(tr);

        // The lift runs long so the card sets down after the turn completes.
        const tl = Math.min(1, flipElapsed / (flipDuration * (FLIP_LIFT_MS / FLIP_MS)));
        const bell = Math.pow(Math.sin(Math.PI * Math.pow(tl, 0.7)), 1.3);
        z += m.flipLift * bell;
        scale += 0.030 * bell;
        sweep = tr;

        if (tr >= 1 && tl >= 1) {
          flipValue = flipTarget;
          flipFrom = flipTarget;
          flipElapsed = -1;
        }
      }

      if (matchElapsed >= 0) {
        matchElapsed += dt * 1000;
        const t = Math.min(1, matchElapsed / MATCH_MS);
        if (t < 0.42) {
          // Rise and take the scorer's colour.
          const k = EASE_OUT(t / 0.42);
          z += m.matchLift * k;
          scale += 0.05 * k;
          glow = k;
          claimValue = 0;
        } else {
          // Settle behind the play plane and go quiet.
          const k = EASE_SETTLE((t - 0.42) / 0.58);
          z += m.matchLift * (1 - k) - m.claimSink * k;
          scale += 0.05 * (1 - k) - 0.12 * k;
          glow = (1 - k) * (1 - k);
          claimValue = k;
        }
        if (t >= 1) {
          matchElapsed = -1;
          claimValue = 1;
          glow = 0;
        }
      } else if (isMatched) {
        z -= m.claimSink;
        scale -= 0.12;
        claimValue = 1;
      }

      if (missElapsed >= 0) {
        missElapsed += dt * 1000;
        const t = Math.min(1, missElapsed / MISS_MS);
        const decay = (1 - t) * (1 - t);
        x = m.shakeAmp * Math.sin(t * Math.PI * 2 * 3.2) * decay;
        miss = decay * 0.85;
        if (t >= 1) missElapsed = -1;
      }

      const pulse = intentValue > 0.001
        ? 0.42 + 0.58 * (0.5 + 0.5 * Math.sin((now / 1000) * (Math.PI * 2) / INTENT_PERIOD))
        : 0;

      mesh.rotation.y = Math.PI * (1 - flipValue);
      mesh.position.set(x, 0, z);
      mesh.scale.setScalar(scale);
      stateA.set(hoverValue, glow, claimValue, sweep);
      stateB.set(intentValue * pulse, miss, 0, 0);
    },

    dispose() {
      material.dispose();
      pivot.remove(mesh);
    },
  };

  return view;
}
