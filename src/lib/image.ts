// Downscale a captured photo to a base64 JPEG before sending to the AI — keeps
// requests small, fast, and cheap. Honors EXIF orientation (iPhone photos are
// often rotated) via createImageBitmap when available.

export interface PreparedImage {
  base64: string; // no data-URL prefix
  dataUrl: string; // for preview
  mediaType: "image/jpeg";
}

export async function prepareImage(file: File, maxDim = 1024, quality = 0.8): Promise<PreparedImage> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.split(",")[1] || "";
  return { base64, dataUrl, mediaType: "image/jpeg" };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = url;
    });
    return img;
  } finally {
    // Revoke after the image has loaded and been drawn by the caller; small delay.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
