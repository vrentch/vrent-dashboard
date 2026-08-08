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
  source?: "applepay"; // auto-imported from the Apple Pay Shortcut automation
}

// One-time income (bonus, 13th salary, side gig) allocated across the month's
// buckets. Everything allocated to tax / fixed / spending frees or adds money
// this month → raises the month's spendable pool and the daily/hourly rates.
// Only the savings share stays out of the meter.
export interface ExtraIncome {
  id: string;
  at: number;
  month: string;     // YYYY-MM the income applies to
  label: string;
  amount: number;
  toTax: number;     // covers (part of) the month's tax reserve
  toFixed: number;   // covers (part of) fixed costs, e.g. this month's rent
  toSavings: number; // straight to savings — not spendable
  toSpend: number;   // directly into the daily budget
}

export type Canton =
  | "ZH" | "BE" | "LU" | "UR" | "SZ" | "OW" | "NW" | "GL" | "ZG" | "FR" | "SO" | "BS" | "BL"
  | "SH" | "AR" | "AI" | "SG" | "GR" | "AG" | "TG" | "TI" | "VD" | "VS" | "NE" | "GE" | "JU" | "OTHER";
export type MaritalStatus = "single" | "married" | "divorced";
export type TaxSystem = "CH" | "UK" | "none";

export interface MoneySettings {
  // The monthly income figure. Its meaning depends on the tax system:
  //  CH   — what lands on the bank account (social insurances already deducted;
  //         income tax is NOT withheld in Switzerland, so it's reserved here).
  //  UK   — gross salary; PAYE (Income Tax + National Insurance) is estimated
  //         and deducted to get take-home.
  //  none — taken as-is, no tax deduction at all.
  bankMonthly: number;
  taxSystem: TaxSystem;
  canton: Canton;                  // CH only
  gemeinde: string;                // CH only — free text, refined via AI lookup
  status: MaritalStatus;
  taxPct: number | null;           // manual effective tax % (null = estimate)
  currency: string;                // display currency (CHF, GBP, …)
  savingsMode: "amount" | "percent";
  savingsValue: number;            // amount/month or % of after-tax income
  trackingSince: string;           // YYYY-MM-DD — accrual never starts earlier
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

export const CANTONS: { key: Canton; label: string }[] = [
  { key: "AG", label: "Aargau" },
  { key: "AR", label: "Appenzell A.Rh." },
  { key: "AI", label: "Appenzell I.Rh." },
  { key: "BL", label: "Basel-Landschaft" },
  { key: "BS", label: "Basel-Stadt" },
  { key: "BE", label: "Bern" },
  { key: "FR", label: "Fribourg" },
  { key: "GE", label: "Genève" },
  { key: "GL", label: "Glarus" },
  { key: "GR", label: "Graubünden" },
  { key: "JU", label: "Jura" },
  { key: "LU", label: "Luzern" },
  { key: "NE", label: "Neuchâtel" },
  { key: "NW", label: "Nidwalden" },
  { key: "OW", label: "Obwalden" },
  { key: "SH", label: "Schaffhausen" },
  { key: "SZ", label: "Schwyz" },
  { key: "SO", label: "Solothurn" },
  { key: "SG", label: "St. Gallen" },
  { key: "TI", label: "Ticino" },
  { key: "TG", label: "Thurgau" },
  { key: "UR", label: "Uri" },
  { key: "VD", label: "Vaud" },
  { key: "VS", label: "Valais" },
  { key: "ZG", label: "Zug" },
  { key: "ZH", label: "Zürich" },
  { key: "OTHER", label: "Other" },
];

const KEY = "vrent.money.v1";
// Fixed expenses live in settings so they persist with the config.
interface Persisted extends MoneyState { fixed: FixedExpense[]; extras: ExtraIncome[] }

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; }
}

function defaults(): Persisted {
  return {
    settings: {
      bankMonthly: 0, taxSystem: "CH", canton: "ZH", gemeinde: "", status: "single", taxPct: null,
      currency: "CHF",
      savingsMode: "amount", savingsValue: 0,
      trackingSince: "",
    },
    expenses: [],
    fixed: [],
    extras: [],
  };
}

