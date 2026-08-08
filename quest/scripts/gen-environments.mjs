#!/usr/bin/env node
/**
 * Generates the three shipped placeholder 360 panoramas.
 *
 *   npm run environments
 *
 * Output (into `public/environments/`, one JPG per `kind: "panorama"` entry in
 * `shared/environments.ts`):
 *
 *   showroom.jpg   a lit gallery: ring of display bays, polished floor
 *   alpine.jpg     an open terrace with a parapet, ridgelines and a low sun
 *   atelier.jpg    a warm studio interior with a north window and wood floor
 *
 * These are placeholders. A customer replaces them with their own 360
 * photography and changes nothing else — see `public/environments/README.md`.
 *
 * HOW THEY ARE MADE
 * Each pixel of a 2:1 equirectangular image is one view direction: longitude
 * runs -PI..PI across the width, latitude +PI/2..-PI/2 down the height. So
 * rather than painting a flat picture and hoping it wraps, this script casts
 * the actual ray for every pixel and intersects it with a few analytic
 * surfaces (a cylinder, a box, ground planes). The geometry is therefore
 * correct by construction: the horizon is straight, verticals stay vertical,
 * and the left and right edges join seamlessly because every term is a
 * continuous, 2*PI-periodic function of longitude.
 *
 * Scene colours are derived from the palette in `shared/brand.ts` and from
 * each environment's own `tint` in `shared/environments.ts`, so a re-skin
 * carries through to the panoramas.
 *
 * Env vars:
 *   PANO_WIDTH   output width in pixels, height is always half (default 4096).
 *                Use e.g. 1024 for a fast look while art-directing.
 *   PANO_QUALITY JPEG quality (default 82).
 *
 * This file is plain ESM run directly by Node, never bundled, so it cannot
 * import the TypeScript sources; it parses the literals it needs instead.
 */

import { mkdir } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEST = path.resolve(HERE, "..");
const OUT_DIR = path.join(QUEST, "public", "environments");

const WIDTH = Math.max(256, Number(process.env.PANO_WIDTH ?? 4096) | 0);
const HEIGHT = WIDTH >> 1;
const QUALITY = Math.min(100, Math.max(1, Number(process.env.PANO_QUALITY ?? 82) | 0));

/* ── reading the source of truth ─────────────────────────────────────────── */

function balancedObject(src, from) {
  const start = src.indexOf("{", from);
  if (start < 0) throw new Error(`no object literal after offset ${from}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return { text: src.slice(start, i + 1), end: i + 1 };
  }
  throw new Error("unbalanced object literal");
}

function objectAfter(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${what} — has the source moved?`);
  return balancedObject(src, m.index + m[0].length).text;
}

function strField(block, key, what) {
  const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(block);
  if (!m) throw new Error(`could not read "${key}" from ${what}`);
  return m[1];
}

function numField(block, key, fallback) {
  const m = new RegExp(`\\b${key}\\s*:\\s*(-?[\\d.]+)`).exec(block);
  return m ? Number(m[1]) : fallback;
}

const brandSrc = readFileSync(path.join(QUEST, "shared", "brand.ts"), "utf8");
const envSrc = readFileSync(path.join(QUEST, "shared", "environments.ts"), "utf8");

const paletteBlock = objectAfter(
  brandSrc,
  /export const palette\s*:\s*Palette\s*=\s*/,
  "`palette` in shared/brand.ts",
);
const pal = Object.fromEntries(
  ["ink", "surface", "surfaceAlt", "primary", "accent", "reward", "danger"].map((k) => [
    k,
    strField(paletteBlock, k, "palette"),
  ]),
);

/** Every `kind: "panorama"` entry in the catalogue, in declaration order. */
function readPanoramaEntries() {
  const m = /export const ENVIRONMENTS\s*:[^=]*=\s*\[/.exec(envSrc);
  if (!m) throw new Error("could not find ENVIRONMENTS in shared/environments.ts");
  const entries = [];
  let cursor = m.index + m[0].length;
  const end = envSrc.indexOf("\n];", cursor);
  while (cursor < end) {
    const open = envSrc.indexOf("{", cursor);
    if (open < 0 || open > end) break;
    const obj = balancedObject(envSrc, cursor);
    cursor = obj.end;
    if (!/kind\s*:\s*"panorama"/.test(obj.text)) continue;
    const rel = strField(obj.text, "panorama", "panorama entry");
    entries.push({
      id: strField(obj.text, "id", "panorama entry"),
      name: strField(obj.text, "name", "panorama entry"),
      file: path.basename(rel),
      tint: strField(obj.text, "tint", "panorama entry"),
      ambient: numField(obj.text, "ambient", 1),
      key: numField(obj.text, "key", 1),
    });
  }
  return entries;
}

/* ── colour helpers (float RGB triples, 0..1, linear-ish sRGB values) ────── */

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const blend = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];

