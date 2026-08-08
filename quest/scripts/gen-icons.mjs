#!/usr/bin/env node
/**
 * Generates every icon the PWA and the three Quest APKs need.
 *
 *   npm run icons
 *
 * Output (all under `public/icons/`):
 *
 *   icon-192.png              house icon, "any" purpose
 *   icon-512.png              house icon, "any" purpose
 *   icon-512-maskable.png     house icon, "maskable" purpose (full-bleed, opaque)
 *   favicon.svg               the same mark, simplified, as vector
 *   <edition>/icon-192.png            per-edition variants, same three files,
 *   <edition>/icon-512.png            so the three APKs are told apart on the
 *   <edition>/icon-512-maskable.png   headset home screen
 *
 * The mark is drawn procedurally: a two-by-two board of memory cards with the
 * diagonal pair turned face up, sitting inside a HUD ring on a perspective
 * floor. Every colour is derived from the palette in `shared/brand.ts`, so
 * re-skinning the product is a palette edit plus `npm run icons`.
 *
 * Editions are distinguished by the hero colour (teal / blue / amber), which
 * survives being shrunk to a home-screen tile, plus a tier dot row that
 * rewards a closer look.
 *
 * NOTE ON THE MASKABLE ICON: Horizon applies its own mask, so that variant is
 * full-bleed and fully opaque (no alpha channel, no rounded corners) and its
 * artwork is scaled into the central safe zone. Transparency or pre-rounded
 * corners here produce visible artefacts after masking.
 *
 * This file is plain ESM run directly by Node, never bundled, so it cannot
 * import the TypeScript sources. It parses the literals it needs out of
 * `shared/brand.ts` and `shared/editions.ts` instead of copying them, which is
 * what keeps the icons from drifting away from the source of truth.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEST = path.resolve(HERE, "..");
const OUT_DIR = path.join(QUEST, "public", "icons");

/* ── reading the source of truth ─────────────────────────────────────────── */

/** Slice a `{ ... }` literal starting at or after `from`, brace-balanced. */
function balancedObject(src, from) {
  const start = src.indexOf("{", from);
  if (start < 0) throw new Error(`no object literal after offset ${from}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced object literal");
}

/** The object literal that follows the first match of `re`. */
function objectAfter(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${what} — has the source moved?`);
  return balancedObject(src, m.index + m[0].length);
}

/** `key: "value"` out of an object literal. */
function strField(block, key, what) {
  const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(block);
  if (!m) throw new Error(`could not read "${key}" from ${what}`);
  return m[1];
}

const brandSrc = readFileSync(path.join(QUEST, "shared", "brand.ts"), "utf8");
const editionSrc = readFileSync(path.join(QUEST, "shared", "editions.ts"), "utf8");

const paletteBlock = objectAfter(
  brandSrc,
  /export const palette\s*:\s*Palette\s*=\s*/,
  "`palette` in shared/brand.ts",
);
const textBlock = objectAfter(brandSrc, /export const text\s*=\s*/, "`text` in shared/brand.ts");
const brandBlock = objectAfter(brandSrc, /export const brand\s*=\s*/, "`brand` in shared/brand.ts");

const pal = Object.fromEntries(
  ["ink", "surface", "surfaceAlt", "primary", "accent", "reward", "danger"].map((k) => [
    k,
    strField(paletteBlock, k, "palette"),
  ]),
);
const txt = Object.fromEntries(
  ["primary", "secondary", "muted", "onAccent", "onPrimary"].map((k) => [
    k,
    strField(textBlock, k, "text"),
  ]),
);
const productName = strField(brandBlock, "productName", "brand");

/** The three editions, in tier order, read out of `shared/editions.ts`. */
const editions = ["demo", "pro", "enterprise"].map((id) => {
  const block = objectAfter(
    editionSrc,
    new RegExp(`const ${id.toUpperCase()}\\s*:\\s*EditionSpec\\s*=\\s*`),
    `edition ${id} in shared/editions.ts`,
  );
  return { id, name: strField(block, "name", id), packageId: strField(block, "packageId", id) };
});

