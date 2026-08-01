import { statsFor, type Company, type Receipt, type BexioCode } from "./store";
import { getImage } from "./images";

function money(n: number, cur: string): string {
  return `${cur ? cur + " " : ""}${(n || 0).toFixed(2)}`.trim();
}

// Filesystem-safe slug for filenames.
function slug(s: string): string {
  return (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "receipt";
}

// Decode a stored data-URL into raw bytes + a file extension.
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/jpeg";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("pdf") ? "pdf" : "jpg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext };
}

// ── Summary breakdown PDF ────────────────────────────────────────────────────
// A single file listing the totals, the per-Bexio-code breakdown, and an
// itemised table of every receipt. No receipt images (those ship separately).
export async function buildSummaryPdf(company: Company, receipts: Receipt[], codes: BexioCode[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 14;
  let y = M;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(company.name || "Receipts", M, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const dates = receipts.map((r) => r.date).filter(Boolean).sort();
  const range = dates.length ? ` · ${dates[0]} → ${dates[dates.length - 1]}` : "";
  doc.text(`Receipts summary${range} · ${receipts.length} item${receipts.length === 1 ? "" : "s"}`, M, y);
  y += 6;

  // Totals per currency.
  const byCur: Record<string, { gross: number; vat: number }> = {};
  receipts.forEach((r) => {
    const c = r.currency || "CHF";
    byCur[c] = byCur[c] || { gross: 0, vat: 0 };
    byCur[c].gross += r.amount || 0;
    byCur[c].vat += r.vatAmount || 0;
  });
  doc.setFont("helvetica", "bold");
  Object.entries(byCur).forEach(([c, t]) => {
    doc.text(`Total ${c} ${t.gross.toFixed(2)}   (VAT ${t.vat.toFixed(2)})`, M, y);
    y += 5;
  });
  y += 2;

  // Per-Bexio-code breakdown.
  const stats = statsFor(receipts, codes);
  if (stats.byCode.length) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("By Bexio code", M, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    stats.byCode.forEach((c) => {
      if (y > H - 20) { doc.addPage(); y = M; }
      const label = `${c.code ? c.code + "  " : ""}${c.label || ""}`.trim() || "Unassigned";
      doc.text(label.slice(0, 52), M, y);
      doc.text(`${stats.currency} ${c.amount.toFixed(2)}   ·   ${c.count}x`, W - M, y, { align: "right" });
      y += 4.6;
    });
    y += 4;
  }

  // Itemised table.
  const cols = [
    { x: M, t: "Date" },
    { x: M + 20, t: "Vendor" },
    { x: M + 62, t: "Amount" },
    { x: M + 90, t: "VAT" },
    { x: M + 110, t: "Bexio" },
    { x: M + 134, t: "Description" },
  ];
  const drawHead = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    cols.forEach((c) => doc.text(c.t, c.x, y));
    y += 1.5;
    doc.setLineWidth(0.2);
    doc.line(M, y, W - M, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
  };
  if (y > H - 30) { doc.addPage(); y = M; }
  drawHead();
  receipts.forEach((r) => {
    if (y > H - 18) { doc.addPage(); y = M; drawHead(); }
    const cells = [
      r.date || "—",
      (r.vendor || "—").slice(0, 24),
      money(r.amount, r.currency || ""),
      r.vatAmount ? r.vatAmount.toFixed(2) : "—",
      r.bexioCode || "—",
      (r.description || r.category || "").slice(0, 32),
    ];
    cols.forEach((c, i) => doc.text(String(cells[i]), c.x, y));
    y += 5;
  });

  return doc.output("blob");
}

// ── Export ZIP ───────────────────────────────────────────────────────────────
// One archive = the summary PDF + a `receipts/` folder with every receipt as its
// own file, so the user can attach them one by one after extracting.
export async function buildReceiptsZip(
  company: Company,
  receipts: Receipt[],
  codes: BexioCode[],
  tag: string
): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};

  const summary = await buildSummaryPdf(company, receipts, codes);
  files[`Summary_${slug(company.name)}_${tag}.pdf`] = new Uint8Array(await summary.arrayBuffer());

  // Number receipts chronologically so filenames sort naturally.
  const ordered = [...receipts].sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.at - b.at);
  let idx = 0;
  for (const r of ordered) {
    idx++;
    if (!r.hasImage) continue;
    const data = await getImage(r.id);
    if (!data) continue;
    try {
      const { bytes, ext } = dataUrlToBytes(data);
      const name = `${String(idx).padStart(2, "0")}_${r.date || "nodate"}_${slug(r.vendor)}.${ext}`;
      files[`receipts/${name}`] = bytes;
    } catch {
      /* skip unreadable image */
    }
  }

  // level 0 (store) — images/PDFs are already compressed, so don't waste time.
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped.slice().buffer], { type: "application/zip" });
}

// Share via the native sheet (→ Mail / Files on iOS) or download.
export async function shareOrDownloadFile(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & { canShare?: (d: any) => boolean; share?: (d: any) => Promise<void> };
  if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename });
      return "shared";
    } catch {
      /* user cancelled or unsupported — fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