const set3 = (o, c) => {
  o[0] = c[0];
  o[1] = c[1];
  o[2] = c[2];
};
/** Move the working colour a fraction `t` toward `c`. */
const toward3 = (o, c, t) => {
  o[0] += (c[0] - o[0]) * t;
  o[1] += (c[1] - o[1]) * t;
  o[2] += (c[2] - o[2]) * t;
};
/** Additive light. */
const add3 = (o, c, k) => {
  o[0] += c[0] * k;
  o[1] += c[1] * k;
  o[2] += c[2] * k;
};
const mul3 = (o, k) => {
  o[0] *= k;
  o[1] *= k;
  o[2] *= k;
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** 1 inside [a,b] with `f`-wide feathered edges, 0 outside. */
const band = (x, a, b, f) => smoothstep(a - f, a + f, x) * (1 - smoothstep(b - f, b + f, x));

/* ── deterministic value noise, periodic along longitude ─────────────────── */

function hash2(i, j) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/**
 * Smooth value noise. `u` is wrapped on an integer lattice of `period`
 * columns, which is what keeps the seam at longitude +/-PI invisible.
 */
function vnoise(u, v, period, seed) {
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a0 = ((i0 % period) + period) % period;
  const a1 = (a0 + 1) % period;
  const p00 = hash2(a0 + seed, j0);
  const p10 = hash2(a1 + seed, j0);
  const p01 = hash2(a0 + seed, j0 + 1);
  const p11 = hash2(a1 + seed, j0 + 1);
  const top = p00 + (p10 - p00) * su;
  const bot = p01 + (p11 - p01) * su;
  return top + (bot - top) * sv;
}

/** Fractal sum of `vnoise`; each octave doubles the lattice, so it still wraps. */
function fbm(u01, v, basePeriod, octaves, seed) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = basePeriod << o;
    sum += amp * vnoise(u01 * p, v * (1 << o), p, seed + o * 131);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Ridged fractal: folding the noise about its midpoint turns rolling hills
 * into creased peaks, which is what makes a skyline read as mountains rather
 * than as dunes. Returns roughly 0..1 with a mean near 0.35.
 */
function ridged(u01, v, basePeriod, octaves, seed) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = basePeriod << o;
    const n = vnoise(u01 * p, v * (1 << o), p, seed + o * 271);
    const crease = 1 - Math.abs(2 * n - 1);
    sum += amp * crease * crease;
    norm += amp;
    amp *= 0.52;
  }
  return sum / norm;
}

const TAU = Math.PI * 2;
const INV_TAU = 1 / TAU;

/* ── scene 1: showroom ───────────────────────────────────────────────────── */
/*
 * A cylindrical gallery: 16 bays of recessed display panels lit by vertical
 * strips, every fourth bay a backlit niche, a cove light where the wall meets
 * the ceiling, a ring of downlights and a polished floor that reflects the
 * bays back at the viewer.
 */
