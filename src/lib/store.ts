import { useSyncExternalStore } from "react";
import {
  DEFAULT_COUNTRIES,
  DEFAULT_TOPICS,
  DEFAULT_WATCHLIST,
} from "../../shared/catalog";

export interface Prefs {
  countries: string[];
  topics: string[];
  newsQuery: string;
  watchlist: string[];
}

const KEY = "vrent.prefs.v1";

const defaults: Prefs = {
  countries: [...DEFAULT_COUNTRIES],
  topics: [...DEFAULT_TOPICS],
  newsQuery: "",
  watchlist: [...DEFAULT_WATCHLIST],
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries : defaults.countries,
      topics: Array.isArray(parsed.topics) ? parsed.topics : defaults.topics,
      newsQuery: typeof parsed.newsQuery === "string" ? parsed.newsQuery : "",
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : defaults.watchlist,
    };
  } catch {
    return { ...defaults };
  }
}

let state: Prefs = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(patch: Partial<Prefs>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable in private mode */
  }
  emit();
}

export function resetPrefs() {
  setPrefs({ ...defaults });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}

// Convenience toggles ---------------------------------------------------------

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
