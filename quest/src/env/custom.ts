/**
 * Operator-uploaded 360° environments (Enterprise edition).
 *
 * An operator drops their own equirectangular photography onto the headset and
 * it becomes a playable room, surviving a restart without a round trip to any
 * server. That means IndexedDB, and it means storing the **Blob** — an 8K
 * equirect is 20–40 MB, and base64 in `localStorage` would blow the origin
 * quota several times over before the first image finished saving.
 *
 * Everything that can go wrong with a stranger's file is turned into a typed
 * `CustomPanoramaError`, so the UI can say something useful instead of failing
 * silently in front of a client:
 *
 *   unsupported   this browser has no IndexedDB (private window, locked-down MDM)
 *   not-an-image  the file is not an image, or will not decode
 *   aspect        not a 2:1 equirectangular projection
 *   too-large     beyond the ingest ceiling even before decoding
 *   quota         the headset is out of storage
 *   storage       IndexedDB refused the read or write
 *   not-found     no panorama with that id
 *
 * Images wider than 8192 px are downscaled on the way in: a Quest 3 samples an
 * 8K equirect at full quality and gains nothing from 16K but VRAM pressure.
 */

import { customToSpec, type CustomPanorama, type EnvironmentSpec } from "../../shared/environments.ts";

// ── Limits ──────────────────────────────────────────────────────────────────

/** Widest image kept as-is. Anything larger is resampled down to this. */
export const MAX_PANORAMA_WIDTH = 8192;
/** Hard ingest ceiling, checked before decoding so a bad file fails fast. */
export const MAX_PANORAMA_BYTES = 64 * 1024 * 1024;
/** Equirectangular means 2:1. Allow a couple of percent for odd exporters. */
const ASPECT_TOLERANCE = 0.02;
const TARGET_ASPECT = 2;

const DB_NAME = "vrent-memory-xr";
const DB_VERSION = 1;
const STORE = "panoramas";
const ID_PREFIX = "custom-";

// ── Errors ──────────────────────────────────────────────────────────────────

export type CustomPanoramaErrorCode =
  | "unsupported"
  | "not-an-image"
  | "aspect"
  | "too-large"
  | "quota"
  | "storage"
  | "not-found";

export class CustomPanoramaError extends Error {
  readonly code: CustomPanoramaErrorCode;
  constructor(code: CustomPanoramaErrorCode, message: string) {
    super(message);
    this.name = "CustomPanoramaError";
    this.code = code;
  }
}

// ── Storage record ──────────────────────────────────────────────────────────

interface PanoramaRecord {
  id: string;
  name: string;
  addedAt: number;
  width: number;
  height: number;
  type: string;
  bytes: number;
  blob: Blob;
}

/** What is on disk, without handing out the Blob itself. */
export interface CustomPanoramaInfo {
  id: string;
  name: string;
  addedAt: number;
  width: number;
  height: number;
  bytes: number;
}

// ── IndexedDB plumbing ──────────────────────────────────────────────────────

export function customPanoramaSupported(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!customPanoramaSupported()) {
    return Promise.reject(
      new CustomPanoramaError("unsupported", "This browser cannot store custom environments."),
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema must not leave us on a stale handle.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(new CustomPanoramaError("storage", request.error?.message ?? "IndexedDB refused to open."));
    request.onblocked = () =>
      reject(new CustomPanoramaError("storage", "Another tab is holding the environment store open."));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE, mode);
        } catch (err) {
          reject(new CustomPanoramaError("storage", describe(err)));
          return;
        }
        const request = body(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        tx.onerror = () => reject(toStorageError(tx.error ?? request.error));
        tx.onabort = () => reject(toStorageError(tx.error ?? request.error));
      }),
  );
}

