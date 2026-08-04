// Move-to-a-new-phone backup. Everything the app knows lives on-device
// (localStorage + the receipt-image IndexedDB), so switching phones needs an
// explicit export/import. The file carries every "vrent.*" key — settings,
// health, money, business, calendar, learned memories, the AI access code and
// the sync keys — plus all receipt images, gzipped.
import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import { getAllImages, putImage } from "./business/images";

const PREFIX = "vrent.";
const MAGIC = "acapp-backup";

export interface BackupInfo { keys: number; images: number; bytes: number }

export async function buildBackup(): Promise<{ blob: Blob; info: BackupInfo }> {
  const ls: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      const v = localStorage.getItem(k);
      if (v != null) ls[k] = v;
    }
  }
  const images = await getAllImages();
  const payload = JSON.stringify({ magic: MAGIC, v: 1, at: Date.now(), ls, images });
  const gz = gzipSync(strToU8(payload), { level: 6 });
  const buf = new ArrayBuffer(gz.byteLength);
  new Uint8Array(buf).set(gz);
  const blob = new Blob([buf], { type: "application/gzip" });
  return { blob, info: { keys: Object.keys(ls).length, images: Object.keys(images).length, bytes: blob.size } };
}

export function backupFilename(): string {
  return `acapp-backup-${new Date().toISOString().slice(0, 10)}.acapp`;
}

// Restores a backup over the current data (existing "vrent.*" keys are
// replaced; other origins' keys untouched). Reload after calling.
export async function restoreBackup(file: File): Promise<BackupInfo> {
  const raw = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = strFromU8(gunzipSync(raw));
  } catch {
    text = strFromU8(raw); // allow an uncompressed .json too
  }
  const data = JSON.parse(text);
  if (data?.magic !== MAGIC || !data.ls) throw new Error("Not an AC App backup file");
  for (const [k, v] of Object.entries(data.ls as Record<string, string>)) {
    if (k.startsWith(PREFIX) && typeof v === "string") localStorage.setItem(k, v);
  }
  let images = 0;
  for (const [id, dataUrl] of Object.entries((data.images || {}) as Record<string, string>)) {
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
      await putImage(id, dataUrl);
      images++;
    }
  }
  return { keys: Object.keys(data.ls).length, images, bytes: raw.byteLength };
}
