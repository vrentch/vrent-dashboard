import { useSyncExternalStore } from "react";

// ── The Daily Game ──────────────────────────────────────────────────────────
// You set targets, you log them, and at 22:00 the day is scored. A rival
// "ghost" that scales with your own recent form plays the same day against
// you, so there is always something to beat.
//
// Design rule that everything else leans on: **this store holds only facts**
// — your targets, what you logged, your settings. Every score, streak, XP
// number, badge and medal is *derived* from those facts by pure functions
// (scoring.ts / achievements.ts). Nothing is accumulated incrementally, so
// fixing a forgotten entry re-scores the day honestly instead of leaving a
// stale total behind.

export type Priority = "low" | "normal" | "high" | "must";
export type Horizon = "day" | "week" | "month" | "quarter" | "year";
export type Renewal = "none" | "weekly" | "monthly" | "quarterly" | "yearly";
export type CadenceKind = "daily" | "weekdays" | "weekends" | "days" | "timesPerWeek" | "timesPerMonth" | "once";
export type Difficulty = "easy" | "fair" | "rival" | "nemesis";

/** How often a target comes due. */
export interface Cadence {
  kind: CadenceKind;
  days?: number[]; // 0=Sun … 6=Sat — for "days"
  times?: number;  // for timesPerWeek / timesPerMonth
  date?: string;   // for "once" (a single deadline)
}

export interface Target {
  id: string;
  title: string;
  emoji: string;
  category: string;
  /** "check" = done / not done. "number" = log a figure against a goal. */
  measure: "check" | "number";
  unit: string;                 // "min", "km", "calls", "pages", "CHF" …
  goal: number;                 // per-day goal (a check is always 1)
  direction: "atLeast" | "atMost"; // atMost = a limit you stay under
  priority: Priority;           // drives how much the day score weighs it
  cadence: Cadence;
  /** The timeline this target serves. Beyond "day" it also runs a campaign
   *  bar: the daily logs add up across the calendar week/month/quarter/year. */
  horizon: Horizon;
  campaignGoal?: number;        // total for the horizon period (horizon > day)
  startDate: string;            // YYYY-MM-DD
  endDate?: string;             // optional finish line
  renewal: Renewal;             // what happens when the end date passes
  archived: boolean;            // removed from play, history kept
  createdAt: number;
  updatedAt: number;
  note?: string;
}

/** One logged value per target per day (replaced, not appended, on edit). */
export interface LogEntry {
  value: number;
  at: number;      // last touched
  firstAt: number; // first touched — lets us tell an early finisher apart
}

export type Logs = Record<string, Record<string, LogEntry>>; // date → targetId → entry

export interface GameSettings {
  closeTime: string;   // "22:00" — when the day is sealed and scored
  rivalName: string;
  rivalEmoji: string;
  difficulty: Difficulty;
  streakGoal: number;  // day score that keeps a streak alive
  seed: string;        // makes the rival's daily form deterministic but yours
  startedOn: string;
  lateEdits: boolean;  // keep logging after close (until midnight) and re-score
}

export interface GameMeta {
  verdictSeen: string[]; // days whose verdict animation already played
  badgesSeen: string[];  // achievements already celebrated
  onboarded: boolean;
}

export interface GameState {
  targets: Target[];
  logs: Logs;
  settings: GameSettings;
  meta: GameMeta;
}

// ── Categories ──────────────────────────────────────────────────────────────

export interface Category {
  key: string;
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { key: "business", label: "Business", emoji: "💼", color: "#6366f1" },
  { key: "body", label: "Body", emoji: "💪", color: "#f43f5e" },
  { key: "mind", label: "Mind", emoji: "🧠", color: "#8b5cf6" },
  { key: "money", label: "Money", emoji: "💰", color: "#10b981" },
  { key: "people", label: "People", emoji: "🤝", color: "#f59e0b" },
  { key: "craft", label: "Craft", emoji: "🎨", color: "#06b6d4" },
];

