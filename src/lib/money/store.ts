import { useSyncExternalStore } from "react";

// One unified place to track personal spending. The model is deliberately
// simple: you say how much you can spend per month, the app turns it into a
// daily budget over your own "budget month" (which can start on any day, e.g.
// the 25th when the salary lands), and unspent money rolls forward.

export interface Expense {
  id: string;
  at: number;      // logged timestamp
  date: string;    // YYYY-MM-DD (when spent)
  amount: number;  // CHF
  category: string;
  note?: string;
  source?: "applepay"; // auto-imported from the old Apple Pay Shortcut automation
}

// One-time income (bonus, 13th salary, side gig). Whatever isn't put into
// savings raises that month's spendable pool and the daily rate. The
// toTax/toFixed buckets are legacy — old entries still count toward the boost.
export interface ExtraIncome {
  id: string;
  at: number;
  month: string;     // YYYY-MM — the budget month it applies to (period anchor)
  label: string;
  amount: number;
  toTax: number;     // legacy bucket — counts toward the boost
  toFixed: number;   // legacy bucket — counts toward the boost
  toSavings: number; // straight to savings — not spendable
  toSpend: number;   // directly into the daily budget
}

export interface MoneySettings {
  monthlyBudget: number;  // the one number: what you can spend per month
  currency: string;       // display currency (CHF, EUR, …)
  monthStartDay: number;  // 1–28 — your budget month runs from this day to the
                          // day before the next start (e.g. 25th → 25.–24.)
  trackingSince: string;  // YYYY-MM-DD — budget never accrues earlier
                          // (no phantom credit for pre-tracking days)
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

const KEY = "vrent.money.v1";
interface Persisted extends MoneyState { extras: ExtraIncome[] }

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }
}

function defaults(): Persisted {
  return {
    settings: { monthlyBudget: 0, currency: "CHF", monthStartDay: 1, trackingSince: "" },
    expenses: [],
    extras: [],
  };
}

// ── Legacy migration ─────────────────────────────────────────────────────────
// The old model derived the spendable pool from income − tax − fixed − savings.
// On first load after the update, that derived number becomes the new
// monthlyBudget so nothing jumps; from then on only monthlyBudget is stored.
const LEGACY_CANTON_FACTOR: Record<string, number> = {
  ZG: 0.45, NW: 0.5, SZ: 0.55, UR: 0.6, OW: 0.6, AI: 0.6,
  AR: 0.75, GL: 0.75, TG: 0.75, LU: 0.8,
  SG: 0.85, GR: 0.85, AG: 0.85, SH: 0.85, ZH: 0.9, BL: 0.95,
  SO: 1.0, VS: 1.0, TI: 1.0, FR: 1.05, BS: 1.05, BE: 1.1,
  GE: 1.15, VD: 1.15, NE: 1.2, JU: 1.2, OTHER: 1.0,
};
function legacyTaxPct(raw: any): number {
  if (raw.taxPct != null) return raw.taxPct;
  const sys = raw.taxSystem || "CH";
  if (sys === "none") return 0;
  const annual = (raw.bankMonthly || 0) * 12;
  if (sys === "UK") {
    if (annual <= 0) return 0;
    const allowance = Math.max(0, 12570 - Math.max(0, annual - 100000) / 2);
    const taxable = Math.max(0, annual - allowance);
    const it = 0.2 * Math.min(taxable, 37700) + 0.4 * Math.min(Math.max(taxable - 37700, 0), 112570 - 37700) + 0.45 * Math.max(taxable - 112570, 0);
    const ni = 0.08 * Math.min(Math.max(annual - 12570, 0), 50270 - 12570) + 0.02 * Math.max(annual - 50270, 0);
    return ((it + ni) / annual) * 100;
  }
  const base = annual <= 55000 ? 7 : annual <= 90000 ? 12 : annual <= 135000 ? 16 : 20;
  let pct = base * (LEGACY_CANTON_FACTOR[raw.canton] ?? 1.0);
  if (raw.status === "married") pct *= 0.8;
  return pct;
}
function legacyMonthlyBudget(raw: any, fixed: { amount: number }[]): number {
  const bank = raw.bankMonthly ?? (raw.netOverride > 0 ? raw.netOverride : raw.grossMonthly ? Math.round(raw.grossMonthly * 0.875) : 0);
  if (!(bank > 0)) return 0;
  const afterTax = Math.max(0, bank * (1 - legacyTaxPct({ ...raw, bankMonthly: bank }) / 100));
  const fixedSum = fixed.reduce((a, f) => a + (f.amount || 0), 0);
  const sv = Math.max(0, raw.savingsValue || 0);
  const savings = raw.savingsMode === "percent" ? (afterTax * sv) / 100 : sv;
  return Math.max(0, Math.round(afterTax - fixedSum - savings));
}

