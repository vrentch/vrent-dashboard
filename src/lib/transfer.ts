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
  return restoreFromBytes(new Uint8Array(await file.arrayBuffer()));
}

async function restoreFromBytes(raw: Uint8Array): Promise<BackupInfo> {
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

// ── One-button cloud transfer ────────────────────────────────────────────────
// The old phone uploads the backup in chunks under a random code; the new
// phone types the code and pulls it down. The server copy is deleted right
// after the restore succeeds and self-expires after 15 minutes regardless.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const PART_CHARS = 700_000; // base64 chars per upload chunk (~500 KB raw)

function randomTransferCode(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function sendToCloud(onProgress?: (done: number, total: number) => void): Promise<{ code: string; info: BackupInfo }> {
  const { blob, info } = await buildBackup();
  const b64 = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += PART_CHARS) parts.push(b64.slice(i, i + PART_CHARS));
  const code = randomTransferCode();
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch("/api/transfer-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, part: i, total: parts.length, data: parts[i] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !(j as any).ok) throw new Error((j as any).error || "Upload failed — check your connection.");
    onProgress?.(i + 1, parts.length);
  }
  return { code, info };
}

export async function receiveFromCloud(codeRaw: string, onProgress?: (done: number, total: number) => void): Promise<BackupInfo> {
  const code = codeRaw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (code.length !== 8) throw new Error("The code has 8 letters/numbers — check it and try again.");
  let total = 1;
  let b64 = "";
  for (let part = 0; part < total; part++) {
    const res = await fetch(`/api/transfer-down?code=${code}&part=${part}`);
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || "Transfer not found — check the code.");
    total = j.total || 1;
    b64 += j.data;
    onProgress?.(part + 1, total);
  }
  const info = await restoreFromBytes(b64ToBytes(b64));
  // Delete the server copy now that everything is safely on this device.
  fetch("/api/transfer-done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => {});
  return info;
}
