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

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodEntry {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  at: number;
  meal?: MealType; // explicit override; otherwise derived from the log time
}

// Classify a meal by when it was logged (user can override per entry).
export function mealTypeOf(e: FoodEntry): MealType {
  if (e.meal) return e.meal;
  const h = new Date(e.at).getHours() + new Date(e.at).getMinutes() / 60;
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22.5) return "dinner";
  return "snack";
}

export const MEAL_META: Record<MealType, { label: string; emoji: string; order: number }> = {
  breakfast: { label: "Breakfast", emoji: "🍳", order: 0 },
  lunch: { label: "Lunch", emoji: "🥗", order: 1 },
  snack: { label: "Snacks", emoji: "🍎", order: 2 },
  dinner: { label: "Dinner", emoji: "🍽️", order: 3 },
};

// ── Intermittent fasting ─────────────────────────────────────────────────────
// The schedule is a repeating cycle (fast N hours ⇄ eat 24−N hours) anchored to
// the last "First meal" / "Last meal" press (or meal log). When a phase's time
// is up the status flips to the next phase automatically — no press needed.
export interface FastingSettings {
  enabled: boolean;
  fastingHours: number;     // e.g. 16 → the classic 16:8
  anchor: "fast" | "eat";   // which phase started at anchorAt
  anchorAt: number | null;  // when that phase started
}

