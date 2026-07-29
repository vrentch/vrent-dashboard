import { useSyncExternalStore } from "react";

// VAPID public key (safe to expose). The matching private key lives only in a
// Vercel env var (VAPID_PRIVATE) that you add during setup.
export const VAPID_PUBLIC = "BNxnJi4BuHQzkMrh9pFVr3sJq70P15NklzGvjIJCO3EdA-Kxx3Siwr9aHTzZ3iPBQ8eJOdI4cmyxdT6FkYzuOPU";

export interface PushSettings {
  enabled: boolean;
  marketOpen: boolean;
  marketClose: boolean;
  dailyRecap: boolean;
  recapTime: string; // HH:MM in the device's local time
}

const KEY = "vrent.push.v1";
const defaults: PushSettings = {
  enabled: false,
  marketOpen: true,
  marketClose: false,
  dailyRecap: true,
  recapTime: "18:00",
};

function load(): PushSettings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

let state = load();
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
export function getPushSettings() {
  return state;
}
export function setPushSettings(patch: Partial<PushSettings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  emit();
}
export function usePushSettings(): PushSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function serverConfigured(): Promise<boolean> {
  try {
    const r = await fetch("/api/push-status");
    const j = await r.json();
    return !!j.configured;
  } catch {
    return false;
  }
}

function toUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Ask permission, subscribe, and register with the server. */
export async function enablePush(settings: PushSettings): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "This browser can't do notifications. On iPhone, add AC News to your Home Screen first." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Notification permission was not granted." };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(VAPID_PUBLIC) as BufferSource });
  }
  const res = await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, settings, tz: tz() }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) return { ok: false, reason: j.error || "Server could not register the subscription (is setup complete?)." };
  setPushSettings({ ...settings, enabled: true });
  return { ok: true };
}

/** Push updated toggles/time to the server (when already enabled). */
export async function syncPush(settings: PushSettings): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, settings, tz: tz() }),
  }).catch(() => {});
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await fetch("/api/push-unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  setPushSettings({ enabled: false });
}

export async function sendTestPush(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  const r = await fetch("/api/push-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub }),
  }).catch(() => null);
  return !!r && r.ok;
}