export function categoryOf(key: string): Category {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
}

// ── Priorities ──────────────────────────────────────────────────────────────

export const PRIORITIES: { key: Priority; label: string; weight: number; short: string; color: string }[] = [
  { key: "low", label: "Nice to have", weight: 1, short: "Low", color: "#94a3b8" },
  { key: "normal", label: "Normal", weight: 2, short: "Normal", color: "#6366f1" },
  { key: "high", label: "Important", weight: 3, short: "High", color: "#f59e0b" },
  { key: "must", label: "Non-negotiable", weight: 5, short: "Must", color: "#f43f5e" },
];

export function priorityOf(key: Priority) {
  return PRIORITIES.find((p) => p.key === key) || PRIORITIES[1];
}

export function weightOf(t: Target): number {
  return priorityOf(t.priority).weight;
}

// ── Date helpers ────────────────────────────────────────────────────────────

export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toKey(new Date());
}

export function fromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Month arithmetic that never rolls over (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(key: string, n: number): string {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);
}

/** Monday-start week, matching the rest of the app. */
export function startOfWeek(key: string): string {
  const d = fromKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toKey(d);
}

export function endOfWeek(key: string): string {
  return addDays(startOfWeek(key), 6);
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: string): string {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function startOfQuarter(key: string): string {
  const d = fromKey(key);
  const q = Math.floor(d.getMonth() / 3) * 3;
  return toKey(new Date(d.getFullYear(), q, 1));
}

export function endOfQuarter(key: string): string {
  const d = fromKey(key);
  const q = Math.floor(d.getMonth() / 3) * 3;
  return toKey(new Date(d.getFullYear(), q + 3, 0));
}

export function startOfYear(key: string): string {
  return `${key.slice(0, 4)}-01-01`;
}

export function endOfYear(key: string): string {
  return `${key.slice(0, 4)}-12-31`;
}

export interface Period {
  start: string;
  end: string;
  label: string;
}

/** The calendar period a horizon rides on, for campaign progress. */
export function periodFor(horizon: Horizon, key: string): Period {
  const d = fromKey(key);
  switch (horizon) {
    case "week":
      return { start: startOfWeek(key), end: endOfWeek(key), label: "this week" };
    case "month":
      return { start: startOfMonth(key), end: endOfMonth(key), label: d.toLocaleDateString(undefined, { month: "long" }) };
    case "quarter":
      return { start: startOfQuarter(key), end: endOfQuarter(key), label: `Q${Math.floor(d.getMonth() / 3) + 1}` };
    case "year":
      return { start: startOfYear(key), end: endOfYear(key), label: key.slice(0, 4) };
    default:
      return { start: key, end: key, label: "today" };
  }
}

export function weekKey(key: string): string {
  return startOfWeek(key);
}

export function monthKey(key: string): string {
  return key.slice(0, 7);
}

export function yearKey(key: string): string {
  return key.slice(0, 4);
}

export function prettyDay(key: string): string {
  return fromKey(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Minutes past midnight for an "HH:MM" string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = (hhmm || "22:00").split(":").map((n) => parseInt(n, 10));
  return (isFinite(h) ? h : 22) * 60 + (isFinite(m) ? m : 0);
}

// ── Schedule: windows, renewal and what is due ──────────────────────────────

const RENEWAL_LABEL: Record<Renewal, string> = {
  none: "no renewal",
  weekly: "renews weekly",
  monthly: "renews monthly",
  quarterly: "renews quarterly",
  yearly: "renews yearly",
};

export function renewalLabel(r: Renewal): string {
  return RENEWAL_LABEL[r] || RENEWAL_LABEL.none;
}

function shiftPeriod(key: string, renewal: Renewal, n: number): string {
  switch (renewal) {
    case "weekly": return addDays(key, 7 * n);
    case "monthly": return addMonths(key, n);
    case "quarterly": return addMonths(key, 3 * n);
    case "yearly": return addMonths(key, 12 * n);
    default: return key;
  }
}

export interface Term {
  start: string;
  end: string | null; // null = open-ended
  index: number;      // 0 = the original term, 1 = first renewal, …
}

/**
 * The term a target is serving on a given day — `null` when it hasn't started,
 * has finished, or sits in a gap between terms. A target with an end date and
 * a renewal mode keeps coming back: the whole window shifts forward by the
 * renewal period, so "Q4 campaign, renews quarterly" reappears in Q1.
 */
export function termOn(t: Target, key: string): Term | null {
  if (key < t.startDate) return null;
  if (!t.endDate) return { start: t.startDate, end: null, index: 0 };
  if (key <= t.endDate) return { start: t.startDate, end: t.endDate, index: 0 };
  if (t.renewal === "none") return null;
  // Walk forward through renewals. Bounded so a malformed target can't spin.
  for (let i = 1; i <= 400; i++) {
    const start = shiftPeriod(t.startDate, t.renewal, i);
    const end = shiftPeriod(t.endDate, t.renewal, i);
    if (key < start) return null;       // in the gap before the next term
    if (key <= end) return { start, end, index: i };
  }
  return null;
}

export function isAliveOn(t: Target, key: string): boolean {
  return !t.archived && termOn(t, key) != null;
}

/** A flexible target ("3× a week") has a quota rather than fixed days. */
export function isFlexible(t: Target): boolean {
  return t.cadence.kind === "timesPerWeek" || t.cadence.kind === "timesPerMonth";
}

/** Does the cadence put this target on the board on this date? */
export function matchesCadence(t: Target, key: string): boolean {
  const dow = fromKey(key).getDay();
  const c = t.cadence;
  switch (c.kind) {
    case "daily": return true;
    case "weekdays": return dow >= 1 && dow <= 5;
    case "weekends": return dow === 0 || dow === 6;
    case "days": return (c.days || []).includes(dow);
    case "once": return c.date === key;
    case "timesPerWeek":
    case "timesPerMonth": return true; // quota — availability decided below
    default: return true;
  }
}

/** Targets that can be logged on a date (required or optional). */
export function targetsOn(state: GameState, key: string): Target[] {
  return state.targets.filter((t) => isAliveOn(t, key) && matchesCadence(t, key));
}

export function logValue(state: GameState, key: string, targetId: string): number {
  return state.logs[key]?.[targetId]?.value ?? 0;
}

export function logEntry(state: GameState, key: string, targetId: string): LogEntry | undefined {
  return state.logs[key]?.[targetId];
}

/** How many days in a quota window are already satisfied. */
export function quotaDone(state: GameState, t: Target, key: string): number {
  const p = periodFor(t.cadence.kind === "timesPerMonth" ? "month" : "week", key);
  let n = 0;
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
    const v = logValue(state, d, t.id);
    if (hits(t, v)) n++;
  }
  return n;
}

/** Did a logged value satisfy the target for one day? */
export function hits(t: Target, value: number): boolean {
  if (t.direction === "atMost") return value <= t.goal;
  return value >= (t.measure === "check" ? 1 : t.goal);
}

/**
 * A quota target turns mandatory once you can no longer afford to skip it:
 * with 2 sessions left and 2 days to go, today is required. Before that it is
 * on the board as optional — doing it early banks bonus points.
 */
export function isRequiredOn(state: GameState, t: Target, key: string): boolean {
  if (!isAliveOn(t, key) || !matchesCadence(t, key)) return false;
  if (!isFlexible(t)) return true;
  const monthly = t.cadence.kind === "timesPerMonth";
  const p = periodFor(monthly ? "month" : "week", key);
  const need = Math.max(1, t.cadence.times || 1) - quotaDone(state, t, key);
  if (need <= 0) return false;                        // quota already met
  const daysLeft = daysBetween(key, p.end) + 1;       // including today
  return need >= daysLeft;
}

// ── Persistence ─────────────────────────────────────────────────────────────

const KEY = "vrent.game.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `g_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36);
}

