import type { StudioLayout, StudioScene } from "../api";
import type { BrandKit } from "./brand";

// Canvas compositor for the AI Studio. The AI returns a layout *spec*
// (template, copy, colors, positions) and this module renders it
// deterministically onto the user's photos at Instagram-native sizes — so the
// brand logo is always crisp, text is never mangled, and colors are exact.

export const POST_W = 1080;
export const POST_H = 1350; // 4:5 portrait post
export const STORY_W = 1080;
export const STORY_H = 1920; // 9:16 story / reel

const FONT = '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  return [canvas, ctx];
}

/** Draw an image cover-fit into the given rect. */
function coverDraw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wrap `text` to `maxWidth`, shrinking the font until it fits maxLines. */
function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  startPx: number,
  minPx: number,
  maxWidth: number,
  maxLines: number
): { lines: string[]; px: number } {
  let px = startPx;
  while (px > minPx) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    const tooWide = lines.some((l) => ctx.measureText(l).width > maxWidth);
    if (lines.length <= maxLines && !tooWide) return { lines, px };
    px = Math.round(px * 0.92);
  }
  ctx.font = `${weight} ${minPx}px ${FONT}`;
  return { lines: [text], px: minPx };
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Logo on a soft rounded chip so any logo (dark or light) stays readable. */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  brand: BrandKit,
  position: StudioLayout["logoPosition"],
  W: number,
  pad: number,
  topOffset = 0
) {
  const chipH = Math.round(W * 0.085);
  let chipW: number;
  if (logo) {
    const inner = chipH - 24;
    chipW = Math.min(W * 0.42, Math.round((logo.width / logo.height) * inner) + 32);
  } else {
    ctx.font = `800 ${Math.round(chipH * 0.42)}px ${FONT}`;
    chipW = Math.round(ctx.measureText(brand.name || "•").width) + 48;
  }
  const x = position.includes("left") ? pad : W - pad - chipW;
  const y = (position.includes("top") ? pad + topOffset : ctx.canvas.height - pad - chipH);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(ctx, x, y, chipW, chipH, chipH / 2);
  ctx.fill();
  ctx.restore();

  if (logo) {
    const inner = chipH - 24;
    const lw = Math.min(chipW - 32, (logo.width / logo.height) * inner);
    const lh = (logo.height / logo.width) * lw;
    ctx.drawImage(logo, x + (chipW - lw) / 2, y + (chipH - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = "#18181b";
    ctx.font = `800 ${Math.round(chipH * 0.42)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(brand.name || "•", x + chipW / 2, y + chipH / 2 + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

interface RenderOpts {
  kind: "post" | "story";
  layout: StudioLayout;
  photos: HTMLImageElement[];
  logo: HTMLImageElement | null;
  brand: BrandKit;
}

/** Render a finished graphic; returns the canvas (caller exports/paints it). */
export function renderGraphic({ kind, layout, photos, logo, brand }: RenderOpts): HTMLCanvasElement {
  const W = kind === "post" ? POST_W : STORY_W;
  const H = kind === "post" ? POST_H : STORY_H;
  const [canvas, ctx] = makeCanvas(W, H);
  const photo = photos[Math.min(layout.photoIndex, photos.length - 1)] || photos[0];
  const pad = Math.round(W * 0.055);
  // Stories keep clear of Instagram's own top/bottom UI.
  const safeTop = kind === "story" ? Math.round(H * 0.08) : 0;
  const safeBottom = kind === "story" ? Math.round(H * 0.1) : 0;

  if (layout.template === "frame") {
    // Editorial card: colored mat, inset photo, copy in the band below/above.
    const mat = brand.secondary || "#f4f4f5";
    ctx.fillStyle = mat;
    ctx.fillRect(0, 0, W, H);
    const bandH = Math.round(H * (kind === "post" ? 0.24 : 0.2));
    const photoY = layout.textPosition === "top" ? safeTop + bandH : safeTop + pad;
    const photoH = H - bandH - pad - safeTop - safeBottom;
    coverDraw(ctx, photo, pad, photoY, W - pad * 2, photoH);

    const ink = isLight(mat) ? "#18181b" : "#ffffff";
    const bandTop = layout.textPosition === "top" ? safeTop : photoY + photoH;
    let y = bandTop + Math.round(bandH * 0.34);
    ctx.fillStyle = layout.accentColor;
    ctx.fillRect(pad, y - Math.round(W * 0.052), Math.round(W * 0.09), 10);
    const head = fitLines(ctx, layout.headline, 800, Math.round(W * 0.062), 34, W - pad * 2, 2);
    ctx.fillStyle = ink;
    for (const line of head.lines) {
      ctx.font = `800 ${head.px}px ${FONT}`;
      ctx.fillText(line, pad, y + head.px * 0.4);
      y += Math.round(head.px * 1.14);
    }
    if (layout.subline) {
      const sub = fitLines(ctx, layout.subline, 500, Math.round(W * 0.032), 22, W - pad * 2, 2);
      ctx.globalAlpha = 0.75;
      for (const line of sub.lines) {
        ctx.font = `500 ${sub.px}px ${FONT}`;
        ctx.fillText(line, pad, y + sub.px * 0.5);
        y += Math.round(sub.px * 1.3);
      }
      ctx.globalAlpha = 1;
    }
    drawLogo(ctx, logo, brand, layout.logoPosition, W, pad + 14, safeTop);
    drawHandle(ctx, brand, W, H, pad, ink, safeBottom);
    if (kind === "story" && layout.cta) drawCtaPill(ctx, layout, W, H, safeBottom);
    return canvas;
  }

  // "clean" and "bold": full-bleed photo with a scrim and type on top.
  coverDraw(ctx, photo, 0, 0, W, H);

  if (layout.template === "bold") {
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(0, 0, W, H);
  }
  // Directional scrim behind the text area.
  const g =
    layout.textPosition === "top"
      ? ctx.createLinearGradient(0, 0, 0, H * 0.55)
      : ctx.createLinearGradient(0, H, 0, H * 0.4);
  const scrim = layout.template === "bold" ? 0.25 : 0.62;
  g.addColorStop(0, `rgba(0,0,0,${scrim})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  if (layout.textPosition !== "center" || layout.template !== "bold") {
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const centered = layout.template === "bold";
  ctx.textAlign = centered ? "center" : "left";
  const tx = centered ? W / 2 : pad;
  const maxW = W - pad * 2;

  const headline = layout.template === "bold" ? layout.headline.toUpperCase() : layout.headline;
  const headStart = Math.round(W * (layout.template === "bold" ? 0.095 : 0.078));
  const head = fitLines(ctx, headline, 800, headStart, 40, maxW, kind === "story" ? 3 : 2);
  const sub = layout.subline ? fitLines(ctx, layout.subline, 500, Math.round(W * 0.034), 24, maxW, 2) : null;

  const blockH =
    head.lines.length * head.px * 1.12 +
    (sub ? sub.lines.length * sub.px * 1.35 + 18 : 0) +
    (layout.cta && kind === "post" ? W * 0.1 : 0);
  let y: number;
  if (layout.textPosition === "top") y = safeTop + pad + Math.round(W * 0.12) + head.px;
  else if (layout.textPosition === "center") y = (H - blockH) / 2 + head.px;
  else y = H - safeBottom - pad - blockH + head.px - (kind === "story" && layout.cta ? W * 0.12 : 0);

  // Accent kicker bar above the headline.
  ctx.fillStyle = layout.accentColor;
  const barW = Math.round(W * 0.085);
  ctx.fillRect(centered ? W / 2 - barW / 2 : pad, y - head.px - Math.round(W * 0.035), barW, 10);

  ctx.fillStyle = layout.textColor;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  for (const line of head.lines) {
    ctx.font = `800 ${head.px}px ${FONT}`;
    ctx.fillText(line, tx, y);
    y += Math.round(head.px * 1.12);
  }
  ctx.shadowBlur = 0;
  if (sub) {
    y += 6;
    ctx.globalAlpha = 0.9;
    for (const line of sub.lines) {
      ctx.font = `500 ${sub.px}px ${FONT}`;
      ctx.fillText(line, tx, y);
      y += Math.round(sub.px * 1.35);
    }
    ctx.globalAlpha = 1;
  }
  if (layout.cta && kind === "post") {
    y += Math.round(W * 0.02);
    drawPill(ctx, layout.cta, centered ? W / 2 : pad, y, layout.accentColor, centered);
  }
  ctx.textAlign = "left";

  drawLogo(ctx, logo, brand, layout.logoPosition, W, pad, safeTop);
  drawHandle(ctx, brand, W, H, pad, "#ffffff", safeBottom);
  if (kind === "story" && layout.cta) drawCtaPill(ctx, layout, W, H, safeBottom);
  return canvas;
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, accent: string, centered: boolean) {
  const px = Math.round(ctx.canvas.width * 0.03);
  ctx.font = `700 ${px}px ${FONT}`;
  const tw = ctx.measureText(text.toUpperCase()).width;
  const w = tw + px * 2.2;
  const h = px * 2.3;
  const bx = centered ? x - w / 2 : x;
  ctx.fillStyle = accent;
  roundRect(ctx, bx, y - h * 0.72, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = isLight(accent) ? "#18181b" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), bx + w / 2, y - h * 0.72 + h / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Story CTA pill, centered above Instagram's bottom UI area. */
function drawCtaPill(ctx: CanvasRenderingContext2D, layout: StudioLayout, W: number, H: number, safeBottom: number) {
  drawPill(ctx, layout.cta, W / 2, H - safeBottom - Math.round(W * 0.04), layout.accentColor, true);
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  brand: BrandKit,
  W: number,
  H: number,
  pad: number,
  color: string,
  safeBottom: number
) {
  if (!brand.handle) return;
  const px = Math.round(W * 0.024);
  ctx.font = `600 ${px}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.textAlign = "right";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 8;
  ctx.fillText(brand.handle, W - pad, H - safeBottom - pad * 0.7);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

/** Render one reel scene (story-sized): photo + scrim + big centered text. */
export function renderScene(
  scene: StudioScene,
  index: number,
  photos: HTMLImageElement[],
  logo: HTMLImageElement | null,
  brand: BrandKit,
  accent: string
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(STORY_W, STORY_H);
  const photo = photos[Math.min(scene.photoIndex, photos.length - 1)] || photos[0];
  coverDraw(ctx, photo, 0, 0, STORY_W, STORY_H);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const pad = Math.round(STORY_W * 0.08);
  const first = index === 0;
  const head = fitLines(
    ctx,
    first ? scene.text.toUpperCase() : scene.text,
    800,
    Math.round(STORY_W * (first ? 0.095 : 0.075)),
    40,
    STORY_W - pad * 2,
    4
  );
  const blockH = head.lines.length * head.px * 1.15;
  let y = (STORY_H - blockH) / 2 + head.px * 0.8;
  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  const barW = Math.round(STORY_W * 0.1);
  ctx.fillRect(STORY_W / 2 - barW / 2, y - head.px - 40, barW, 10);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 16;
  for (const line of head.lines) {
    ctx.font = `800 ${head.px}px ${FONT}`;
    ctx.fillText(line, STORY_W / 2, y);
    y += Math.round(head.px * 1.15);
  }
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  drawLogo(ctx, logo, brand, "top-left", STORY_W, pad, Math.round(STORY_H * 0.08));
  return canvas;
}

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.92): string {
  return canvas.toDataURL("image/jpeg", quality);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

/** Share an image (+ optional caption) via the native share sheet — on a phone
 *  this opens straight into Instagram. Returns false if unsupported. */
export async function shareImage(dataUrl: string, filename: string, text?: string): Promise<boolean> {
  try {
    const file = await dataUrlToFile(dataUrl, filename);
    const payload: ShareData = { files: [file], text };
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
    await navigator.share(payload);
    return true;
  } catch {
    return false;
  }
}