/* ── colour helpers ──────────────────────────────────────────────────────── */

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => "#" + rgb.map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
/** Linear blend between two hex colours, `t` = 0 gives `a`. */
const mix = (a, b, t) => {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
};
/** Positive `t` lightens toward white, negative darkens toward black. */
const shade = (c, t) => (t >= 0 ? mix(c, "#FFFFFF", t) : mix(c, "#000000", -t));
const rgba = (c, a) => {
  const [r, g, b] = toRgb(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
/** Perceptual-ish luminance, used to pick legible ink on a coloured card. */
const luminance = (c) => {
  const [r, g, b] = toRgb(c).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/* ── the mark ────────────────────────────────────────────────────────────── */

const VB = 512; // design canvas; everything below is in these units
const CENTER = VB / 2;

// Board geometry. Card corners sit at radius ~194 from the centre, so the HUD
// ring at 206 clears them with a deliberate halo.
const CARD_W = 118;
const CARD_H = 148;
const GAP = 16;
const RING_INNER = 206;
const RING_OUTER = 218;
const TICK_OUTER = 236; // furthest painted pixel from the centre
const BOARD_TILT = -9; // degrees; enough energy to not read as a spreadsheet

/**
 * One card. `face` cards are the matched pair, `back` cards carry the VRENT
 * chevron.
 */
function cardShape({ x, y, kind, hero, second, onHero, ink }) {
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;
  const r = 16;

  if (kind === "back") {
    const chevron = `M ${cx - 27} ${cy - 20} L ${cx} ${cy + 22} L ${cx + 27} ${cy - 20}`;
    return `
    <g>
      <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="${r}" fill="url(#cardBack)"/>
      <rect x="${x + 0.9}" y="${y + 0.9}" width="${CARD_W - 1.8}" height="${CARD_H - 1.8}" rx="${r - 1}"
            fill="none" stroke="${rgba(second, 0.34)}" stroke-width="1.8"/>
      <rect x="${x + 9}" y="${y + 9}" width="${CARD_W - 18}" height="${CARD_H - 18}" rx="${r - 6}"
            fill="none" stroke="${rgba(second, 0.14)}" stroke-width="1.4"/>
      <path d="${chevron}" fill="none" stroke="${rgba(second, 0.62)}" stroke-width="11"
            stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
  }

  // Matched pair: a hexagon glyph, identical on both cards.
  const hexR = 33;
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + hexR * Math.cos(a)).toFixed(1)} ${(cy + hexR * Math.sin(a)).toFixed(1)}`;
  }).join(" L ");
  return `
    <g>
      <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="${r}" fill="url(#cardFace)"/>
      <rect x="${x + 7}" y="${y + 7}" width="${CARD_W - 14}" height="${CARD_H * 0.42}" rx="${r - 5}"
            fill="url(#sheen)"/>
      <rect x="${x + 1}" y="${y + 1}" width="${CARD_W - 2}" height="${CARD_H - 2}" rx="${r - 1}"
            fill="none" stroke="${rgba(shade(hero, 0.45), 0.85)}" stroke-width="2"/>
      <path d="M ${hex} Z" fill="none" stroke="${rgba(onHero, 0.9)}" stroke-width="8"
            stroke-linejoin="round"/>
      <circle cx="${cx}" cy="${cy}" r="10.5" fill="${rgba(onHero, 0.92)}"/>
      <circle cx="${cx}" cy="${cy}" r="10.5" fill="none" stroke="${rgba(ink, 0.25)}" stroke-width="1"/>
    </g>`;
}

/** The perspective floor the board stands on. Purely a texture. */
function floorLines(second) {
  const vpX = CENTER;
  const vpY = 274;
  const out = [];
  for (let i = -7; i <= 7; i++) {
    const bx = vpX + i * 92;
    const fade = 0.13 - Math.abs(i) * 0.011;
    if (fade <= 0.005) continue;
    out.push(
      `<line x1="${vpX}" y1="${vpY}" x2="${bx.toFixed(1)}" y2="${VB}" stroke="${rgba(second, fade.toFixed(3))}" stroke-width="1.3"/>`,
    );
  }
  let y = vpY + 12;
  let step = 12;
  while (y < VB) {
    const fade = Math.min(0.16, 0.03 + (y - vpY) / 1900);
    out.push(
      `<line x1="0" y1="${y.toFixed(1)}" x2="${VB}" y2="${y.toFixed(1)}" stroke="${rgba(second, fade.toFixed(3))}" stroke-width="1.2"/>`,
    );
    y += step;
    step *= 1.42;
  }
  return `<g clip-path="url(#belowHorizon)">${out.join("")}</g>`;
}

/** The HUD ring plus its cardinal ticks. */
function ring(hero, second) {
  const ticks = [0, 90, 180, 270]
    .map((deg) => {
      const a = (Math.PI / 180) * (deg - 90);
      const x1 = CENTER + (RING_OUTER + 6) * Math.cos(a);
      const y1 = CENTER + (RING_OUTER + 6) * Math.sin(a);
      const x2 = CENTER + TICK_OUTER * Math.cos(a);
      const y2 = CENTER + TICK_OUTER * Math.sin(a);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
                    stroke="${rgba(hero, 0.5)}" stroke-width="4" stroke-linecap="round"/>`;
    })
    .join("");
  // Dashed arcs read as an instrument bezel rather than a plain circle.
  const circumference = 2 * Math.PI * RING_INNER;
  const dash = `${(circumference * 0.3).toFixed(1)} ${(circumference * 0.055).toFixed(1)} ${(circumference * 0.14).toFixed(1)} ${(circumference * 0.055).toFixed(1)}`;
  return `
    <g>
      <circle cx="${CENTER}" cy="${CENTER}" r="${RING_OUTER}" fill="none"
              stroke="${rgba(second, 0.13)}" stroke-width="1.6"/>
      <circle cx="${CENTER}" cy="${CENTER}" r="${RING_INNER}" fill="none"
              stroke="${rgba(hero, 0.42)}" stroke-width="3"
              stroke-dasharray="${dash}" stroke-linecap="round"
              transform="rotate(-36 ${CENTER} ${CENTER})"/>
      ${ticks}
    </g>`;
}

/**
 * Build the full SVG for one variant.
 *
 * @param {object} o
 * @param {string} o.hero        edition hero colour
 * @param {string} o.second      supporting colour
 * @param {number} o.tier        1-3, drawn as the dot row
 * @param {number} o.contentScale 1 for "any", smaller for "maskable" so the
 *                                artwork lands inside the central safe zone
 * @param {number} o.px          rasterisation size in pixels
 * @param {boolean} o.simple     favicon variant: fewer, bigger shapes
 */
function markSvg({ hero, second, tier, contentScale, px, simple = false }) {
  const onHero = luminance(hero) > 0.45 ? pal.ink : txt.onPrimary;
  // The reward colour marks the match — unless it *is* the hero colour, in
  // which case it would disappear, so fall back to the brightest text colour.
  const spark = hero.toLowerCase() === pal.reward.toLowerCase() ? txt.primary : pal.reward;

  const gx = CENTER - CARD_W - GAP / 2;
  const gy = CENTER - CARD_H - GAP / 2;
  const at = (col, row) => ({ x: gx + col * (CARD_W + GAP), y: gy + row * (CARD_H + GAP) });

  const cards = [
    cardShape({ ...at(0, 0), kind: "face", hero, second, onHero, ink: pal.ink }),
    cardShape({ ...at(1, 0), kind: "back", hero, second, onHero, ink: pal.ink }),
    cardShape({ ...at(0, 1), kind: "back", hero, second, onHero, ink: pal.ink }),
    cardShape({ ...at(1, 1), kind: "face", hero, second, onHero, ink: pal.ink }),
  ].join("");

  const s = 23; // match spark half-size
  const sparkPath =
    `M ${CENTER} ${CENTER - s} Q ${CENTER + s * 0.26} ${CENTER - s * 0.26} ${CENTER + s} ${CENTER} ` +
    `Q ${CENTER + s * 0.26} ${CENTER + s * 0.26} ${CENTER} ${CENTER + s} ` +
    `Q ${CENTER - s * 0.26} ${CENTER + s * 0.26} ${CENTER - s} ${CENTER} ` +
    `Q ${CENTER - s * 0.26} ${CENTER - s * 0.26} ${CENTER} ${CENTER - s} Z`;

  const dots = Array.from({ length: 3 }, (_, i) => {
    const on = i < tier;
    return `<circle cx="${CENTER + (i - 1) * 23}" cy="452" r="${on ? 6 : 4.6}"
                    fill="${on ? rgba(hero, 0.95) : rgba(txt.muted, 0.4)}"/>`;
  }).join("");

  const bgHi = mix(pal.surfaceAlt, hero, 0.2);
  const bgMid = mix(pal.surface, hero, 0.06);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${VB} ${VB}">
  <title>${productName}</title>
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="82%">
      <stop offset="0%" stop-color="${bgHi}"/>
      <stop offset="46%" stop-color="${bgMid}"/>
      <stop offset="100%" stop-color="${pal.ink}"/>
    </radialGradient>
    <linearGradient id="sweep" x1="0%" y1="0%" x2="76%" y2="100%">
      <stop offset="0%" stop-color="${rgba(hero, 0.16)}"/>
      <stop offset="52%" stop-color="${rgba(hero, 0)}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="58%" stop-color="${rgba(pal.ink, 0)}"/>
      <stop offset="100%" stop-color="${rgba(pal.ink, 0.72)}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${rgba(hero, 0.34)}"/>
      <stop offset="55%" stop-color="${rgba(hero, 0.12)}"/>
      <stop offset="100%" stop-color="${rgba(hero, 0)}"/>
    </radialGradient>
    <linearGradient id="cardBack" x1="0%" y1="0%" x2="30%" y2="100%">
      <stop offset="0%" stop-color="${shade(pal.surfaceAlt, 0.1)}"/>
      <stop offset="100%" stop-color="${shade(pal.surface, -0.15)}"/>
    </linearGradient>
    <linearGradient id="cardFace" x1="12%" y1="0%" x2="88%" y2="100%">
      <stop offset="0%" stop-color="${shade(hero, 0.24)}"/>
      <stop offset="58%" stop-color="${hero}"/>
      <stop offset="100%" stop-color="${shade(hero, -0.34)}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.2)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <radialGradient id="sparkGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${rgba(spark, 0.6)}"/>
      <stop offset="100%" stop-color="${rgba(spark, 0)}"/>
    </radialGradient>
    <clipPath id="belowHorizon">
      <rect x="0" y="274" width="${VB}" height="${VB - 274}"/>
    </clipPath>
  </defs>

  <!-- Opaque, full-bleed ground. The maskable variant depends on this. -->
  <rect width="${VB}" height="${VB}" fill="${pal.ink}"/>
  <rect width="${VB}" height="${VB}" fill="url(#bg)"/>
  <rect width="${VB}" height="${VB}" fill="url(#sweep)"/>
  ${simple ? "" : floorLines(second)}
  <rect width="${VB}" height="${VB}" fill="url(#vignette)"/>

  <g transform="translate(${CENTER} ${CENTER}) scale(${contentScale}) translate(${-CENTER} ${-CENTER})">
    <circle cx="${CENTER}" cy="${CENTER}" r="232" fill="url(#glow)"/>
    ${ring(hero, second)}
    <g transform="rotate(${BOARD_TILT} ${CENTER} ${CENTER})">
      ${cards}
    </g>
    <circle cx="${CENTER}" cy="${CENTER}" r="46" fill="url(#sparkGlow)"/>
    <path d="${sparkPath}" fill="${spark}"/>
    ${simple ? "" : dots}
  </g>
</svg>
`;
}

/* ── rasterisation ───────────────────────────────────────────────────────── */

/**
 * Rasterise at 2x and downsample: gives cleaner antialiasing on the thin HUD
 * strokes than letting the SVG renderer hint them at the final size.
 */
async function writePng(svg, size, file) {
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size, { kernel: "lanczos3" })
    // Guarantees an opaque, alpha-free PNG. Required for the maskable icon and
    // harmless for the others, whose artwork is full-bleed anyway.
    .flatten({ background: pal.ink })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  await writeFile(file, buf);
  return buf.length;
}

/** The three files one edition (or the house set) needs. */
async function writeIconSet(dir, style) {
  await mkdir(dir, { recursive: true });
  const written = [];
  written.push([
    path.join(dir, "icon-512.png"),
    await writePng(markSvg({ ...style, contentScale: 1, px: 1024 }), 512, path.join(dir, "icon-512.png")),
  ]);
  written.push([
    path.join(dir, "icon-192.png"),
    await writePng(markSvg({ ...style, contentScale: 1, px: 768 }), 192, path.join(dir, "icon-192.png")),
  ]);
  // 0.82 keeps the outermost tick marks inside the central 80% safe zone that
  // Android/Horizon guarantee will survive any mask shape.
  written.push([
    path.join(dir, "icon-512-maskable.png"),
    await writePng(
      markSvg({ ...style, contentScale: 0.82, px: 1024 }),
      512,
      path.join(dir, "icon-512-maskable.png"),
    ),
  ]);
  return written;
}

/* ── edition styling ─────────────────────────────────────────────────────── */

/**
 * Hero colours are taken straight from the palette, one per tier, so a re-skin
 * moves all three icons together. `pro` is also the house look used by the
 * top-level icon files and the favicon.
 */
const STYLES = {
  demo: { hero: pal.accent, second: pal.primary, tier: 1 },
  pro: { hero: pal.primary, second: pal.accent, tier: 2 },
  enterprise: { hero: pal.reward, second: pal.primary, tier: 3 },
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const report = [];

  // House set at the top level: what index.html links and what any tool that
  // guesses `/icons/icon-512.png` will find.
  report.push(...(await writeIconSet(OUT_DIR, STYLES.pro)));

  for (const ed of editions) {
    const style = STYLES[ed.id];
    if (!style) throw new Error(`no icon style defined for edition "${ed.id}"`);
    report.push(...(await writeIconSet(path.join(OUT_DIR, ed.id), style)));
  }

  // Vector favicon: same mark, fewer elements so it still reads at 16px.
  const faviconPath = path.join(OUT_DIR, "favicon.svg");
  const favicon = markSvg({ ...STYLES.pro, contentScale: 0.94, px: 512, simple: true });
  await writeFile(faviconPath, favicon, "utf8");
  report.push([faviconPath, Buffer.byteLength(favicon)]);

  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  for (const [file, size] of report) {
    console.log(`  ${path.relative(QUEST, file).padEnd(42)} ${kb(size).padStart(10)}`);
  }
  console.log(
    `\n${report.length} files written to public/icons/ ` +
      `(house set plus ${editions.map((e) => e.id).join(", ")}).`,
  );
}

main().catch((err) => {
  console.error(`gen-icons failed: ${err.message}`);
  process.exitCode = 1;
});