function makeShowroom(theme) {
  const R = 3.9; // wall radius: close enough that the bays fill the view
  const FLOOR = -1.45;
  const CEIL = 2.3;
  const BAYS = 12;
  const FEATURE = BAYS / 2; // the bay straight ahead at longitude 0
  const SPAN = CEIL - FLOOR;

  const tint = rgbOf(theme.tint);
  const wallDark = blend(rgbOf(pal.surface), rgbOf(pal.surfaceAlt), 0.5);
  const wallLite = blend(blend(rgbOf(pal.surfaceAlt), WHITE, 0.22), tint, 0.08);
  const wainscot = blend(blend(rgbOf(pal.surface), rgbOf(pal.surfaceAlt), 0.7), tint, 0.05);
  const panelDark = blend(rgbOf(pal.ink), rgbOf(pal.surface), 0.7);
  const nicheGlow = blend(tint, WHITE, 0.35);
  const strip = blend(tint, WHITE, 0.55);
  const floorBase = blend(rgbOf(pal.ink), rgbOf(pal.surface), 0.55);
  const ceilBase = blend(rgbOf(pal.ink), rgbOf(pal.surface), 0.3);
  const downlight = blend(WHITE, tint, 0.22);

  const scratch = new Float64Array(3);
  const AMB = 0.75 + 0.25 * clamp01(theme.ambient);

  /** Shade the cylindrical wall for a direction; used directly and mirrored. */
  function wall(out, hyp, dy, lon) {
    const y = (R / hyp) * dy;
    const v = clamp01((y - FLOOR) / SPAN);
    const b = (lon + Math.PI) * INV_TAU * BAYS;
    const bi = Math.floor(b);
    const u = b - bi;

    // Base plaster, lifting from the skirting toward the cove.
    set3(out, wallDark);
    toward3(out, wallLite, smoothstep(0.05, 0.9, v) * 0.9);

    // Wainscot: a solid band around the bottom with a bright capping reveal.
    const low = 1 - smoothstep(0.28, 0.3, v);
    toward3(out, wainscot, low * 0.85);
    add3(out, strip, 0.4 * Math.exp(-Math.pow((v - 0.295) / 0.008, 2)));

    if (bi === FEATURE) {
      // Feature bay: a full-height lightbox, the room's focal point.
      const lit = band(u, 0.1, 0.9, 0.02) * band(v, 0.33, 0.9, 0.015);
      if (lit > 0.002) {
        set3(scratch, blend(tint, WHITE, 0.55));
        mul3(scratch, 0.55 + 0.4 * smoothstep(0.3, 0.95, v));
        // Two thin reveals break up the panel.
        mul3(scratch, 1 - 0.45 * Math.exp(-Math.pow((v - 0.55) / 0.006, 2)));
        mul3(scratch, 1 - 0.45 * Math.exp(-Math.pow((v - 0.75) / 0.006, 2)));
        toward3(out, scratch, lit * 0.96);
      }
    } else {
      // Recessed display panel, subtly different per bay.
      const panel = band(u, 0.18, 0.82, 0.015) * band(v, 0.34, 0.86, 0.012);
      if (panel > 0.002) {
        const isNiche = bi % 3 === 0;
        set3(scratch, panelDark);
        if (isNiche) {
          // Backlit display case: bright at the top, falling off downward.
          add3(scratch, nicheGlow, 0.12 + 0.5 * smoothstep(0.3, 0.95, v));
        } else {
          mul3(scratch, 0.8 + 0.45 * hash2(bi, 7));
        }
        toward3(out, scratch, panel * 0.94);
        // Bright reveal along the panel's top and bottom edges.
        add3(out, strip, panel * 0.55 * Math.exp(-Math.pow((v - 0.855) / 0.009, 2)));
        add3(out, strip, panel * 0.3 * Math.exp(-Math.pow((v - 0.345) / 0.007, 2)));
      }
    }

    // Vertical light strips in the seams between bays.
    const d = Math.min(u, 1 - u);
    add3(out, strip, Math.exp(-Math.pow(d / 0.02, 2)) * band(v, 0.3, 0.93, 0.04) * 1.05);

    // Cove light along the top of the wall, floor bounce along the bottom,
    // and a dark shadow line where the wall meets the floor.
    add3(out, downlight, 0.75 * Math.exp(-Math.pow((v - 0.99) / 0.035, 2)));
    add3(out, downlight, 0.1 * (1 - smoothstep(0.0, 0.22, v)));
    mul3(out, 1 - 0.5 * (1 - smoothstep(0.0, 0.03, v)));
    mul3(out, AMB);
  }

  return function showroom(out, dx, dy, dz, lon, _lat, hyp) {
    const tWall = R / hyp;
    const tCeil = dy > 1e-6 ? CEIL / dy : Infinity;
    const tFloor = dy < -1e-6 ? FLOOR / dy : Infinity;

    if (tCeil < tWall) {
      // Ceiling: a luminous coffered light panel, radial ribs, a lamp ring.
      const r = tCeil * hyp;
      const px = tCeil * dx;
      const pz = tCeil * dz;
      set3(out, ceilBase);
      const coffer = 1 - smoothstep(1.52, 1.66, r);
      if (coffer > 0.002) {
        set3(scratch, blend(downlight, WHITE, 0.4));
        mul3(scratch, 0.95 - 0.22 * smoothstep(0.0, 1.7, r));
        // Lattice of coffer panels inside the light field.
        const gx = Math.abs(px / 0.52 - Math.round(px / 0.52));
        const gz = Math.abs(pz / 0.52 - Math.round(pz / 0.52));
        mul3(scratch, 1 - 0.5 * (1 - smoothstep(0.035, 0.075, Math.min(gx, gz))));
        toward3(out, scratch, coffer);
      }
      add3(out, strip, 0.5 * Math.exp(-Math.pow((r - 1.7) / 0.04, 2)));
      const rib = Math.pow(0.5 + 0.5 * Math.cos(lon * BAYS), 16);
      add3(out, downlight, 0.14 * rib * smoothstep(1.7, 2.1, r));
      const lampRing = Math.exp(-Math.pow((r - 2.75) / 0.12, 2));
      const lamps = Math.pow(0.5 + 0.5 * Math.cos(lon * BAYS + Math.PI / BAYS), 22);
      add3(out, downlight, 1.2 * lampRing * lamps);
      mul3(out, AMB * (0.72 + 0.28 * smoothstep(4.2, 1.6, r)));
      return;
    }

    if (tFloor < tWall) {
      // Polished stone floor: a tile grid, inlay rings under the viewer and a
      // mirror image of the bays, strongest at grazing angles near the walls.
      const r = tFloor * hyp;
      const px = tFloor * dx;
      const pz = tFloor * dz;
      set3(out, floorBase);
      // Large slabs with tonal variation and fine joints.
      const cx = Math.round(px / 1.15);
      const cz = Math.round(pz / 1.15);
      mul3(out, 0.85 + 0.4 * hash2(cx, cz));
      const jx = Math.abs(px / 1.15 - cx);
      const jz = Math.abs(pz / 1.15 - cz);
      mul3(out, 1 - 0.45 * (1 - smoothstep(0.012, 0.03, Math.min(jx, jz))));
      add3(out, downlight, 0.13 * Math.exp(-Math.pow(r / 2.2, 2)));
      // Inlay rings, deliberately low contrast.
      add3(out, strip, 0.34 * Math.exp(-Math.pow((r - 2.35) / 0.018, 2)));
      add3(out, strip, 0.18 * Math.exp(-Math.pow((r - 1.1) / 0.014, 2)));
      wall(scratch, hyp, -dy, lon);
      add3(out, scratch, (0.1 + 0.55 * smoothstep(0.8, 3.4, r)) * 0.6);
      // Contact shadow immediately under the viewer.
      mul3(out, 0.62 + 0.38 * smoothstep(0.15, 1.3, r));
      return;
    }

    wall(out, hyp, dy, lon);
  };
}

