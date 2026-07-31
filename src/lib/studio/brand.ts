import { useSyncExternalStore } from "react";

// Brand kit for the AI Studio: everything the generator and renderer need to
// keep output on-brand. Persisted in localStorage (the logo is stored as a
// small PNG data URL, resized on upload so it stays well under quota).

export interface BrandKit {
  name: string;
  handle: string;
  tagline: string;
  about: string;
  primary: string;
  secondary: string;
  language: string; // caption language
  logo: string | null; // PNG data URL (transparency preserved), max 512px
}

const KEY = "vrent.studio.brand.v1";

function defaults(): BrandKit {
  return {
    name: "",
    handle: "",
    tagline: "",
    about: "",
    primary: "#18181b",
    secondary: "#f4f4f5",
    language: "English",
    logo: null,
  };
}

function load(): BrandKit {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      name: typeof p.name === "string" ? p.name : d.name,
      handle: typeof p.handle === "string" ? p.handle : d.handle,
      tagline: typeof p.tagline === "string" ? p.tagline : d.tagline,
      about: typeof p.about === "string" ? p.about : d.about,
      primary: typeof p.primary === "string" ? p.primary : d.primary,
      secondary: typeof p.secondary === "string" ? p.secondary : d.secondary,
      language: typeof p.language === "string" ? p.language : d.language,
      logo: typeof p.logo === "string" ? p.logo : null,
    };
  } catch {
    return d;
  }
}

let state: BrandKit = load();
const listeners = new Set<() => void>();

export function getBrand(): BrandKit {
  return state;
}

export function setBrand(patch: Partial<BrandKit>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useBrand(): BrandKit {
  return useSyncExternalStore(subscribe, getBrand, getBrand);
}

export function brandReady(b: BrandKit): boolean {
  return !!b.name.trim();
}

/** Resize an uploaded logo to a PNG data URL (keeps transparency), max 512px. */
export async function prepareLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/png");
}