export const RIVALS: { name: string; emoji: string }[] = [
  { name: "Nemo", emoji: "👾" },
  { name: "Shadow", emoji: "🥷" },
  { name: "Echo", emoji: "👻" },
  { name: "Volt", emoji: "⚡" },
  { name: "Rex", emoji: "🦖" },
  { name: "Kuro", emoji: "🐺" },
];

function defaults(): GameState {
  return {
    targets: [],
    logs: {},
    settings: {
      closeTime: "22:00",
      rivalName: "Nemo",
      rivalEmoji: "👾",
      difficulty: "fair",
      streakGoal: 70,
      seed: randomSeed(),
      startedOn: todayKey(),
      lateEdits: true,
    },
    meta: { verdictSeen: [], badgesSeen: [], onboarded: false },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown, fallback: number): number {
  const f = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(f) ? f : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function normalizeTarget(raw: any): Target | null {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, "").trim();
  if (!title) return null;
  const measure: Target["measure"] = raw.measure === "number" ? "number" : "check";
  const kind: CadenceKind = ["daily", "weekdays", "weekends", "days", "timesPerWeek", "timesPerMonth", "once"].includes(raw?.cadence?.kind)
    ? raw.cadence.kind
    : "daily";
  const horizon: Horizon = ["day", "week", "month", "quarter", "year"].includes(raw.horizon) ? raw.horizon : "day";
  const start = DATE_RE.test(raw.startDate) ? raw.startDate : todayKey();
  const end = DATE_RE.test(raw.endDate) ? raw.endDate : undefined;
  const direction: Target["direction"] = raw.direction === "atMost" ? "atMost" : "atLeast";
  // A tick-box target's goal is implied: 1 for "do it", 0 for "avoid it" —
  // the latter starts the day satisfied and is broken by logging a slip.
  const goal = measure === "check" ? (direction === "atMost" ? 0 : 1) : Math.max(0, num(raw.goal, 1));
  return {
    id: str(raw.id, uid()),
    title: title.slice(0, 80),
    emoji: str(raw.emoji, "🎯").slice(0, 4),
    category: CATEGORIES.some((c) => c.key === raw.category) ? raw.category : "business",
    measure,
    unit: str(raw.unit, measure === "number" ? "x" : "").slice(0, 12),
    goal,
    direction,
    priority: ["low", "normal", "high", "must"].includes(raw.priority) ? raw.priority : "normal",
    cadence: {
      kind,
      days: Array.isArray(raw?.cadence?.days) ? raw.cadence.days.map((d: any) => num(d, 0)).filter((d: number) => d >= 0 && d <= 6) : undefined,
      times: Math.max(1, Math.round(num(raw?.cadence?.times, 3))),
      date: DATE_RE.test(raw?.cadence?.date) ? raw.cadence.date : kind === "once" ? start : undefined,
    },
    horizon,
    campaignGoal: raw.campaignGoal != null ? Math.max(0, num(raw.campaignGoal, 0)) : undefined,
    startDate: start,
    endDate: end && end >= start ? end : undefined,
    renewal: ["none", "weekly", "monthly", "quarterly", "yearly"].includes(raw.renewal) ? raw.renewal : "none",
    archived: !!raw.archived,
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.slice(0, 280) : undefined,
  };
}

function normalizeLogs(raw: any): Logs {
  const out: Logs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [date, byTarget] of Object.entries(raw)) {
    if (!DATE_RE.test(date) || !byTarget || typeof byTarget !== "object") continue;
    const row: Record<string, LogEntry> = {};
    for (const [id, e] of Object.entries(byTarget as Record<string, any>)) {
      const value = num(e?.value, NaN);
      if (!isFinite(value)) continue;
      const at = num(e?.at, 0);
      row[id] = { value, at, firstAt: num(e?.firstAt, at) };
    }
    if (Object.keys(row).length) out[date] = row;
  }
  return out;
}

