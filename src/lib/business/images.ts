// Receipt images are stored in IndexedDB (not localStorage) — they're large and
// there can be many. Keyed by receipt id; value is a data-URL string.
const DB_NAME = "acapp-business";
const STORE = "images";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putImage(id: string, dataUrl: string): Promise<void> {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.put(dataUrl, id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function getImage(id: string): Promise<string | null> {
  const store = await tx("readonly");
  return new Promise((resolve) => {
    const r = store.get(id);
    r.onsuccess = () => resolve((r.result as string) ?? null);
    r.onerror = () => resolve(null);
  });
}

// Everything in the store, keyed by receipt id — used by the phone-transfer
// backup so receipt images travel to a new device.
export async function getAllImages(): Promise<Record<string, string>> {
  const store = await tx("readonly");
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve(out); return; }
      if (typeof c.value === "string") out[String(c.key)] = c.value;
      c.continue();
    };
    req.onerror = () => resolve(out);
  });
}

export async function deleteImage(id: string): Promise<void> {
  const store = await tx("readwrite");
  return new Promise((resolve) => {
    const r = store.delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
  });
}
