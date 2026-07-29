import { useSyncExternalStore } from "react";

export interface CalEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (start day)
  allDay: boolean;
  start?: string; // HH:MM
  end?: string; // HH:MM
  category: string; // category key
  location?: string;
  notes?: string;
  remind?: number | null; // minutes before start (null = none)
  done?: boolean; // for to-dos / deadlines
}

export interface Category {
  key: string;
  label: string;
  color: string; // hex
}

export const CATEGORIES: Category[] = [
  { key: "work", label: "Work", color: "#2563eb" },
  { key: "meeting", label: "Meeting", color: "#7c3aed" },
  { key: "deadline", label: "Deadline", color: "#e11d48" },
  { key: "finance", label: "Finance", color: "#d97706" },
  { key: "personal", label: "Personal", color: "#059669" },
  { key: "other", label: "Other", color: "#64748b" },
];

export function categoryOf(key: string): Category {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1];
}

export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At start time" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

const KEY = "vrent.calendar.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

function load(): CalEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let state: CalEvent[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function useEvents(): CalEvent[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}

export function saveEvent(ev: Omit<CalEvent, "id"> & { id?: string }): string {
  if (ev.id && state.some((e) => e.id === ev.id)) {
    state = state.map((e) => (e.id === ev.id ? ({ ...e, ...ev } as CalEvent) : e));
    persist();
    return ev.id;
  }
  const id = ev.id || uid();
  state = [...state, { ...ev, id }];
  persist();
  return id;
}

export function deleteEvent(id: string) {
  state = state.filter((e) => e.id !== id);
  persist();
}

export function toggleDone(id: string) {
  state = state.map((e) => (e.id === id ? { ...e, done: !e.done } : e));
  persist();
}

// Date helpers ----------------------------------------------------------------

export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toKey(new Date());
}

function sortEvents(list: CalEvent[]): CalEvent[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.allDay ? "" : a.start || "";
    const bt = b.allDay ? "" : b.start || "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

export function eventsOn(events: CalEvent[], dateKey: string): CalEvent[] {
  return sortEvents(events.filter((e) => e.date === dateKey));
}

export function upcoming(events: CalEvent[], fromKey: string): CalEvent[] {
  return sortEvents(events.filter((e) => e.date >= fromKey));
}
