import type { Company, Receipt } from "./store";
import { getImage } from "./images";

function money(n: number, cur: string): string {
  return `${cur ? cur + " " : ""}${(n || 0).toFixed(2)}`.trim();
}

function imgSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
    im.onerror = () => resolve({ w: 1, h: 1 });
    im.src = dataUrl;
  });
}

// Build a single PDF: a summary table (date, vendor, amount, VAT, bexio code,
// description) followed by one page per receipt image. This is the file the
// user shares to their email to finish matching in Bexio on their computer.
export async function buildReceiptsPdf(company: Company, receipts: Receipt[]): Promise<Blob> {
  // Lazy-load jsPDF so it's only fetched when the user exports, not on app start.
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
  doc.text(`Receipts export${range} · ${receipts.length} item${receipts.length === 1 ? "" : "s"}`, M, y);
  y += 6;

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
  y += 3;

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

  // One page per receipt image.
  for (const r of receipts) {
    if (!r.hasImage) continue;
    const data = await getImage(r.id);
    if (!data) continue;
    doc.addPage();
    let iy = M;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text((`${r.date || ""}  ${r.vendor || ""}`).trim() || "Receipt", M, iy);
    iy += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${money(r.amount, r.currency || "")}   ·   VAT ${(r.vatAmount || 0).toFixed(2)}   ·   Bexio ${r.bexioCode || "—"}`, M, iy);
    iy += 4;
    if (r.description) { doc.text(r.description.slice(0, 95), M, iy); iy += 4; }
    iy += 2;
    const { w, h } = await imgSize(data);
    const scale = Math.min((W - 2 * M) / w, (H - iy - M) / h);
    const fmt = data.startsWith("data:image/png") ? "PNG" : "JPEG";
    try { doc.addImage(data, fmt, M, iy, w * scale, h * scale); } catch { /* skip unreadable image */ }
  }

  return doc.output("blob");
}

// Share the PDF via the native sheet (→ Mail on iOS) or download it.
export async function shareOrDownloadPdf(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: any) => boolean; share?: (d: any) => Promise<void> };
  if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: filename }); return "shared"; } catch { /* fall through to download */ }
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
