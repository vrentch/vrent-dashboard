import { useSyncExternalStore } from "react";
import type { HealthPlan } from "./api";

// Local-only health data. Everything lives in this browser (like the rest of
// the app) — nothing is uploaded except the food photo you choose to analyze.

export type Goal = "lose" | "maintain" | "gain";
export type Activity = "sedentary" | "light" | "moderate" | "active";

export interface Profile {
  sex: "male" | "female" | "other" | "";
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goal: Goal;
  activity: Activity;
  targetCalories: number | null; // manual override
}

export interface FoodEntry {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  at: number;
}

export interface ActivityEntry {
  id: string;
  date: string;
  kind: "steps" | "workout";
  steps?: number;
  minutes?: number;
  label?: string;
  calories?: number;
  at: number;
}

export interface WeightEntry {
  id: string;
  date: string;
  kg: number;
  at: number;
}

// Daily "total" metrics — one value per day, upserted (steps live in activities
// for backwards-compat, but water/sleep are here).
export interface WaterEntry {
  id: string;
  date: string;
  ml: number;
  at: number;
}
export interface SleepEntry {
  id: string;
  date: string;
  hours: number;
  at: number;
}

export interface HealthState {
  profile: Profile;
  foods: FoodEntry[];
  activities: ActivityEntry[];
  weights: WeightEntry[];
  waters: WaterEntry[];
  sleeps: SleepEntry[];
  plan: HealthPlan | null;
  planAt: number | null;
}

const KEY = "vrent.health.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `h_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function todayKey(): string {
  return toKey(new Date());
}

function defaults(): HealthState {
  return {
    profile: { sex: "", age: null, heightCm: null, weightKg: null, goal: "maintain", activity: "light", targetCalories: null },
    foods: [],
    activities: [],
    weights: [],
    waters: [],
    sleeps: [],
    plan: null,
    planAt: null,
  };
}

function load(): HealthState {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      profile: { ...d.profile, ...(p.profile || {}) },
      foods: Array.isArray(p.foods) ? p.foods : [],
      activities: Array.isArray(p.activities) ? p.activities : [],
      weights: Array.isArray(p.weights) ? p.weights : [],
      waters: Array.isArray(p.waters) ? p.waters : [],
      sleeps: Array.isArray(p.sleeps) ? p.sleeps : [],
      plan: p.plan ?? null,
      planAt: p.planAt ?? null,
    };
  } catch {
    return d;
  }
}

let state: HealthState = load();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}

export function getHealth(): HealthState {
  return state;
}
function set(patch: Partial<HealthState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export function useHealth(): HealthState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getHealth,
    getHealth
  );
}

// Mutations -------------------------------------------------------------------

export function setProfile(patch: Partial<Profile>) {
  set({ profile: { ...state.profile, ...patch } });
}

export function addFood(e: Omit<FoodEntry, "id" | "at" | "date"> & { date?: string }) {
  const entry: FoodEntry = { id: uid(), at: Date.now(), date: e.date || todayKey(), ...e };
  set({ foods: [entry, ...state.foods] });
}

export function addActivity(e: Omit<ActivityEntry, "id" | "at" | "date"> & { date?: string }) {
  const entry: ActivityEntry = { id: uid(), at: Date.now(), date: e.date || todayKey(), ...e };
  set({ activities: [entry, ...state.activities] });
}

export function addWeight(kg: number, date?: string) {
  const entry: WeightEntry = { id: uid(), at: Date.now(), date: date || todayKey(), kg };
  set({ weights: [entry, ...state.weights.filter((w) => w.date !== entry.date)] });
}

