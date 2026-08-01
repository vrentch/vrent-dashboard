// Render an uploaded PDF invoice (e.g. a Meta invoice saved from email) to an
// image so it flows through the exact same pipeline as a photo: AI reads it,
// it's stored, and it lands in the combined export PDF. This whole module is
// only ever dynamically imported, so pdf.js is fetched lazily — users who only
// snap photos never pay for it.
import * as pdfjs from "pdfjs-dist";
// Vite bundles this as a separate worker chunk and wires the URL for us.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

// Render the first page at enough resolution for the vision model to read the
// small print, returning a JPEG data URL.
export async function renderPdfFirstPage(file: File, maxDim = 1700): Promise<string> {
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, maxDim / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    // White backdrop so transparent PDFs don't render on black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    doc.destroy();
  }
}