/* ── scene 2: alpine ─────────────────────────────────────────────────────── */
/*
 * An open terrace: three ridgelines under a graded sky with a low sun and
 * banded cloud, a stone parapet ringing the viewpoint, and a paved deck.
 */
function makeAlpine(theme) {
  const EYE = 1.6; // metres above the deck
  const PARAPET_R = 2.7;
  const PARAPET_IN = 2.52;
  const PARAPET_TOP = -0.55; // relative to the eye

  const tint = rgbOf(theme.tint);
  const zenith = blend(rgbOf(pal.primary), rgbOf(pal.ink), 0.66);
  const skyMid = blend(rgbOf(pal.primary), tint, 0.55);
  const haze = blend(tint, WHITE, 0.42);
  const sunCol = [1, 0.96, 0.86];
  const rockDark = blend(rgbOf(pal.surfaceAlt), BLACK, 0.42);
  const snow = blend(WHITE, tint, 0.12);
  const stone = blend(rgbOf(pal.surfaceAlt), WHITE, 0.66);
  const stoneWarm = blend(stone, rgbOf(pal.reward), 0.07);
  const cloudLit = blend(WHITE, rgbOf(pal.reward), 0.1);

  const SUN_LON = 1.05;
  const SUN_LAT = 0.24;
  const sunX = Math.cos(SUN_LAT) * Math.sin(SUN_LON);
  const sunY = Math.sin(SUN_LAT);
  const sunZ = Math.cos(SUN_LAT) * Math.cos(SUN_LON);

  // Three ridgelines, each a periodic elevation profile in radians. The far
  // range carries the peaks; the nearer ones are foothills in front of it.
  const ridgeFar = (u01) => 0.05 + 0.54 * ridged(u01, 0.5, 3, 4, 11);
  const ridgeMid = (u01) => 0.03 + 0.24 * ridged(u01, 2.5, 5, 3, 907);
  const ridgeNear = (u01) => 0.012 + 0.1 * ridged(u01, 4.5, 8, 3, 4211);

  function shadeRidge(out, lat, lon, u01, ridge, hazeAmt, seed) {
    const s = clamp01(lat / Math.max(ridge, 1e-4));
    set3(out, rockDark);
    // Sunlit flank versus shaded flank.
    mul3(out, 0.7 + 0.42 * clamp01(0.5 + 0.5 * Math.cos(lon - SUN_LON)));
    // Gullies: fine vertical striation, fading out under snow.
    mul3(out, 1 + 0.07 * Math.sin(u01 * TAU * 70 + seed) * (1 - s * 0.5));
    mul3(out, 1 + 0.05 * Math.sin(u01 * TAU * 23 + seed * 3));
    // Snow above the snowline, only on peaks that reach it.
    const snowAmt = smoothstep(0.42, 0.85, s) * smoothstep(0.1, 0.2, ridge);
    toward3(out, snow, snowAmt * 0.92);
    // A tree line hugging the bottom of the nearest ridges.
    toward3(out, blend(rockDark, BLACK, 0.35), (1 - smoothstep(0.02, 0.2, s)) * (1 - hazeAmt) * 0.5);
    // Aerial perspective: distant layers wash out into the haze.
    toward3(out, haze, hazeAmt);
    // Bases dissolve into the horizon haze.
    toward3(out, haze, 0.75 * (1 - smoothstep(0.0, 0.035, lat)));
  }

  const scratch = new Float64Array(3);

  return function alpine(out, dx, dy, dz, lon, lat, hyp) {
    const u01 = (lon + Math.PI) * INV_TAU;

    if (lat >= 0) {
      // ── sky ──────────────────────────────────────────────────────────
      set3(out, haze);
      toward3(out, skyMid, smoothstep(0.0, 0.42, lat));
      toward3(out, zenith, smoothstep(0.22, 1.25, lat));

      const dot = dx * sunX + dy * sunY + dz * sunZ;
      const d2 = 2 * (1 - dot); // squared angular distance, cheaply
      add3(out, sunCol, 0.55 * Math.exp(-d2 * 26) + 0.16 * Math.exp(-d2 * 2.4));
      if (d2 < 0.00035) set3(out, [1, 0.99, 0.94]);

      // Banded cloud, thinning toward the zenith and lit from the sun side.
      if (lat > 0.02) {
        const n = fbm(u01, lat * 3.1 + 1.7, 6, 4, 313);
        const deck = smoothstep(0.06, 0.3, lat) * (1 - smoothstep(0.55, 1.15, lat));
        const cover = smoothstep(0.52, 0.78, n) * deck;
        if (cover > 0.002) {
          set3(scratch, cloudLit);
          mul3(scratch, 0.8 + 0.3 * clamp01(0.5 + 0.5 * Math.cos(lon - SUN_LON)));
          toward3(out, scratch, cover * 0.8);
        }
      }

      // ── ridgelines, nearest first ────────────────────────────────────
      const rn = ridgeNear(u01);
      if (lat < rn) {
        shadeRidge(out, lat, lon, u01, rn, 0.18, 5.0);
        return;
      }
      const rm = ridgeMid(u01);
      if (lat < rm) {
        shadeRidge(out, lat, lon, u01, rm, 0.42, 2.0);
        return;
      }
      const rf = ridgeFar(u01);
      if (lat < rf) {
        shadeRidge(out, lat, lon, u01, rf, 0.66, 0.0);
      }
      return;
    }

    // ── below the horizon: parapet and deck ────────────────────────────
    // Along the ray, radius grows as height falls: y = -k * r.
    const k = -dy / hyp;
    const rFloor = EYE / k;

    if (rFloor <= PARAPET_IN) {
      // Paved deck. Square pavers, a joint grid, and a soft contact shadow.
      const t = -EYE / dy;
      const px = t * dx;
      const pz = t * dz;
      const gx = px / 0.62;
      const gz = pz / 0.62;
      const cx = Math.round(gx);
      const cz = Math.round(gz);
      set3(out, stone);
      mul3(out, 0.92 + 0.16 * hash2(cx, cz));
      mul3(out, 1 - 0.22 * (1 - smoothstep(0.014, 0.04, Math.min(Math.abs(gx - cx), Math.abs(gz - cz)))));
      // The parapet keeps direct sun off the deck, so it stays cool and even.
      mul3(out, 0.72 + 0.1 * clamp01(0.5 + 0.5 * Math.cos(Math.atan2(px, pz) - SUN_LON)));
      mul3(out, 0.72 + 0.28 * smoothstep(0.2, 1.9, rFloor));
      return;
    }

    const yInner = -k * PARAPET_IN;
    if (yInner < PARAPET_TOP) {
      // Inner face of the parapet: in shadow, with a warm bounce at its foot.
      const v = clamp01((yInner + EYE) / (EYE + PARAPET_TOP));
      set3(out, stoneWarm);
      mul3(out, 0.5 + 0.28 * v);
      // A course line halfway up reads as masonry rather than a blank band.
      mul3(out, 1 - 0.18 * Math.exp(-Math.pow((v - 0.52) / 0.02, 2)));
      add3(out, stone, 0.12 * (1 - smoothstep(0.0, 0.25, v)));
      return;
    }

    const rTop = -PARAPET_TOP / k;
    if (rTop <= PARAPET_R) {
      // Sunlit coping stones on top of the parapet.
      const across = (rTop - PARAPET_IN) / (PARAPET_R - PARAPET_IN);
      set3(out, stone);
      mul3(out, 1.1 + 0.14 * clamp01(0.5 + 0.5 * Math.cos(lon - SUN_LON)));
      // Joints between coping stones, every ~0.55 m around the ring.
      const seam = ((lon * PARAPET_R) / 0.55 + 1000) % 1;
      mul3(out, 1 - 0.32 * (1 - smoothstep(0.02, 0.06, Math.min(seam, 1 - seam))));
      mul3(out, 1 - 0.28 * smoothstep(0.7, 1.0, across));
      return;
    }

    // Beyond the parapet the ground falls away into the valley: layered haze
    // with the suggestion of forested slopes far below.
    const depth = smoothstep(0.0, -0.42, lat);
    set3(out, haze);
    toward3(out, blend(rockDark, haze, 0.4), depth * 0.8);
    mul3(out, 1 + 0.05 * Math.sin(u01 * TAU * 17 + lat * 40) * depth);
    mul3(out, 1 - 0.2 * depth);
  };
}