function load(): GameState {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    const targets = Array.isArray(p.targets) ? (p.targets.map(normalizeTarget).filter(Boolean) as Target[]) : [];
    return {
      targets,
      logs: normalizeLogs(p.logs),
      settings: {
        closeTime: /^\d{1,2}:\d{2}$/.test(p?.settings?.closeTime) ? p.settings.closeTime : d.settings.closeTime,
        rivalName: str(p?.settings?.rivalName, d.settings.rivalName).slice(0, 18),
        rivalEmoji: str(p?.settings?.rivalEmoji, d.settings.rivalEmoji).slice(0, 4),
        difficulty: ["easy", "fair", "rival", "nemesis"].includes(p?.settings?.difficulty) ? p.settings.difficulty : "fair",
        streakGoal: Math.max(10, Math.min(100, Math.round(num(p?.settings?.streakGoal, d.settings.streakGoal)))),
        seed: str(p?.settings?.seed, d.settings.seed),
        startedOn: DATE_RE.test(p?.settings?.startedOn) ? p.settings.startedOn : d.settings.startedOn,
        lateEdits: p?.settings?.lateEdits !== false,
      },
      meta: {
        verdictSeen: Array.isArray(p?.meta?.verdictSeen) ? p.meta.verdictSeen.filter((x: any) => DATE_RE.test(x)).slice(-60) : [],
        badgesSeen: Array.isArray(p?.meta?.badgesSeen) ? p.meta.badgesSeen.filter((x: any) => typeof x === "string").slice(-200) : [],
        onboarded: !!p?.meta?.onboarded,
      },
    };
  } catch {
    return d;
  }
}