function load(): Persisted {
  const d = defaults();
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!p) return d;
    const raw = p.settings || {};
    const expenses: Expense[] = Array.isArray(p.expenses) ? p.expenses : [];
    // Migrate the old gross-salary model: the closest stand-in for "received on
    // the bank account" is the old net override, else gross minus ~12.5% social.
    const bankMonthly =
      raw.bankMonthly ?? (raw.netOverride != null && raw.netOverride > 0 ? raw.netOverride : raw.grossMonthly ? Math.round(raw.grossMonthly * 0.875) : 0);
    // Accrual must not start before the user actually began tracking — for
    // existing data, the earliest logged expense is the honest start; a
    // configured legacy store with no expenses starts today (never month-start,
    // which would grant phantom credit).
    const trackingSince =
      raw.trackingSince ||
      (expenses.length ? expenses.map((e) => e.date).sort()[0] : bankMonthly > 0 ? todayKey() : "");
    const settings = { ...d.settings, ...raw, bankMonthly, taxPct: raw.taxPct ?? null, trackingSince };
    // Drop legacy keys so they don't get re-persisted forever.
    delete (settings as any).grossMonthly;
    delete (settings as any).netOverride;
    delete (settings as any).deductionPct;
    return {
      settings,
      expenses,
      fixed: Array.isArray(p.fixed) ? p.fixed : [],
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
  // Stamp the tracking start the moment affordability is first configured, so
  // the meter never credits days that were never tracked. Only auto-stamp when
  // the patch didn't touch trackingSince — an explicit user value must win.
  if (!("trackingSince" in patch) && !next.trackingSince && next.bankMonthly > 0) next.trackingSince = todayKey();
  // Switching tax system implies the natural currency (unless set explicitly);
  // the manual tax % also resets since it belonged to the previous system.
  if ("taxSystem" in patch && patch.taxSystem !== state.settings.taxSystem) {
    if (!("currency" in patch)) next.currency = patch.taxSystem === "UK" ? "GBP" : patch.taxSystem === "CH" ? "CHF" : next.currency;
    if (!("taxPct" in patch)) next.taxPct = null;
  }
  set({ settings: next });
}
export function addFixed(label: string, amount: number) {
  if (!label.trim() || !(amount > 0)) return;
  set({ fixed: [...state.fixed, { id: uid(), label: label.trim(), amount }] });
}
export function removeFixed(id: string) { set({ fixed: state.fixed.filter((f) => f.id !== id) }); }