/* ── scene 3: atelier ────────────────────────────────────────────────────── */
/*
 * A warm studio: box room, plank floor, a tall mullioned window on one wall
 * throwing a light pool with a cross shadow, two canvases on the opposite
 * wall, and exposed ceiling beams.
 */
function makeAtelier(theme) {
  const X = 2.9;
  const Z = 3.6;
  const FLOOR = -1.45;
  const CEIL = 1.75;

  const tint = rgbOf(theme.tint);
  const wood = blend(rgbOf(pal.surface), tint, 0.44);
  const woodDark = blend(wood, BLACK, 0.42);
  const plaster = blend(blend(rgbOf(pal.surfaceAlt), WHITE, 0.7), tint, 0.3);
  const plasterShade = blend(plaster, rgbOf(pal.ink), 0.3);
  const ceilCol = blend(blend(plaster, WHITE, 0.22), tint, 0.06);
  const daylight = [1, 0.97, 0.92];
  const frame = blend(rgbOf(pal.ink), rgbOf(pal.surfaceAlt), 0.5);
  const canvasA = blend(rgbOf(pal.primary), WHITE, 0.35);
  const canvasB = blend(rgbOf(pal.accent), WHITE, 0.45);

  // Key light comes through the window on the +Z wall, slightly from above.
  const LX = 0;
  const LY = 0.34;
  const LZ = 0.94;
  const AMBIENT = 0.52 * clamp01(theme.ambient);

  const scratch = new Float64Array(3);

  /** Window aperture on the +Z wall, in wall coordinates. */
  const winX = 1.0;
  const winLo = -0.3;
  const winHi = 1.15;

  return function atelier(out, dx, dy, dz, _lon, _lat, _hyp) {
    // Slab intersection with the room box; the viewer sits at the origin.
    const tx = Math.abs(dx) > 1e-9 ? (dx > 0 ? X : -X) / dx : Infinity;
    const tz = Math.abs(dz) > 1e-9 ? (dz > 0 ? Z : -Z) / dz : Infinity;
    const ty = Math.abs(dy) > 1e-9 ? (dy > 0 ? CEIL : FLOOR) / dy : Infinity;
    const t = Math.min(tx, ty, tz);
    const px = t * dx;
    const py = t * dy;
    const pz = t * dz;

    if (t === ty && dy < 0) {
      // ── plank floor ────────────────────────────────────────────────
      const plank = Math.floor(px / 0.17);
      set3(out, wood);
      mul3(out, 0.86 + 0.28 * hash2(plank, 3));
      // Grain, plus the joint between planks and the staggered end joints.
      mul3(out, 1 + 0.05 * Math.sin(pz * 8.5 + plank * 2.7) + 0.025 * Math.sin(pz * 27 + plank));
      const jx = Math.abs(px / 0.17 - Math.round(px / 0.17));
      mul3(out, 1 - 0.45 * (1 - smoothstep(0.03, 0.075, jx)));
      const ez = (pz + plank * 0.41) / 1.45;
      const jz = Math.abs(ez - Math.round(ez));
      mul3(out, 1 - 0.35 * (1 - smoothstep(0.008, 0.02, jz)));

      // Light pool cast through the window, with the mullion cross in it.
      const pool = band(px, -1.3, 1.3, 0.5) * band(pz, 0.3, 2.9, 0.7);
      let lit = pool;
      lit *= 1 - 0.6 * Math.exp(-Math.pow(px / 0.1, 2)); // vertical mullion
      lit *= 1 - 0.55 * Math.exp(-Math.pow((pz - 1.6) / 0.11, 2)); // transom
      add3(out, daylight, lit * 0.52 * theme.key);
      mul3(out, AMBIENT + 0.5);

      // Corner darkening.
      mul3(out, 1 - 0.35 * smoothstep(0.62, 1.0, Math.max(Math.abs(px) / X, Math.abs(pz) / Z)));
      return;
    }

    if (t === ty) {
      // ── ceiling with beams across the room ─────────────────────────
      set3(out, ceilCol);
      const b = (pz + 0.8) / 1.6;
      const beam = 1 - smoothstep(0.06, 0.1, Math.abs(b - Math.round(b)));
      toward3(out, woodDark, beam * 0.85);
      mul3(out, AMBIENT + 0.4 + 0.22 * smoothstep(Z, 0.0, Math.abs(pz)));
      mul3(out, 1 - 0.3 * smoothstep(0.55, 1.0, Math.abs(px) / X));
      return;
    }

    // ── walls ────────────────────────────────────────────────────────
    const isZ = t === tz;
    const nx = isZ ? 0 : dx > 0 ? -1 : 1;
    const nz = isZ ? (dz > 0 ? -1 : 1) : 0;
    const lambert = clamp01(nx * LX + nz * LZ) * 0.85 + Math.max(0, LY) * 0.1;
    const v = (py - FLOOR) / (CEIL - FLOOR); // 0 at the floor, 1 at the ceiling
    const along = isZ ? px : pz;

    set3(out, plaster);
    toward3(out, plasterShade, 1 - smoothstep(0.05, 0.85, v));

    if (isZ && dz > 0) {
      // Window wall.
      const inWin = band(px, -winX, winX, 0.012) * band(py, winLo, winHi, 0.012);
      const inFrame =
        band(px, -winX - 0.1, winX + 0.1, 0.012) * band(py, winLo - 0.1, winHi + 0.1, 0.012);
      if (inFrame > 0.002) toward3(out, frame, inFrame * 0.9);
      if (inWin > 0.002) {
        // Blown-out daylight beyond the glass.
        set3(scratch, daylight);
        toward3(scratch, blend(daylight, tint, 0.22), smoothstep(winHi, winLo, py) * 0.5);
        mul3(scratch, 1.15);
        const mull =
          Math.exp(-Math.pow(px / 0.035, 2)) + Math.exp(-Math.pow((py - 0.42) / 0.035, 2));
        toward3(scratch, frame, clamp01(mull) * 0.92);
        toward3(out, scratch, inWin);
        return;
      }
      // Light spilling onto the plaster around the aperture.
      add3(
        out,
        daylight,
        0.3 * theme.key * Math.exp(-Math.pow((Math.abs(px) - winX) / 0.9, 2)) * smoothstep(-1.4, 0.9, py),
      );
    } else if (isZ) {
      // Wall behind the viewer: shallow pilasters every 1.2 m for rhythm. It
      // lands on the image seam, so it is deliberately kept plain.
      const p = along / 1.2;
      const pil = 1 - smoothstep(0.05, 0.1, Math.abs(p - Math.round(p)));
      mul3(out, 1 - 0.14 * pil);
    } else {
      // Side walls: a hung canvas each, which is what makes it an atelier.
      const inner = band(along, -0.95, 0.95, 0.006) * band(py, -0.28, 0.86, 0.006);
      const outer = band(along, -1.08, 1.08, 0.006) * band(py, -0.41, 0.99, 0.006);
      if (outer > 0.002) {
        toward3(out, frame, outer * 0.9);
        if (inner > 0.002) {
          // A soft two-tone wash so the canvases are not flat rectangles.
          set3(scratch, dx > 0 ? canvasA : canvasB);
          toward3(scratch, WHITE, clamp01(0.35 + 0.4 * (py - along * 0.35)));
          mul3(scratch, 0.85 + 0.25 * clamp01(0.5 + 0.4 * (along + py)));
          toward3(out, scratch, inner * 0.96);
        }
      }
      // Hanging shadow under each canvas.
      mul3(out, 1 - 0.18 * band(along, -1.1, 1.1, 0.05) * Math.exp(-Math.pow((py + 0.5) / 0.09, 2)));
    }

    // Skirting board and picture rail.
    mul3(out, 1 - 0.4 * (1 - smoothstep(0.035, 0.06, v)));
    toward3(out, woodDark, 0.75 * band(v, 0.0, 0.05, 0.006));
    toward3(out, woodDark, 0.4 * band(v, 0.86, 0.885, 0.004));

    mul3(out, AMBIENT + 0.45 + 0.55 * lambert * theme.key);
    // Distance falloff from the window plus corner darkening.
    mul3(out, 1 - 0.22 * smoothstep(0.4, 1.0, Math.abs(along) / (isZ ? X : Z)));
  };
}