let state: GameState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be full or unavailable — the session still works */
  }
}

function commit(next: GameState) {
  state = next;
  persist();
  emit();
}

export function getGame(): GameState {
  return state;
}

export function useGame(): GameState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getGame,
    getGame
  );
}

// ── Target CRUD ─────────────────────────────────────────────────────────────

export type TargetDraft = Omit<Target, "id" | "createdAt" | "updatedAt" | "archived"> & Partial<Pick<Target, "archived">>;

export function newDraft(): TargetDraft {
  return {
    title: "",
    emoji: "🎯",
    category: "business",
    measure: "check",
    unit: "",
    goal: 1,
    direction: "atLeast",
    priority: "normal",
    cadence: { kind: "daily" },
    horizon: "day",
    startDate: todayKey(),
    renewal: "none",
  };
}

export function addTarget(draft: TargetDraft): string {
  const now = Date.now();
  const t = normalizeTarget({ ...draft, id: uid(), createdAt: now, updatedAt: now, archived: !!draft.archived });
  if (!t) return "";
  commit({ ...state, targets: [...state.targets, t] });
  return t.id;
}

export function updateTarget(id: string, patch: Partial<Target>) {
  const targets = state.targets.map((t) => {
    if (t.id !== id) return t;
    const merged = normalizeTarget({ ...t, ...patch, id: t.id, createdAt: t.createdAt, updatedAt: Date.now() });
    return merged || t;
  });
  commit({ ...state, targets });
}

/** Retire a target but keep its history (what the UI offers first). */
export function archiveTarget(id: string, archived = true) {
  updateTarget(id, { archived });
}

/** Delete a target and every log it ever had. */
export function removeTarget(id: string) {
  const logs: Logs = {};
  for (const [date, row] of Object.entries(state.logs)) {
    const { [id]: _drop, ...rest } = row;
    if (Object.keys(rest).length) logs[date] = rest;
  }
  commit({ ...state, targets: state.targets.filter((t) => t.id !== id), logs });
}

