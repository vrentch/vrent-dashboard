import { useSyncExternalStore } from "react";

// Lightweight on-device app lock. A PIN is stored only as a SHA-256 hash in
// localStorage. This deters casual access on a shared/lost phone — it is not
// hardened security (client-side only).

const KEY = "vrent.lock.v1";

let unlocked = false; // session flag (resets on full reload)
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasPasscode(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export async function setPasscode(pin: string): Promise<void> {
  localStorage.setItem(KEY, await sha256(pin));
  unlocked = true;
  emit();
}

export function clearPasscode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  unlocked = true;
  emit();
}

export async function verifyPasscode(pin: string): Promise<boolean> {
  try {
    return (await sha256(pin)) === localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function unlock(): void {
  unlocked = true;
  emit();
}

export function useLocked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => hasPasscode() && !unlocked,
    () => false
  );
}