export function removeFood(id: string) {
  set({ foods: state.foods.filter((f) => f.id !== id) });
}
export function updateFood(id: string, patch: Partial<Omit<FoodEntry, "id">>) {
  set({ foods: state.foods.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
}
export function removeActivity(id: string) {
  set({ activities: state.activities.filter((a) => a.id !== id) });
}
export function updateActivity(id: string, patch: Partial<Omit<ActivityEntry, "id">>) {
  set({ activities: state.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
}
export function removeWeight(id: string) {
  set({ weights: state.weights.filter((w) => w.id !== id) });
}

// Steps are a daily total — replace the day's step entry instead of stacking.
export function setSteps(steps: number, date?: string) {
  const d = date || todayKey();
  const kept = state.activities.filter((a) => !(a.kind === "steps" && a.date === d));
  if (steps > 0) kept.unshift({ id: uid(), at: Date.now(), date: d, kind: "steps", steps, calories: Math.round(steps * 0.04) });
  set({ activities: kept });
}

// Water & sleep are daily totals — upsert per day.
export function setWater(ml: number, date?: string) {
  const d = date || todayKey();
  const rest = state.waters.filter((w) => w.date !== d);
  set({ waters: ml > 0 ? [{ id: uid(), at: Date.now(), date: d, ml }, ...rest] : rest });
}
export function addWater(ml: number, date?: string) {
  const d = date || todayKey();
  setWater(waterOn(state, d) + ml, d);
}
export function setSleep(hours: number, date?: string) {
  const d = date || todayKey();
  const rest = state.sleeps.filter((s) => s.date !== d);
  set({ sleeps: hours > 0 ? [{ id: uid(), at: Date.now(), date: d, hours }, ...rest] : rest });
}

// Apple Health import: an iOS Shortcut opens the app with these query params;
// we log whatever it sends for the given day (defaults to today).
export function ingestHealth(p: { steps?: number; weightKg?: number; sleepH?: number; waterMl?: number; activeKcal?: number; date?: string }) {
  const d = p.date || todayKey();
  if (p.steps != null && p.steps > 0) setSteps(Math.round(p.steps), d);
  if (p.weightKg != null && p.weightKg > 0) addWeight(p.weightKg, d);
  if (p.sleepH != null && p.sleepH > 0) setSleep(p.sleepH, d);
  if (p.waterMl != null && p.waterMl > 0) setWater(Math.round(p.waterMl), d);
  if (p.activeKcal != null && p.activeKcal > 0) {
    const rest = state.activities.filter((a) => !(a.label === "Active energy" && a.date === d));
    set({ activities: [{ id: uid(), at: Date.now(), date: d, kind: "workout", label: "Active energy", minutes: 0, calories: Math.round(p.activeKcal) }, ...rest] });
  }
}

export function savePlan(plan: HealthPlan) {
  set({ plan, planAt: Date.now() });
}

// Derived ---------------------------------------------------------------------

export function foodsOn(s: HealthState, date: string): FoodEntry[] {
  return s.foods.filter((f) => f.date === date);
}
export function activitiesOn(s: HealthState, date: string): ActivityEntry[] {
  return s.activities.filter((a) => a.date === date);
}

export function macrosOn(s: HealthState, date: string) {
  return foodsOn(s, date).reduce(
    (acc, f) => ({
      calories: acc.calories + (f.calories || 0),
      protein_g: acc.protein_g + (f.protein_g || 0),
      carbs_g: acc.carbs_g + (f.carbs_g || 0),
      fat_g: acc.fat_g + (f.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

export function stepsOn(s: HealthState, date: string): number {
  return activitiesOn(s, date).reduce((n, a) => n + (a.kind === "steps" ? a.steps || 0 : 0), 0);
}
export function burnOn(s: HealthState, date: string): number {
  return activitiesOn(s, date).reduce((n, a) => n + (a.calories || 0), 0);
}
export function waterOn(s: HealthState, date: string): number {
  return s.waters.filter((w) => w.date === date).reduce((n, w) => n + (w.ml || 0), 0);
}
export function sleepOn(s: HealthState, date: string): number {
  const e = s.sleeps.find((x) => x.date === date);
  return e ? e.hours : 0;
}
export function latestWeight(s: HealthState): number | null {
  return s.weights[0]?.kg ?? s.profile.weightKg ?? null;
}

const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };

/** Estimated daily calorie target (Mifflin-St Jeor → TDEE → goal-adjusted). */
export function calorieTarget(p: Profile): number {
  if (p.targetCalories && p.targetCalories > 0) return p.targetCalories;
  if (p.weightKg && p.heightCm && p.age) {
    const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
    const bmr = base + (p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78);
    const tdee = bmr * ACTIVITY_FACTOR[p.activity];
    const adj = p.goal === "lose" ? -450 : p.goal === "gain" ? 350 : 0;
    return Math.max(1200, Math.round((tdee + adj) / 10) * 10);
  }
  return p.goal === "lose" ? 1800 : p.goal === "gain" ? 2600 : 2200;
}

export interface MacroTargets { calories: number; protein_g: number; carbs_g: number; fat_g: number }
export function macroTargets(p: Profile): MacroTargets {
  const cal = calorieTarget(p);
  return {
    calories: cal,
    protein_g: Math.round((cal * 0.3) / 4),
    carbs_g: Math.round((cal * 0.4) / 4),
    fat_g: Math.round((cal * 0.3) / 9),
  };
}

/** Compact recent-days snapshot for the AI planner. */
export function recentSummary(s: HealthState, days = 7) {
  const out: { date: string; calories: number; steps: number; workoutMin: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = toKey(d);
    const acts = activitiesOn(s, k);
    out.push({
      date: k,
      calories: Math.round(macrosOn(s, k).calories),
      steps: stepsOn(s, k),
      workoutMin: acts.reduce((n, a) => n + (a.kind === "workout" ? a.minutes || 0 : 0), 0),
    });
  }
  const latestWeight = s.weights[0]?.kg ?? s.profile.weightKg ?? null;
  return { days: out, latestWeightKg: latestWeight };
}

// Rolling 7-day aggregates for the weekly stats card.
export interface WeeklyStats {
  avgCalories: number;
  avgSteps: number;
  avgWaterMl: number;
  avgSleep: number;
  workouts: number;
  onTargetDays: number;
  loggedDays: number;
  target: number;
  weightChange: number | null;
}
export function weeklyStats(s: HealthState): WeeklyStats {
  const target = calorieTarget(s.profile);
  let calTotal = 0, calDays = 0, stepTotal = 0, stepDays = 0, water = 0, waterDays = 0, sleepTotal = 0, sleepDays = 0, workouts = 0, onTarget = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = toKey(d);
    const cal = Math.round(macrosOn(s, k).calories);
    if (cal > 0) { calTotal += cal; calDays++; if (target > 0 && cal <= target) onTarget++; }
    const st = stepsOn(s, k);
    if (st > 0) { stepTotal += st; stepDays++; }
    const w = waterOn(s, k);
    if (w > 0) { water += w; waterDays++; }
    const sl = sleepOn(s, k);
    if (sl > 0) { sleepTotal += sl; sleepDays++; }
    workouts += activitiesOn(s, k).filter((a) => a.kind === "workout").length;
  }
  // Weight change across roughly the last week (weights are newest-first).
  const cutoff = toKey(new Date(Date.now() - 8 * 86400000));
  const recentW = s.weights.filter((w) => w.date >= cutoff);
  const weightChange = recentW.length >= 2 ? +(recentW[0].kg - recentW[recentW.length - 1].kg).toFixed(1) : null;
  return {
    avgCalories: calDays ? Math.round(calTotal / calDays) : 0,
    avgSteps: stepDays ? Math.round(stepTotal / stepDays) : 0,
    avgWaterMl: waterDays ? Math.round(water / waterDays) : 0,
    avgSleep: sleepDays ? +(sleepTotal / sleepDays).toFixed(1) : 0,
    workouts,
    onTargetDays: onTarget,
    loggedDays: calDays,
    target,
    weightChange,
  };
}

// ── Background sync (Apple Health via Shortcut) ───────────────────────────────
// Each installed app owns a private random sync key. The iOS Shortcut sends the
// day's metrics to the server under this key; the app pulls them on open. The
// key is what keeps everyone's data separate (his vs. girlfriend vs. mother).
const SYNC_KEY_LS = "vrent.health.synckey.v1";
const SYNCED_LS = "vrent.health.synced.v1";
const SYNC_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function getSyncKey(): string {
  let k: string | null = null;
  try { k = localStorage.getItem(SYNC_KEY_LS); } catch { /* ignore */ }
  if (!k || !SYNC_KEY_RE.test(k)) {
    k = randomSyncKey();
    try { localStorage.setItem(SYNC_KEY_LS, k); } catch { /* ignore */ }
  }
  return k;
}

function randomSyncKey(): string {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `k${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`.padEnd(16, "0");
  }
}

export interface SyncDay {
  date: string;
  steps?: number;
  weightKg?: number;
  sleepH?: number;
  waterMl?: number;
  activeKcal?: number;
}

// Merge pulled server days into the local log, idempotently: a day is only
// re-applied if its values actually changed since the last sync (so repeated
// pulls don't stack duplicate weight entries).
export function applyHealthDays(days: SyncDay[]): number {
  if (!Array.isArray(days) || days.length === 0) return 0;
  let sig: Record<string, string> = {};
  try { sig = JSON.parse(localStorage.getItem(SYNCED_LS) || "{}"); } catch { sig = {}; }
  let applied = 0;
  for (const d of days) {
    if (!d || !d.date) continue;
    const s = JSON.stringify([d.steps, d.weightKg, d.sleepH, d.waterMl, d.activeKcal]);
    if (sig[d.date] === s) continue;
    ingestHealth({ steps: d.steps, weightKg: d.weightKg, sleepH: d.sleepH, waterMl: d.waterMl, activeKcal: d.activeKcal, date: d.date });
    sig[d.date] = s;
    applied++;
  }
  if (applied > 0) {
    try { localStorage.setItem(SYNCED_LS, JSON.stringify(sig)); } catch { /* ignore */ }
  }
  return applied;
}
