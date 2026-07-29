import { useSyncExternalStore } from "react";
import {
  DEFAULT_COUNTRIES,
  DEFAULT_TOPICS,
  DEFAULT_WATCHLIST,
} from "../../shared/catalog";

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export type Theme = "light" | "dark" | "system";

export interface Prefs {
  countries: string[];
  topics: string[];
  newsQuery: string;
  recentSearches: string[];
  watchlists: Watchlist[];
  activeWatchlistId: string;
  // Mirror of the active watchlist's symbols — kept in sync so existing reads
  // of `prefs.watchlist` keep working across the app.
  watchlist: string[];
  theme: Theme;
}

const KEY = "vrent.prefs.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `wl_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

function baseDefaults(): Prefs {
  const list: Watchlist = { id: "default", name: "My list", symbols: [...DEFAULT_WATCHLIST] };
  return {
    countries: [...DEFAULT_COUNTRIES],
    topics: [...DEFAULT_TOPICS],
    newsQuery: "",
    recentSearches: [],
    watchlists: [list],
    activeWatchlistId: list.id,
    watchlist: [...list.symbols],
    theme: "system",
  };
}

function normalize(p: Prefs): Prefs {
  let watchlists = Array.isArray(p.watchlists) && p.watchlists.length ? p.watchlists : baseDefaults().watchlists;
  let active = watchlists.find((w) => w.id === p.activeWatchlistId) || watchlists[0];
  return { ...p, watchlists, activeWatchlistId: active.id, watchlist: [...active.symbols] };
}

function load(): Prefs {
  const d = baseDefaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw);

    // Migrate a single legacy `watchlist` into a named list.
    let watchlists: Watchlist[];
    if (Array.isArray(parsed.watchlists) && parsed.watchlists.length) {
      watchlists = parsed.watchlists;
    } else {
      const syms = Array.isArray(parsed.watchlist) ? parsed.watchlist : d.watchlist;
      watchlists = [{ id: "default", name: "My list", symbols: syms }];
    }

    return normalize({
      countries: Array.isArray(parsed.countries) ? parsed.countries : d.countries,
      topics: Array.isArray(parsed.topics) ? parsed.topics : d.topics,
      newsQuery: typeof parsed.newsQuery === "string" ? parsed.newsQuery : "",
      recentSearches: Array.isArray(parsed.recentSearches) ? parsed.recentSearches : [],
      watchlists,
      activeWatchlistId: typeof parsed.activeWatchlistId === "string" ? parsed.activeWatchlistId : watchlists[0].id,
      watchlist: [],
      theme: parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : "system",
    });
  } catch {
    return d;
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
  let next: Prefs = { ...state, ...patch };
  // A legacy `watchlist` write routes into the active list.
  if (patch.watchlist) {
    next.watchlists = next.watchlists.map((w) =>
      w.id === next.activeWatchlistId ? { ...w, symbols: patch.watchlist as string[] } : w
    );
  }
  next = normalize(next);
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable */
  }
  emit();
}

export function resetPrefs() {
  setPrefs(baseDefaults());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}

// Watchlist helpers -----------------------------------------------------------

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function activeWatchlist(p: Prefs): Watchlist {
  return p.watchlists.find((w) => w.id === p.activeWatchlistId) || p.watchlists[0];
}

export function toggleWatchlist(symbol: string) {
  setPrefs({ watchlist: toggleInList(state.watchlist, symbol) });
}

export function setActiveWatchlist(id: string) {
  setPrefs({ activeWatchlistId: id });
}

export function createWatchlist(name: string): string {
  const id = uid();
  const list: Watchlist = { id, name: name.trim() || "New list", symbols: [] };
  setPrefs({ watchlists: [...state.watchlists, list], activeWatchlistId: id });
  return id;
}

export function renameWatchlist(id: string, name: string) {
  setPrefs({ watchlists: state.watchlists.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)) });
}

export function deleteWatchlist(id: string) {
  let lists = state.watchlists.filter((w) => w.id !== id);
  if (!lists.length) lists = baseDefaults().watchlists;
  const active = state.activeWatchlistId === id ? lists[0].id : state.activeWatchlistId;
  setPrefs({ watchlists: lists, activeWatchlistId: active });
}

export function addRecentSearch(term: string) {
  const t = term.trim();
  if (!t) return;
  const next = [t, ...state.recentSearches.filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, 8);
  setPrefs({ recentSearches: next });
}