// A food the user has confirmed before — the app "learns" these so it can bias
// photo recognition toward their real diet and offer one-tap corrections.
export interface LearnedFood {
  name: string;
  unit: string;        // g | piece | slice | cup | …
  quantity: number;    // the amount these macros are for
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  count: number;       // how many times logged (frequency)
  at: number;          // last used
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

// ── Activity catalog ─────────────────────────────────────────────────────────
// MET (metabolic equivalent) values from the Compendium of Physical Activities,
// used to estimate burn: kcal ≈ MET × body-weight-kg × hours. Grouped so the
// picker reads like a menu instead of a wall of chips.
export interface ActivityKind { label: string; emoji: string; met: number; group: string }
export const ACTIVITIES: ActivityKind[] = [
  // Cardio
  { label: "Walk", emoji: "🚶", met: 3.5, group: "Cardio" },
  { label: "Running", emoji: "🏃", met: 9.8, group: "Cardio" },
  { label: "Cycling", emoji: "🚴", met: 7.5, group: "Cardio" },
  { label: "Swimming", emoji: "🏊", met: 7.0, group: "Cardio" },
  { label: "Hiking", emoji: "🥾", met: 6.0, group: "Cardio" },
  { label: "Rowing", emoji: "🚣", met: 7.0, group: "Cardio" },
  { label: "Elliptical", emoji: "🌀", met: 5.0, group: "Cardio" },
  { label: "Stairs", emoji: "🪜", met: 8.0, group: "Cardio" },
  // Studio & mind-body
  { label: "Yoga", emoji: "🧘", met: 3.0, group: "Studio" },
  { label: "Pilates", emoji: "🤸", met: 3.8, group: "Studio" },
  { label: "Stretching", emoji: "🙆", met: 2.5, group: "Studio" },
  { label: "Dance", emoji: "💃", met: 5.5, group: "Studio" },
  { label: "Barre", emoji: "🩰", met: 4.0, group: "Studio" },
  { label: "Spinning", emoji: "🚲", met: 8.5, group: "Studio" },
  // Strength & intensity
  { label: "Gym", emoji: "🏋️", met: 5.0, group: "Strength" },
  { label: "Strength", emoji: "💪", met: 6.0, group: "Strength" },
  { label: "HIIT", emoji: "⚡", met: 8.0, group: "Strength" },
  { label: "CrossFit", emoji: "🔥", met: 8.5, group: "Strength" },
  { label: "Boxing", emoji: "🥊", met: 9.0, group: "Strength" },
  { label: "Climbing", emoji: "🧗", met: 8.0, group: "Strength" },
  // Sports
  { label: "Football", emoji: "⚽", met: 7.0, group: "Sports" },
  { label: "Tennis", emoji: "🎾", met: 7.3, group: "Sports" },
  { label: "Padel", emoji: "🏓", met: 6.5, group: "Sports" },
  { label: "Basketball", emoji: "🏀", met: 6.5, group: "Sports" },
  { label: "Volleyball", emoji: "🏐", met: 4.0, group: "Sports" },
  { label: "Golf", emoji: "⛳", met: 4.8, group: "Sports" },
  { label: "Skiing", emoji: "🎿", met: 7.0, group: "Sports" },
  { label: "Snowboard", emoji: "🏂", met: 6.5, group: "Sports" },
  { label: "Skating", emoji: "⛸️", met: 7.0, group: "Sports" },
  { label: "Surfing", emoji: "🏄", met: 5.0, group: "Sports" },
  // Everyday
  { label: "Housework", emoji: "🧹", met: 3.3, group: "Everyday" },
  { label: "Gardening", emoji: "🌱", met: 4.0, group: "Everyday" },
  { label: "Other", emoji: "✨", met: 5.0, group: "Everyday" },
];
export const ACTIVITY_GROUPS = ["Cardio", "Studio", "Strength", "Sports", "Everyday"];

export function activityByLabel(label: string): ActivityKind | undefined {
  const l = (label || "").toLowerCase();
  return ACTIVITIES.find((a) => a.label.toLowerCase() === l);
}
export function activityEmoji(label: string): string {
  return activityByLabel(label)?.emoji || "✨";
}
/** kcal ≈ MET × kg × hours (falls back to 75 kg when weight is unknown). */
export function estimateBurn(label: string, minutes: number, weightKg?: number | null): number {
  const met = activityByLabel(label)?.met ?? 5;
  const kg = weightKg && weightKg > 0 ? weightKg : 75;
  return Math.max(0, Math.round(met * kg * (Math.max(0, minutes) / 60)));
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

export interface CoachAdvice { headline: string; advice: string; nextMeal: string }

export interface HealthState {
  profile: Profile;
  foods: FoodEntry[];
  activities: ActivityEntry[];
  weights: WeightEntry[];
  waters: WaterEntry[];
  sleeps: SleepEntry[];
  learnedFoods: LearnedFood[];
  plan: HealthPlan | null;
  planAt: number | null;
  fasting: FastingSettings;
  coach: { date: string; data: CoachAdvice } | null; // today's cached coaching
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
    learnedFoods: [],
    plan: null,
    planAt: null,
    fasting: { enabled: false, fastingHours: 16, anchor: "fast", anchorAt: null },
    coach: null,
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
      learnedFoods: Array.isArray(p.learnedFoods) ? p.learnedFoods : [],
      plan: p.plan ?? null,
      planAt: p.planAt ?? null,
      fasting: (() => {
        const f = { ...d.fasting, ...(p.fasting || {}) } as FastingSettings & { lastMealAt?: number | null };
        // Migrate the old lastMealAt-only shape: a meal ended eating → fast starts there.
        if (!f.anchorAt && f.lastMealAt) { f.anchor = "fast"; f.anchorAt = f.lastMealAt; }
        delete f.lastMealAt;
        return f;
      })(),
      coach: p.coach ?? null,
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
  // A meal logged while fasting (or before any anchor) is the "first meal" —
  // it opens the eating window. Meals inside an open window leave it alone;
  // the schedule (or the Last-meal button) closes it.
  let fasting = state.fasting;
  if (entry.date === todayKey()) {
    const phase = fastingStatus(state, entry.at).phase;
    if (phase !== "eating") fasting = { ...state.fasting, anchor: "eat", anchorAt: entry.at };
  }
  set({ foods: [entry, ...state.foods], fasting });
}

// ── Intermittent fasting ─────────────────────────────────────────────────────
export function setFasting(patch: Partial<FastingSettings>) {
  set({ fasting: { ...state.fasting, ...patch } });
}
// "Last meal" — eating is done, the fast starts now.
export function markLastMeal(at = Date.now()) {
  set({ fasting: { ...state.fasting, anchor: "fast", anchorAt: at } });
}
// "First meal" — the fast is broken, the eating window starts now.
export function markFirstMeal(at = Date.now()) {
  set({ fasting: { ...state.fasting, anchor: "eat", anchorAt: at } });
}

export interface FastingStatus {
  phase: "idle" | "fasting" | "eating";
  phaseStart: number;   // when the current phase began
  phaseEnd: number;     // when it flips to the next phase automatically
  remainMs: number;     // ms left in the current phase
  pct: number;          // progress through the current phase (0–1)
  sinceMs: number;      // how long the current phase has been running
}
export function fastingStatus(s: HealthState, now = Date.now()): FastingStatus {
  const f = s.fasting;
  if (!f.anchorAt) return { phase: "idle", phaseStart: 0, phaseEnd: 0, remainMs: 0, pct: 0, sinceMs: 0 };
  const fastMs = f.fastingHours * 3600_000;
  const eatMs = Math.max(1, 24 - f.fastingHours) * 3600_000;
  // Walk the cycle forward from the anchor to now — phases flip on their own.
  let phase: "fast" | "eat" = f.anchor;
  let start = f.anchorAt;
  for (let i = 0; i < 1000; i++) {
    const dur = phase === "fast" ? fastMs : eatMs;
    if (now < start + dur) break;
    start += dur;
    phase = phase === "fast" ? "eat" : "fast";
  }
  const dur = phase === "fast" ? fastMs : eatMs;
  return {
    phase: phase === "fast" ? "fasting" : "eating",
    phaseStart: start,
    phaseEnd: start + dur,
    remainMs: Math.max(0, start + dur - now),
    pct: Math.min(1, (now - start) / dur),
    sinceMs: now - start,
  };
}

export function saveCoach(data: CoachAdvice) {
  set({ coach: { date: todayKey(), data } });
}

// ── Food learning ────────────────────────────────────────────────────────────
function foodKey(name: string): string {
  return (name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Remember a confirmed food so the app learns the user's diet: biases future
// photo recognition and powers one-tap corrections. Upserts by name.
export function rememberFood(f: Omit<LearnedFood, "count" | "at">) {
  const key = foodKey(f.name);
  if (!key || !(f.calories > 0)) return;
  const existing = state.learnedFoods.find((x) => foodKey(x.name) === key);
  const merged: LearnedFood = {
    name: f.name.trim(),
    unit: f.unit || "g",
    quantity: f.quantity || 0,
    calories: Math.round(f.calories),
    protein_g: Math.round(f.protein_g),
    carbs_g: Math.round(f.carbs_g),
    fat_g: Math.round(f.fat_g),
    count: (existing?.count || 0) + 1,
    at: Date.now(),
  };
  const rest = state.learnedFoods.filter((x) => foodKey(x.name) !== key);
  // Keep the list bounded (most useful = frequent + recent).
  const next = [merged, ...rest]
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .slice(0, 100);
  set({ learnedFoods: next });
}

export function removeLearnedFood(name: string) {
  const key = foodKey(name);
  set({ learnedFoods: state.learnedFoods.filter((x) => foodKey(x.name) !== key) });
}

// Top foods for quick-pick chips (frequent first, then recent).
export function frequentFoods(s: HealthState, n = 12): LearnedFood[] {
  return [...s.learnedFoods].sort((a, b) => b.count - a.count || b.at - a.at).slice(0, n);
}

// Names sent to the vision model as recognition hints.
export function foodHints(n = 16): string[] {
  return frequentFoods(state, n).map((f) => f.name);
}

// Exact-name lookup for instant correction (no AI call).
export function matchLearnedFood(name: string): LearnedFood | undefined {
  const key = foodKey(name);
  return state.learnedFoods.find((x) => foodKey(x.name) === key);
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

// Calories by meal type across the last `days` days — powers the "when you
// eat" distribution stats and the coach context.
export interface MealBreakdown { type: MealType; calories: number; count: number; share: number }
export function mealBreakdown(s: HealthState, days = 7): MealBreakdown[] {
  const cutoff = toKey(new Date(Date.now() - (days - 1) * 86400000));
  const totals: Record<MealType, { calories: number; count: number }> = {
    breakfast: { calories: 0, count: 0 }, lunch: { calories: 0, count: 0 }, dinner: { calories: 0, count: 0 }, snack: { calories: 0, count: 0 },
  };
  let grand = 0;
  for (const f of s.foods) {
    if (f.date < cutoff) continue;
    const t = mealTypeOf(f);
    totals[t].calories += f.calories || 0;
    totals[t].count += 1;
    grand += f.calories || 0;
  }
  return (Object.keys(MEAL_META) as MealType[])
    .sort((a, b) => MEAL_META[a].order - MEAL_META[b].order)
    .map((type) => ({ type, calories: Math.round(totals[type].calories), count: totals[type].count, share: grand ? totals[type].calories / grand : 0 }));
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