/* ── renderer ────────────────────────────────────────────────────────────── */

/**
 * Walk every pixel of the equirectangular frame, build its view ray and ask
 * the scene for a colour.
 */
async function render(scene, file) {
  const buf = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);
  const sinLon = new Float64Array(WIDTH);
  const cosLon = new Float64Array(WIDTH);
  const lons = new Float64Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) {
    const lon = ((x + 0.5) / WIDTH) * TAU - Math.PI;
    lons[x] = lon;
    sinLon[x] = Math.sin(lon);
    cosLon[x] = Math.cos(lon);
  }

  const out = new Float64Array(3);
  let o = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / HEIGHT) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    const hyp = Math.max(Math.abs(cl), 1e-9); // length of the ray's XZ part
    for (let x = 0; x < WIDTH; x++) {
      scene(out, cl * sinLon[x], sl, cl * cosLon[x], lons[x], lat, hyp);
      // Ordered dither at well under one code value: 8-bit skies over 2000
      // rows band badly without it, and JPEG happily preserves the banding.
      const d = ((x * 7 + y * 13) % 5) * 0.0009 - 0.0018;
      buf[o++] = clamp01(out[0] + d) * 255 + 0.5;
      buf[o++] = clamp01(out[1] + d) * 255 + 0.5;
      buf[o++] = clamp01(out[2] + d) * 255 + 0.5;
    }
  }

  await sharp(buf, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toFile(file);
  return statSync(file).size;
}

const BUILDERS = {
  "showroom.jpg": makeShowroom,
  "alpine.jpg": makeAlpine,
  "atelier.jpg": makeAtelier,
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = readPanoramaEntries();
  if (entries.length === 0) throw new Error("no panorama entries found in shared/environments.ts");

  console.log(`Rendering ${WIDTH}x${HEIGHT} equirectangular panoramas at quality ${QUALITY}.`);
  for (const entry of entries) {
    const build = BUILDERS[entry.file];
    if (!build) {
      // A customer added a panorama entry of their own: their JPG is dropped
      // in by hand, so there is nothing to generate.
      console.log(`  ${entry.file.padEnd(16)} skipped (no generator; supply the file yourself)`);
      continue;
    }
    const started = Date.now();
    const file = path.join(OUT_DIR, entry.file);
    const bytes = await render(build(entry), file);
    console.log(
      `  ${entry.file.padEnd(16)} ${(bytes / 1024 / 1024).toFixed(2)} MB  ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s  ${entry.name}`,
    );
  }
}

main().catch((err) => {
  console.error(`gen-environments failed: ${err.message}`);
  process.exitCode = 1;
});