function toStorageError(err: DOMException | null): CustomPanoramaError {
  if (err && err.name === "QuotaExceededError") {
    return new CustomPanoramaError(
      "quota",
      "The headset is out of storage. Remove an environment and try again.",
    );
  }
  return new CustomPanoramaError("storage", err?.message ?? "The environment store rejected the write.");
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Object URLs ─────────────────────────────────────────────────────────────

/**
 * Blob URLs stay alive for the life of the session; revoking one that a scene
 * is still sampling would blank the room, so they are only released when the
 * panorama is deleted or the caller explicitly tears the list down.
 */
const liveUrls = new Map<string, string>();

function urlFor(record: PanoramaRecord): string {
  const existing = liveUrls.get(record.id);
  if (existing) return existing;
  const url = URL.createObjectURL(record.blob);
  liveUrls.set(record.id, url);
  return url;
}

function releaseUrl(id: string): void {
  const url = liveUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    liveUrls.delete(id);
  }
}

/** Revokes every blob URL handed out so far. Call on teardown. */
export function releaseCustomPanoramas(): void {
  for (const url of liveUrls.values()) URL.revokeObjectURL(url);
  liveUrls.clear();
}

// ── Decoding and resampling ─────────────────────────────────────────────────

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path — some encoders trip createImageBitmap.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new CustomPanoramaError("not-an-image", `That file could not be decoded (${describe(err)}).`);
  }
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement } {
  if (typeof OffscreenCanvas === "function") {
    return { canvas: new OffscreenCanvas(width, height) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas };
}

function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new CustomPanoramaError("not-an-image", "Re-encoding failed.")),
        "image/jpeg",
        quality,
      );
    });
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

/**
 * Resamples down to `MAX_PANORAMA_WIDTH` in halving steps. A single giant
 * `drawImage` downscale aliases badly; halving keeps the horizon clean.
 */
async function downscale(decoded: Decoded, targetWidth: number): Promise<Blob> {
  let width = decoded.width;
  let height = decoded.height;
  let source: CanvasImageSource = decoded.source;
  let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;

  while (width > targetWidth) {
    const nextWidth = Math.max(targetWidth, Math.round(width / 2));
    const nextHeight = Math.max(1, Math.round((nextWidth / width) * height));
    const { canvas } = makeCanvas(nextWidth, nextHeight);
    const g = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!g) throw new CustomPanoramaError("not-an-image", "No 2D canvas available for resampling.");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(source, 0, 0, nextWidth, nextHeight);
    source = canvas as unknown as CanvasImageSource;
    scratch = canvas;
    width = nextWidth;
    height = nextHeight;
  }

  if (!scratch) throw new CustomPanoramaError("not-an-image", "Nothing to resample.");
  return canvasToBlob(scratch, 0.92);
}

// ── Naming ──────────────────────────────────────────────────────────────────

function niceName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const words = stem
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "Custom 360";
  const titled = words
    .split(" ")
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return titled.length > 48 ? `${titled.slice(0, 47).trimEnd()}…` : titled;
}

function newId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return ID_PREFIX + uuid;
}

/** True for ids minted by this module, so callers can tell them from catalogue ids. */
export function isCustomPanoramaId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

// ── Public API ──────────────────────────────────────────────────────────────

function toPanorama(record: PanoramaRecord): CustomPanorama {
  return { id: record.id, name: record.name, src: urlFor(record), addedAt: record.addedAt };
}

/**
 * Validates, resamples if needed, and stores one uploaded equirectangular image.
 * Resolves with an entry ready to hand to `customToSpec()`.
 */