function load(): Persisted {
  const d = defaults();
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!p) return d;
    const raw = p.settings || {};
    const expenses: Expense[] = Array.isArray(p.expenses) ? p.expenses : [];
    const fixed: { amount: number }[] = Array.isArray(p.fixed) ? p.fixed : [];
    const monthlyBudget = raw.monthlyBudget ?? legacyMonthlyBudget(raw, fixed);
    // Budget must not accrue before the user actually began tracking — for
    // existing data, the earliest logged expense is the honest start; a
    // configured store with no expenses starts today.
    const trackingSince =
      raw.trackingSince ||
      (expenses.length ? expenses.map((e) => e.date).sort()[0] : monthlyBudget > 0 ? todayKey() : "");
    const monthStartDay = Math.min(28, Math.max(1, Math.round(raw.monthStartDay || 1)));
    return {
      settings: { monthlyBudget: Math.max(0, monthlyBudget || 0), currency: raw.currency || "CHF", monthStartDay, trackingSince },
      expenses,
      extras: Array.isArray(p.extras) ? p.extras : [],
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
export function setSettings(patch: Partial<MoneySettings>) {
  const next = { ...state.settings, ...patch };
  next.monthStartDay = Math.min(28, Math.max(1, Math.round(next.monthStartDay || 1)));
  // Stamp the tracking start the moment the budget is first configured, so the
  // meter never credits days that were never tracked. Only auto-stamp when the
  // patch didn't touch trackingSince — an explicit user value must win.
  if (!("trackingSince" in patch) && !next.trackingSince && next.monthlyBudget > 0) next.trackingSince = todayKey();
  set({ settings: next });
}

// Extra income (bonus / one-time) -------------------------------------------
export function addExtra(e: { month: string; label: string; amount: number; toSavings: number; toSpend: number }): string {
  const id = uid();
  const nz = (n: number) => Math.max(0, Math.round((n || 0) * 100) / 100);
  set({
    extras: [
      { id, at: Date.now(), month: e.month, label: (e.label || "Extra income").trim(), amount: nz(e.amount), toTax: 0, toFixed: 0, toSavings: nz(e.toSavings), toSpend: nz(e.toSpend) },
      ...state.extras,
    ],
  });
  return id;
}
export function removeExtra(id: string) { set({ extras: state.extras.filter((x) => x.id !== id) }); }
export function extrasFor(s: Persisted, ym: string): ExtraIncome[] {
  return (s.extras || []).filter((x) => x.month === ym).sort((a, b) => b.at - a.at);
}
// How much a month's extras add to its spendable pool (all but the savings cut).
export function boostFor(s: Persisted, ym: string): number {
  return extrasFor(s, ym).reduce((a, x) => a + (x.toTax || 0) + (x.toFixed || 0) + (x.toSpend || 0), 0);
}

export function addExpense(e: { amount: number; category: string; note?: string; date?: string }): string {
  const id = uid();
  const date = e.date || todayKey();
  set({ expenses: [{ id, at: Date.now(), date, amount: Math.round((e.amount || 0) * 100) / 100, category: e.category || "other", note: e.note }, ...state.expenses] });
  return id;
}
export function removeExpense(id: string) { set({ expenses: state.expenses.filter((x) => x.id !== id) }); }

// The automated Apple Pay / notification import is gone (expenses are entered
// manually now), but the old wallet key survives so "Delete synced data from
// the server" can still wipe any historical server-side copies.
const WALLET_KEY_LS = "vrent.money.walletkey.v1";
export function getWalletKey(): string {
  try { return localStorage.getItem(WALLET_KEY_LS) || ""; } catch { return ""; }
}

export function updateExpense(id: string, patch: Partial<Expense>) {
  set({ expenses: state.expenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

// Dates -----------------------------------------------------------------------
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function todayKey(): string { return keyOf(new Date()); }
const DAY_MS = 86_400_000;
function daysBetween(a: Date, b: Date): number {
  // Calendar-day difference, robust across DST (round instead of truncate).
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((b0.getTime() - a0.getTime()) / DAY_MS);
}

// ── The budget month ─────────────────────────────────────────────────────────
// Runs from `monthStartDay` to the day before the next start. With start day 1
// it's the plain calendar month. `anchorYm` (the month the period starts in)
// keys the period's extra income.
export interface BudgetPeriod {
  start: string;   // YYYY-MM-DD, inclusive
  end: string;     // YYYY-MM-DD, inclusive
  anchorYm: string; // YYYY-MM
  days: number;
  label: string;   // "25 Aug – 24 Sep" (or "August" for plain months)
}
export function periodFor(s: Persisted, now = new Date()): BudgetPeriod {
  const sd = Math.min(28, Math.max(1, Math.round(s.settings.monthStartDay || 1)));
  let y = now.getFullYear();
  let m = now.getMonth();
  if (now.getDate() < sd) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  const startD = new Date(y, m, sd);
  const nextD = new Date(y, m + 1, sd);
  const endD = new Date(nextD.getTime() - DAY_MS);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const label = sd === 1
    ? startD.toLocaleDateString(undefined, { month: "long" })
    : `${fmt(startD)} – ${fmt(endD)}`;
  return {
    start: keyOf(startD),
    end: keyOf(endD),
    anchorYm: `${y}-${String(m + 1).padStart(2, "0")}`,
    days: daysBetween(startD, nextD),
    label,
  };
}

// ── Budget derivations ───────────────────────────────────────────────────────
// A period's pool: the monthly budget + that period's extra-income boost.
export function spendableForPeriod(s: Persisted, p: BudgetPeriod): number {
  return Math.max(0, s.settings.monthlyBudget || 0) + boostFor(s, p.anchorYm);
}
export function spendableMonthly(s: Persisted, now = new Date()): number {
  return spendableForPeriod(s, periodFor(s, now));
}
export function dailyAllowance(s: Persisted, now = new Date()): number {
  const p = periodFor(s, now);
  return spendableForPeriod(s, p) / p.days;
}

// Days of the current budget month that count: from the later of the period
// start and `trackingSince` through today (inclusive). Days before tracking
// began earn nothing — that money was spent untracked, so crediting it would
// inflate what's left.
export function daysTracked(s: Persisted, now = new Date()): number {
  const p = periodFor(s, now);
  let from = p.start;
  const ts = s.settings.trackingSince;
  if (ts && ts > from) from = ts;
  if (from > keyOf(now)) return 0; // tracking starts in the future
  const [y, m, d] = from.split("-").map(Number);
  return Math.max(0, daysBetween(new Date(y, (m || 1) - 1, d || 1), now) + 1);
}

export function spentInPeriod(s: Persisted, p: BudgetPeriod): number {
  return s.expenses.filter((e) => e.date >= p.start && e.date <= p.end).reduce((a, e) => a + (e.amount || 0), 0);
}
export function expensesInPeriod(s: Persisted, p: BudgetPeriod): Expense[] {
  return s.expenses.filter((e) => e.date >= p.start && e.date <= p.end).sort((a, b) => b.at - a.at);
}
// Calendar-month total — used by stats/assistant summaries.
export function spentInMonth(s: Persisted, ym: string): number {
  return s.expenses.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + (e.amount || 0), 0);
}
export function spentOnDay(s: Persisted, date: string): number {
  return s.expenses.filter((e) => e.date === date).reduce((a, e) => a + (e.amount || 0), 0);
}

// What's left to spend today: every tracked day adds a full daily budget, and
// whatever you didn't spend on earlier days rolls forward. Expenses dated
// before `trackingSince` stay in the stats but don't drain it (those days
// contributed no budget either).
export function liveBalance(s: Persisted, now = new Date()): number {
  const p = periodFor(s, now);
  const budget = dailyAllowance(s, now) * daysTracked(s, now);
  const ts = s.settings.trackingSince;
  const spent = s.expenses
    .filter((e) => e.date >= p.start && e.date <= p.end && (!ts || e.date >= ts))
    .reduce((a, e) => a + (e.amount || 0), 0);
  return budget - spent;
}

export function isConfigured(s: Persisted): boolean {
  return s.settings.monthlyBudget > 0;
}

// Transparent composition of what's left today, for display:
// balance = today's budget + carryover from earlier days − spent today.
export function meterBreakdown(s: Persisted, now = new Date()) {
  const balance = liveBalance(s, now);
  const tracked = daysTracked(s, now);
  const todayBudget = tracked > 0 ? dailyAllowance(s, now) : 0;
  const dayKey = keyOf(now);
  const ts = s.settings.trackingSince;
  const todaySpent = s.expenses
    .filter((e) => e.date === dayKey && (!ts || e.date >= ts))
    .reduce((a, e) => a + (e.amount || 0), 0);
  const carryover = balance - todayBudget + todaySpent;
  return { balance, todayBudget, todaySpent, carryover };
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
    out.push({ date: keyOf(d), amount: spentOnDay(s, keyOf(d)) });
  }
  return out;
}