// Extra income (bonus / one-time) -------------------------------------------
export function addExtra(e: { month: string; label: string; amount: number; toTax: number; toFixed: number; toSavings: number; toSpend: number }): string {
  const id = uid();
  const nz = (n: number) => Math.max(0, Math.round((n || 0) * 100) / 100);
  set({
    extras: [
      { id, at: Date.now(), month: e.month, label: (e.label || "Extra income").trim(), amount: nz(e.amount), toTax: nz(e.toTax), toFixed: nz(e.toFixed), toSavings: nz(e.toSavings), toSpend: nz(e.toSpend) },
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
export function fixedList(s: Persisted): FixedExpense[] { return s.fixed; }

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
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysInMonth(d: Date): number { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

// ── Tax estimates (approximate — the slider / AI lookup refine them) ──────────

// Switzerland: the bank amount already excludes social insurances (employer
// withholds AHV/ALV/BVG/NBU). What still has to be paid out of it is income
// tax: Kantons- + Gemeinde- + Bundessteuer, which varies strongly by canton
// (and Gemeinde — refined via the AI lookup). Base effective bands scaled by a
// per-canton factor; married gets a rough splitting discount.
const CANTON_FACTOR: Record<string, number> = {
  ZG: 0.45, NW: 0.5, SZ: 0.55, UR: 0.6, OW: 0.6, AI: 0.6,
  AR: 0.75, GL: 0.75, TG: 0.75, LU: 0.8,
  SG: 0.85, GR: 0.85, AG: 0.85, SH: 0.85, ZH: 0.9, BL: 0.95,
  SO: 1.0, VS: 1.0, TI: 1.0, FR: 1.05, BS: 1.05, BE: 1.1,
  GE: 1.15, VD: 1.15, NE: 1.2, JU: 1.2, OTHER: 1.0,
};
function swissTaxPct(canton: Canton, status: MaritalStatus, annualIncome: number): number {
  const base = annualIncome <= 55000 ? 7 : annualIncome <= 90000 ? 12 : annualIncome <= 135000 ? 16 : 20;
  let pct = base * (CANTON_FACTOR[canton] ?? 1.0);
  if (status === "married") pct *= 0.8; // rough splitting benefit
  return pct;
}

// United Kingdom: PAYE — Income Tax (personal allowance £12,570, tapered above
// £100k) + employee National Insurance (8% / 2%). 2024/25 rates; the input is
// gross salary, so the estimate IS the deduction at source.
function ukPayePct(annualGross: number): number {
  if (annualGross <= 0) return 0;
  const allowance = Math.max(0, 12570 - Math.max(0, annualGross - 100000) / 2);
  const taxable = Math.max(0, annualGross - allowance);
  const it =
    0.2 * Math.min(taxable, 37700) +
    0.4 * Math.min(Math.max(taxable - 37700, 0), 112570 - 37700) +
    0.45 * Math.max(taxable - 112570, 0);
  const ni = 0.08 * Math.min(Math.max(annualGross - 12570, 0), 50270 - 12570) + 0.02 * Math.max(annualGross - 50270, 0);
  return ((it + ni) / annualGross) * 100;
}

export function estimatedTaxPct(s: MoneySettings): number {
  if (s.taxPct != null) return s.taxPct;
  const annual = s.bankMonthly * 12;
  const sys = s.taxSystem || "CH";
  const pct = sys === "none" ? 0 : sys === "UK" ? ukPayePct(annual) : swissTaxPct(s.canton, s.status, annual);
  return Math.round(pct * 10) / 10;
}
// What's actually yours to allocate: bank amount minus the tax reserve.
export function afterTaxMonthly(s: MoneySettings): number {
  return Math.max(0, s.bankMonthly * (1 - estimatedTaxPct(s) / 100));
}
export function taxReserveMonthly(s: MoneySettings): number {
  return Math.max(0, s.bankMonthly - afterTaxMonthly(s));
}

// ── Affordability derivations ────────────────────────────────────────────────
export function savingsMonthly(s: Persisted): number {
  const net = afterTaxMonthly(s.settings);
  const v = Math.max(0, s.settings.savingsValue || 0); // negative savings would inflate the meter
  return s.settings.savingsMode === "percent" ? (net * v) / 100 : v;
}
export function fixedMonthly(s: Persisted): number { return s.fixed.reduce((a, f) => a + (f.amount || 0), 0); }
// The recurring monthly pool from salary alone (no one-time income).
export function baseSpendableMonthly(s: Persisted): number {
  return Math.max(0, afterTaxMonthly(s.settings) - fixedMonthly(s) - savingsMonthly(s));
}
// A specific month's pool: recurring base + that month's extra-income boost.
export function spendableForMonth(s: Persisted, ym: string): number {
  return baseSpendableMonthly(s) + boostFor(s, ym);
}
export function spendableMonthly(s: Persisted, now = new Date()): number {
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return spendableForMonth(s, ym);
}
export function dailyAllowance(s: Persisted, now = new Date()): number {
  return spendableMonthly(s, now) / daysInMonth(now);
}
// Days of this month that count toward the budget: from the later of the 1st
// and `trackingSince` through today (inclusive). Days before tracking began
// earn nothing — that money was spent untracked, so crediting it would inflate
// what's left.
export function daysTracked(s: Persisted, now = new Date()): number {
  const ts = s.settings.trackingSince;
  let startDay = 1;
  if (ts) {
    const [y, m, d] = ts.split("-").map(Number);
    const tsDate = new Date(y || 0, (m || 1) - 1, d || 1);
    if (tsDate > now) return 0; // tracking starts in the future
    if (y === now.getFullYear() && m === now.getMonth() + 1) startDay = Math.max(1, d || 1);
  }
  return Math.max(0, now.getDate() - startDay + 1);
}

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
  const budget = dailyAllowance(s, now) * daysTracked(s, now);
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ts = s.settings.trackingSince;
  const spent = s.expenses
    .filter((e) => e.date.startsWith(ym) && (!ts || e.date >= ts))
    .reduce((a, e) => a + (e.amount || 0), 0);
  return budget - spent;
}

export function isConfigured(s: Persisted): boolean {
  return s.settings.bankMonthly > 0;
}

// Transparent composition of what's left today, for display:
// balance = today's budget + carryover from earlier days − spent today.
export function meterBreakdown(s: Persisted, now = new Date()) {
  const balance = liveBalance(s, now);
  const tracked = daysTracked(s, now);
  const todayBudget = tracked > 0 ? dailyAllowance(s, now) : 0;
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: key, amount: spentOnDay(s, key) });
  }
  return out;
}

export function expensesInMonth(s: Persisted, ym: string): Expense[] {
  return s.expenses.filter((e) => e.date.startsWith(ym)).sort((a, b) => b.at - a.at);
}
