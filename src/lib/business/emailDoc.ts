// Render an email's text into a clean receipt document (JPEG data URL), so
// text-only invoices (Apple, Meta, subscription receipts…) get a visual file
// exactly like photographed receipts: it becomes the thumbnail, shows in the
// receipt sheet, and lands in the ZIP export as a normal image.

const W = 1240;
const PAD = 80;
const BODY_PX = 28;
const LINE_H = 42;
const MAX_LINES = 78;

function wrapLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  if (!line) return [""];
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(cand).width <= maxWidth || !cur) cur = cand;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

export function renderEmailDocument(
  meta: { from: string; subject: string; date: string; account?: string },
  text: string
): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // Wrap the body first (on a throwaway measure pass) to know the height.
  ctx.font = `${BODY_PX}px "Helvetica Neue", Arial, sans-serif`;
  const raw = text.replace(/\r/g, "").split("\n");
  let lines: string[] = [];
  for (const l of raw) {
    lines.push(...wrapLine(ctx, l.trimEnd(), W - PAD * 2));
    if (lines.length > MAX_LINES) break;
  }
  // Collapse runs of blank lines and cap the length.
  lines = lines.filter((l, i, a) => l.trim() || (a[i - 1] || "").trim());
  const truncated = lines.length > MAX_LINES;
  lines = lines.slice(0, MAX_LINES);

  const headerH = 250;
  const footerH = 110;
  const H = headerH + lines.length * LINE_H + footerH;
  canvas.width = W;
  canvas.height = H;

  // Page
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#6b7280";
  ctx.font = `600 24px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText("EMAIL INVOICE", PAD, 84);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 40px "Helvetica Neue", Arial, sans-serif`;
  const subj = wrapLine(ctx, meta.subject || "(no subject)", W - PAD * 2)[0];
  ctx.fillText(subj, PAD, 140);
  ctx.fillStyle = "#475569";
  ctx.font = `26px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(`${meta.from || "Unknown sender"}  ·  ${meta.date || ""}`, PAD, 186);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, headerH - 34);
  ctx.lineTo(W - PAD, headerH - 34);
  ctx.stroke();

  // Body
  ctx.fillStyle = "#1e293b";
  ctx.font = `${BODY_PX}px "Helvetica Neue", Arial, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, PAD, headerH + 8 + i * LINE_H));
  if (truncated) {
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("…", PAD, headerH + 8 + lines.length * LINE_H);
  }

  // Footer
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(PAD, H - footerH + 28);
  ctx.lineTo(W - PAD, H - footerH + 28);
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = `22px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(`Imported from Gmail${meta.account ? ` (${meta.account})` : ""} · AC App`, PAD, H - footerH + 74);

  return canvas.toDataURL("image/jpeg", 0.92);
}