export function duplicateTarget(id: string): string {
  const t = state.targets.find((x) => x.id === id);
  if (!t) return "";
  const now = Date.now();
  const copy: Target = { ...t, id: uid(), title: `${t.title} (copy)`.slice(0, 80), createdAt: now, updatedAt: now };
  commit({ ...state, targets: [...state.targets, copy] });
  return copy.id;
}

export function addPresets(drafts: TargetDraft[]) {
  const now = Date.now();
  const made = drafts
    .map((d, i) => normalizeTarget({ ...d, id: uid(), createdAt: now + i, updatedAt: now + i, archived: false }))
    .filter(Boolean) as Target[];
  commit({ ...state, targets: [...state.targets, ...made], meta: { ...state.meta, onboarded: true } });
}

// ── Logging ─────────────────────────────────────────────────────────────────

/** Is the day still open for logging? */
export function canLog(key: string, now = new Date()): boolean {
  const today = toKey(now);
  if (key > today) return false;         // no logging the future
  if (key < today) return false;         // past days are sealed
  if (!state.settings.lateEdits) {
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= minutesOf(state.settings.closeTime)) return false;
  }
  return true;
}

export function setLog(key: string, targetId: string, value: number) {
  const now = Date.now();
  const row = { ...(state.logs[key] || {}) };
  const prev = row[targetId];
  if (!isFinite(value) || value <= 0) {
    if (!prev) return;
    delete row[targetId];
  } else {
    row[targetId] = { value, at: now, firstAt: prev?.firstAt || now };
  }
  const logs = { ...state.logs };
  if (Object.keys(row).length) logs[key] = row;
  else delete logs[key];
  commit({ ...state, logs });
}

export function bumpLog(key: string, targetId: string, delta: number) {
  setLog(key, targetId, Math.max(0, logValue(state, key, targetId) + delta));
}

/** Tick a check target (or clear it). For "at most" limits, +1 the tally. */
export function toggleLog(key: string, t: Target) {
  const v = logValue(state, key, t.id);
  if (t.measure === "check") setLog(key, t.id, v >= 1 ? 0 : 1);
  else setLog(key, t.id, v >= t.goal ? 0 : t.goal);
}

export function clearDay(key: string) {
  const logs = { ...state.logs };
  delete logs[key];
  commit({ ...state, logs });
}

// ── Settings & meta ─────────────────────────────────────────────────────────

export function setSettings(patch: Partial<GameSettings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

export function markVerdictSeen(key: string) {
  if (state.meta.verdictSeen.includes(key)) return;
  commit({ ...state, meta: { ...state.meta, verdictSeen: [...state.meta.verdictSeen, key].slice(-60) } });
}

export function markBadgesSeen(ids: string[]) {
  const add = ids.filter((id) => !state.meta.badgesSeen.includes(id));
  if (!add.length) return;
  commit({ ...state, meta: { ...state.meta, badgesSeen: [...state.meta.badgesSeen, ...add].slice(-400) } });
}

export function setOnboarded(v = true) {
  commit({ ...state, meta: { ...state.meta, onboarded: v } });
}

export function resetGame() {
  commit({ ...defaults(), settings: { ...defaults().settings, seed: randomSeed() } });
}

/** Every day that has a log, oldest first. */
export function loggedDays(s: GameState): string[] {
  return Object.keys(s.logs).sort();
}

/** The first day worth scoring: when you started, or your oldest entry. */
export function firstPlayedDay(s: GameState): string {
  const days = loggedDays(s);
  const candidates = [s.settings.startedOn, ...(days.length ? [days[0]] : [])];
  const earliestTarget = s.targets.reduce<string | null>((a, t) => (a == null || t.startDate < a ? t.startDate : a), null);
  if (earliestTarget) candidates.push(earliestTarget);
  return candidates.sort()[0] || todayKey();
}
