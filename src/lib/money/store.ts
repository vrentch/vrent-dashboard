import { useSyncExternalStore } from "react";

// One unified place to track personal spending (source-agnostic) plus an
// "affordability" engine: estimate net Swiss salary → reserve savings & fixed
// costs → drip the rest across waking hours into a live "spend now" balance.

export interface FixedExpense { id: string; label: string; amount: number }

export interface Expense {
  id: string;
  at: number;      // logged timestamp
  date: string;    // YYYY-MM-DD (when spent)
  amount: number;  // CHF
  category: string;
  note?: string;
}

export type Canton = "ZH" | "SZ" | "ZG" | "OTHER";
export type MaritalStatus = "single" | "married" | "divorced";

export interface MoneySettings {
  grossMonthly: number;            // gross salary per month (CHF)
  canton: Canton;
  status: MaritalStatus;
  deductionPct: number | null;     // manual effective deduction % (null = estimate)
  netOverride: number | null;      // manual net salary (null = use estimate)
  savingsMode: "amount" | "percent";
  savingsValue: number;            // CHF/month or % of net
  wakeTime: string;                // "HH:MM" when the waking window starts
  wakingHours: number;             // hours awake per day (spending window)
}

export interface MoneyState {
  settings: MoneySettings;
  expenses: Expense[];
}

export const CATEGORIES: { key: string; label: string; emoji: string }[] = [
  { key: "food", label: "Food & drinks", emoji: "🍽️" },
  { key: "groceries", label: "Groceries", emoji: "🛒" },
  { key: "transport", label: "Transport", emoji: "🚆" },
  { key: "shopping", label: "Shopping", emoji: "🛍️" },
  { key: "leisure", label: "Leisure", emoji: "🎉" },
  { key: "health", label: "Health", emoji: "💊" },
  { key: "bills", label: "Bills & fees", emoji: "🧾" },
  { key: "other", label: "Other", emoji: "💸" },
];
export function categoryOf(key: string) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1];
}

export const CANTONS: { key: Canton; label: string }[] = [
  { key: "ZH", label: "Zürich" },
  { key: "SZ", label: "Schwyz" },
  { key: "ZG", label: "Zug" },
  { key: "OTHER", label: "Other" },
];

const KEY = "vrent.money.v1";
// Fixed expenses live in settings so they persist with the config.
interface Persisted extends MoneyState { fixed: FixedExpense[] }

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }
}

function defaults(): Persisted {
  return {
    settings: {
      grossMonthly: 0, canton: "ZH", status: "single",
      deductionPct: null, netOverride: null,
      savingsMode: "amount", savingsValue: 0,
      wakeTime: "06:00", wakingHours: 18,
    },
    expenses: [],
    fixed: [],
  };
}

function load(): Persisted {
  const d = defaults();
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!p) return d;
    return {
      settings: { ...d.settings, ...(p.settings || {}) },
      expenses: Array.isArray(p.expenses) ? p.expenses : [],
      fixed: Array.isArray(p.fixed) ? p.fixed : [],
    };
  } catch { return d; }
}

let state: Persisted = load();
const listeners = new Set<() => void>();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ } }
function set(patch: Partial<Persisted>) { state = { ...state, ...patch }; persist(); listeners.forEach((l) => l()); }

export function getMoney(): Persisted { return state; }
export function useMoney(): Persisted {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, getMoney, getMoney);
}

// Mutations -------------------------------------------------------------------
export function setSettings(patch: Partial<MoneySettings>) { set({ settings: { ...state.settings, ...patch } }); }
export function addFixed(label: string, amount: number) {
  if (!label.trim() || !(amount > 0)) return;
  set({ fixed: [...state.fixed, { id: uid(), label: label.trim(), amount }] });
}
export function removeFixed(id: string) { set({ fixed: state.fixed.filter((f) => f.id !== id) }); }
export function fixedList(s: Persisted): FixedExpense[] { return s.fixed; }