export async function addCustomPanorama(file: File): Promise<CustomPanorama> {
  if (!customPanoramaSupported()) {
    throw new CustomPanoramaError("unsupported", "This browser cannot store custom environments.");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new CustomPanoramaError("not-an-image", `${file.name} is not an image.`);
  }
  if (file.size > MAX_PANORAMA_BYTES) {
    throw new CustomPanoramaError(
      "too-large",
      `${file.name} is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${
        MAX_PANORAMA_BYTES / 1048576
      } MB.`,
    );
  }

  const decoded = await decode(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new CustomPanoramaError("not-an-image", `${file.name} has no usable image data.`);
    }

    const aspect = decoded.width / decoded.height;
    if (Math.abs(aspect - TARGET_ASPECT) / TARGET_ASPECT > ASPECT_TOLERANCE) {
      throw new CustomPanoramaError(
        "aspect",
        `A 360° environment must be a 2:1 equirectangular image. ${file.name} is ${decoded.width}×${decoded.height} (${aspect.toFixed(2)}:1).`,
      );
    }

    let blob: Blob = file;
    let width = decoded.width;
    let height = decoded.height;
    if (decoded.width > MAX_PANORAMA_WIDTH) {
      blob = await downscale(decoded, MAX_PANORAMA_WIDTH);
      width = MAX_PANORAMA_WIDTH;
      height = Math.round(MAX_PANORAMA_WIDTH / 2);
    }

    const record: PanoramaRecord = {
      id: newId(),
      name: niceName(file.name),
      addedAt: Date.now(),
      width,
      height,
      type: blob.type || "image/jpeg",
      bytes: blob.size,
      blob,
    };

    await runTransaction<IDBValidKey>("readwrite", (store) => store.put(record));
    return toPanorama(record);
  } finally {
    decoded.release();
  }
}

/** Every stored panorama, newest first, each with a live blob URL. */
export async function listCustomPanoramas(): Promise<CustomPanorama[]> {
  if (!customPanoramaSupported()) return [];
  try {
    const records = await runTransaction<PanoramaRecord[]>("readonly", (store) => store.getAll());
    return records.sort((a, b) => b.addedAt - a.addedAt).map(toPanorama);
  } catch (err) {
    if (err instanceof CustomPanoramaError && err.code === "unsupported") return [];
    throw err;
  }
}

/** One stored panorama, or `null`. */
export async function getCustomPanorama(id: string): Promise<CustomPanorama | null> {
  if (!customPanoramaSupported()) return null;
  const record = await runTransaction<PanoramaRecord | undefined>("readonly", (store) => store.get(id));
  return record ? toPanorama(record) : null;
}

/** Deletes one panorama and releases its blob URL. */
export async function removeCustomPanorama(id: string): Promise<void> {
  if (!customPanoramaSupported()) {
    throw new CustomPanoramaError("unsupported", "This browser cannot store custom environments.");
  }
  const existing = await runTransaction<PanoramaRecord | undefined>("readonly", (store) => store.get(id));
  if (!existing) throw new CustomPanoramaError("not-found", `No custom environment with id ${id}.`);
  await runTransaction<undefined>("readwrite", (store) => store.delete(id));
  releaseUrl(id);
}

/** Deletes every stored panorama. Used by "reset this headset". */
export async function clearCustomPanoramas(): Promise<void> {
  if (!customPanoramaSupported()) return;
  await runTransaction<undefined>("readwrite", (store) => store.clear());
  releaseCustomPanoramas();
}

/** Metadata only — for a storage readout in the operator settings panel. */
export async function customPanoramaUsage(): Promise<{ count: number; bytes: number; items: CustomPanoramaInfo[] }> {
  if (!customPanoramaSupported()) return { count: 0, bytes: 0, items: [] };
  const records = await runTransaction<PanoramaRecord[]>("readonly", (store) => store.getAll());
  const items = records
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(({ id, name, addedAt, width, height, bytes }) => ({ id, name, addedAt, width, height, bytes }));
  return { count: items.length, bytes: items.reduce((sum, i) => sum + i.bytes, 0), items };
}

/** The stored panoramas as environment specs, ready to append to the picker. */
export async function customPanoramaSpecs(): Promise<EnvironmentSpec[]> {
  const stored = await listCustomPanoramas();
  return stored.map(customToSpec);
}
