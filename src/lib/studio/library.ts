import { useEffect, useState } from "react";
import type { StudioPackage } from "../api";

// The Studio library: every generation (source photos + AI package + rendered
// images) is saved locally in IndexedDB, organized under the category the AI
// assigned. IndexedDB (not localStorage) because items carry image data URLs.

export interface LibraryItem {
  id: string;
  createdAt: number;
  category: string; // AI-assigned
  prompt: string;
  concept: string;
  photos: string[]; // source photo data URLs (downscaled)
  pkg: StudioPackage;
  renders: { post?: string; story?: string; cover?: string }; // JPEG data URLs
}

const DB_NAME = "vrent-studio";
const STORE = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export async function saveItem(item: LibraryItem): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
  emit();
}

export async function deleteItem(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  emit();
}

export async function listItems(): Promise<LibraryItem[]> {
  try {
    const all = await tx<LibraryItem[]>("readonly", (s) => s.getAll() as IDBRequest<LibraryItem[]>);
    return (all || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** All items, newest first, reloaded whenever the library changes. */
export function useLibrary(): { items: LibraryItem[]; loading: boolean } {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const reload = () =>
      listItems().then((it) => {
        if (alive) {
          setItems(it);
          setLoading(false);
        }
      });
    reload();
    listeners.add(reload);
    return () => {
      alive = false;
      listeners.delete(reload);
    };
  }, []);
  return { items, loading };
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `it_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Group items by their AI-assigned category, biggest groups first. */
export function groupByCategory(items: LibraryItem[]): { category: string; items: LibraryItem[] }[] {
  const map = new Map<string, LibraryItem[]>();
  for (const it of items) {
    const key = it.category || "General";
    const list = map.get(key) || [];
    list.push(it);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([category, list]) => ({ category, items: list }))
    .sort((a, b) => b.items.length - a.items.length);
}