export function addExpense(e: { amount: number; category: string; note?: string; date?: string }): string {
  const id = uid();
  const date = e.date || todayKey();
  set({ expenses: [{ id, at: Date.now(), date, amount: Math.round((e.amount || 0) * 100) / 100, category: e.category || "other", note: e.note }, ...state.expenses] });
  return id;
}
export function removeExpense(id: string) { set({ expenses: state.expenses.filter((x) => x.id !== id) }); }
export function updateExpense(id: string, patch: Partial<Expense>) {
  set({ expenses: state.expenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

// Dates -----------------------------------------------------------------------
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysInMonth(d: Date): number { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function parseHM(s: string): number {
  const [h, m] = (s || "06:00").split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}

// ── Swiss net-salary estimate (approximate — user can tweak or override) ──────
// Employee social deductions (AHV/IV/EO + ALV + BVG pension + NBU accident),
// roughly constant across cantons.
const SOCIAL_PCT = 12.5;
// Very rough effective income-tax % (federal+cantonal+municipal) by canton &
// income band, for a single filer. Married gets a splitting discount.
function incomeTaxPct(canton: Canton, status: MaritalStatus, annualGross: number): number {
  const bands: { upto: number; ZH: number; SZ: number; ZG: number; OTHER: number }[] = [
    { upto: 60000, ZH: 5, SZ: 3, ZG: 3, OTHER: 6 },
    { upto: 100000, ZH: 10, SZ: 6, ZG: 5, OTHER: 11 },
    { upto: 150000, ZH: 14, SZ: 8, ZG: 7, OTHER: 15 },
    { upto: Infinity, ZH: 18, SZ: 11, ZG: 9, OTHER: 19 },
  ];
  const b = bands.find((x) => annualGross <= x.upto) || bands[bands.length - 1];
  let pct = b[canton] ?? b.OTHER;
  if (status === "married") pct *= 0.8; // rough splitting benefit
  return pct;
}
export function estimatedDeductionPct(s: MoneySettings): number {
  if (s.deductionPct != null) return s.deductionPct;
  return Math.round((SOCIAL_PCT + incomeTaxPct(s.canton, s.status, s.grossMonthly * 12)) * 10) / 10;
}
export function estimateNetMonthly(s: MoneySettings): number {
  if (s.netOverride != null && s.netOverride > 0) return s.netOverride;
  return Math.max(0, s.grossMonthly * (1 - estimatedDeductionPct(s) / 100));
}

// ── Affordability derivations ────────────────────────────────────────────────
export function savingsMonthly(s: Persisted): number {
  const net = estimateNetMonthly(s.settings);
  return s.settings.savingsMode === "percent" ? (net * s.settings.savingsValue) / 100 : s.settings.savingsValue;
}
export function fixedMonthly(s: Persisted): number { return s.fixed.reduce((a, f) => a + (f.amount || 0), 0); }
export function spendableMonthly(s: Persisted): number {
  return Math.max(0, estimateNetMonthly(s.settings) - fixedMonthly(s) - savingsMonthly(s));
}
export function dailyAllowance(s: Persisted, now = new Date()): number {
  return spendableMonthly(s) / daysInMonth(now);
}
export function hourlyAllowance(s: Persisted, now = new Date()): number {
  const wh = s.settings.wakingHours || 18;
  return dailyAllowance(s, now) / wh;
}

// Waking hours accrued from the 1st of the month up to `now`.
function accruedHoursThisMonth(s: Persisted, now: Date): number {
  const wh = s.settings.wakingHours || 18;
  const pastDays = now.getDate() - 1;
  const wake = parseHM(s.settings.wakeTime);
  const nowH = now.getHours() + now.getMinutes() / 60;
  const todayFrac = Math.max(0, Math.min(wh, nowH - wake));
  return pastDays * wh + todayFrac;
}

export function spentInMonth(s: Persisted, ym: string): number {
  return s.expenses.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + (e.amount || 0), 0);
}
export function spentOnDay(s: Persisted, date: string): number {
  return s.expenses.filter((e) => e.date === date).reduce((a, e) => a + (e.amount || 0), 0);
}

// The live "spend now" balance: what has accrued so far this month minus what
// you've spent. Rolls over between days; resets each month with fresh salary.
export function liveBalance(s: Persisted, now = new Date()): number {
  const accrued = accruedHoursThisMonth(s, now) * hourlyAllowance(s, now);
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return accrued - spentInMonth(s, ym);
}

export function isConfigured(s: Persisted): boolean {
  return s.settings.grossMonthly > 0 || (s.settings.netOverride ?? 0) > 0;
}

// Spending grouped by category for a set of expenses.
export function categoryTotals(list: Expense[]): { key: string; label: string; emoji: string; amount: number; count: number }[] {
  const map: Record<string, { amount: number; count: number }> = {};
  for (const e of list) {
    map[e.category] = map[e.category] || { amount: 0, count: 0 };
    map[e.category].amount += e.amount || 0;
    map[e.category].count += 1;
  }
  return Object.entries(map)
    .map(([key, v]) => ({ key, label: categoryOf(key).label, emoji: categoryOf(key).emoji, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);
}

// Daily spend for the last n days (oldest→newest) for a trend chart.
export function lastNDaysSpend(s: Persisted, n = 7): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: key, amount: spentOnDay(s, key) });
  }
  return out;
}

export function expensesInMonth(s: Persisted, ym: string): Expense[] {
  return s.expenses.filter((e) => e.date.startsWith(ym)).sort((a, b) => b.at - a.at);
}
