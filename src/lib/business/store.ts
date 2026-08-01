import { useSyncExternalStore } from "react";
import { deleteImage } from "./images";

export interface Company {
  id: string;
  name: string;
}
export interface BexioCode {
  code: string;
  label: string;
}
export interface Receipt {
  id: string;
  companyId: string;
  at: number;          // when it was added
  date: string;        // YYYY-MM-DD (receipt/invoice date)
  vendor: string;
  amount: number;      // gross total (incl. VAT)
  currency: string;    // CHF / EUR / USD …
  vatAmount: number;
  vatRate: number;     // %
  category: string;    // AI-suggested expense category
  description: string; // bookkeeping description
  bexioCode: string;   // account code the user assigned
  hasImage: boolean;
}

export interface BusinessState {
  companies: Company[];
  activeCompanyId: string | null;
  receipts: Receipt[];
  bexioCodes: BexioCode[];
  // Learned vendor → Bexio code memory. Keyed by a normalized vendor token so
  // e.g. "Meta Platforms Ireland" and "Meta" both map to the same code.
  vendorCodes: Record<string, string>;
}

const KEY = "vrent.business.v1";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

function load(): BusinessState {
  const empty: BusinessState = { companies: [], activeCompanyId: null, receipts: [], bexioCodes: [], vendorCodes: {} };
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!p) return empty;
    return {
      companies: Array.isArray(p.companies) ? p.companies : [],
      activeCompanyId: p.activeCompanyId ?? null,
      receipts: Array.isArray(p.receipts) ? p.receipts : [],
      bexioCodes: Array.isArray(p.bexioCodes) ? p.bexioCodes : [],
      vendorCodes: p.vendorCodes && typeof p.vendorCodes === "object" ? p.vendorCodes : {},
    };
  } catch {
    return empty;
  }
}

let state: BusinessState = load();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
}
function set(patch: Partial<BusinessState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

// The user's real Bexio account codes — seeded once so they're ready in the
// per-receipt dropdown without any typing. Seeding is one-time (guarded by a
// separate flag), so deleting a code in Setup makes it stick.
const DEFAULT_BEXIO_CODES: BexioCode[] = [
  { code: "1550", label: "Rental equipment (Meta Quest, XR glasses, etc.)" },
  { code: "4200", label: "Material costs (tissues, masks, headset cases, etc.)" },
  { code: "4270", label: "Post / transport expenses" },
  { code: "4650", label: "Packaging expense" },
  { code: "6200", label: "Car expenses" },
  { code: "6570", label: "IT costs" },
  { code: "6600", label: "Advertising" },
  { code: "6640", label: "Travel expenses" },
  { code: "6641", label: "Restaurant with client" },
];
const SEED_KEY = "vrent.business.seeded.v1";

function seedDefaultCodes() {
  try {
    if (localStorage.getItem(SEED_KEY)) return;
    localStorage.setItem(SEED_KEY, "1");
    const existing = new Set(state.bexioCodes.map((c) => c.code));
    const add = DEFAULT_BEXIO_CODES.filter((c) => !existing.has(c.code));
    if (add.length) {
      set({ bexioCodes: [...state.bexioCodes, ...add].sort((a, b) => a.code.localeCompare(b.code)) });
    }
  } catch { /* ignore */ }
}
seedDefaultCodes();

export function getBusiness(): BusinessState { return state; }
export function useBusiness(): BusinessState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state
  );
}

// Companies ------------------------------------------------------------------
export function addCompany(name: string): string {
  const id = uid();
  const company = { id, name: name.trim() || "Company" };
  set({ companies: [...state.companies, company], activeCompanyId: state.activeCompanyId || id });
  return id;
}
export function renameCompany(id: string, name: string) {
  set({ companies: state.companies.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)) });
}
export function removeCompany(id: string) {
  // Also drop that company's receipts + their images.
  state.receipts.filter((r) => r.companyId === id).forEach((r) => { if (r.hasImage) deleteImage(r.id); });
  const receipts = state.receipts.filter((r) => r.companyId !== id);
  const companies = state.companies.filter((c) => c.id !== id);
  const activeCompanyId = state.activeCompanyId === id ? (companies[0]?.id ?? null) : state.activeCompanyId;
  set({ companies, receipts, activeCompanyId });
}
export function setActiveCompany(id: string) { set({ activeCompanyId: id }); }

// Bexio codes ----------------------------------------------------------------
export function addBexioCode(code: string, label: string) {
  const c = code.trim();
  if (!c) return;
  if (state.bexioCodes.some((x) => x.code === c)) return;
  set({ bexioCodes: [...state.bexioCodes, { code: c, label: label.trim() }].sort((a, b) => a.code.localeCompare(b.code)) });
}
export function removeBexioCode(code: string) {
  set({ bexioCodes: state.bexioCodes.filter((x) => x.code !== code) });
}

// Receipts -------------------------------------------------------------------
export function addReceipt(r: Omit<Receipt, "id" | "at">): string {
  const id = uid();
  set({ receipts: [{ ...r, id, at: Date.now() }, ...state.receipts] });
  return id;
}
export function updateReceipt(id: string, patch: Partial<Receipt>) {
  set({ receipts: state.receipts.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}
export function removeReceipt(id: string) {
  const r = state.receipts.find((x) => x.id === id);
  if (r?.hasImage) deleteImage(id);
  set({ receipts: state.receipts.filter((x) => x.id !== id) });
}

// Vendor learning ------------------------------------------------------------
// Reduce a vendor name to a stable key: lowercase, strip company suffixes &
// punctuation, keep the first meaningful word. "Meta Platforms Ireland Ltd" and
// "META*ADS" both collapse to "meta".
const STOP = new Set(["the", "gmbh", "ag", "sa", "ltd", "inc", "llc", "co", "kg", "plc", "srl", "bv", "platforms", "group"]);
export function vendorKey(vendor: string): string {
  const words = (vendor || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return words[0] || "";
}
// Remember which code the user files a vendor under, so it auto-fills next time.
export function rememberVendorCode(vendor: string, code: string) {
  const k = vendorKey(vendor);
  const c = (code || "").trim();
  if (!k || !c) return;
  if (state.vendorCodes[k] === c) return;
  set({ vendorCodes: { ...state.vendorCodes, [k]: c } });
}
// Suggest a code for a vendor from what was learned before (empty if unknown).
export function suggestCodeForVendor(vendor: string): string {
  const k = vendorKey(vendor);
  return (k && state.vendorCodes[k]) || "";
}

// Derived --------------------------------------------------------------------
export function receiptsFor(s: BusinessState, companyId: string | null): Receipt[] {
  if (!companyId) return [];
  return s.receipts.filter((r) => r.companyId === companyId).sort((a, b) => (b.date + String(b.at)).localeCompare(a.date + String(a.at)));
}
export function totalsFor(list: Receipt[]) {
  return list.reduce(
    (acc, r) => ({ count: acc.count + 1, gross: acc.gross + (r.amount || 0), vat: acc.vat + (r.vatAmount || 0) }),
    { count: 0, gross: 0, vat: 0 }
  );
}

// Statistics ------------------------------------------------------------------
export function monthOf(r: Receipt): string { return (r.date || "").slice(0, 7); } // YYYY-MM

// Distinct months present in a receipt set, newest first.
export function monthsWith(list: Receipt[]): string[] {
  const set = new Set<string>();
  for (const r of list) { const m = monthOf(r); if (/^\d{4}-\d{2}$/.test(m)) set.add(m); }
  return [...set].sort().reverse();
}

export function receiptsInMonth(list: Receipt[], ym: string): Receipt[] {
  if (ym === "all") return list;
  return list.filter((r) => monthOf(r) === ym);
}

export interface CodeStat { code: string; label: string; amount: number; count: number; share: number; }
export interface MonthStats {
  count: number;
  gross: number;
  vat: number;
  net: number;          // gross − vat
  avg: number;          // gross / count
  currency: string;     // dominant currency
  mixedCurrency: boolean;
  unassigned: number;   // receipts with no Bexio code yet
  byCode: CodeStat[];   // sorted by amount desc
}

// Aggregate a receipt set into descriptive stats grouped by Bexio code.
export function statsFor(list: Receipt[], codes: BexioCode[]): MonthStats {
  const byCur: Record<string, number> = {};
  for (const r of list) { const c = r.currency || "CHF"; byCur[c] = (byCur[c] || 0) + (r.amount || 0); }
  const currency = Object.keys(byCur).sort((a, b) => byCur[b] - byCur[a])[0] || "CHF";
  const mixedCurrency = Object.keys(byCur).length > 1;

  const gross = list.reduce((s, r) => s + (r.amount || 0), 0);
  const vat = list.reduce((s, r) => s + (r.vatAmount || 0), 0);

  const map: Record<string, { amount: number; count: number }> = {};
  let unassigned = 0;
  for (const r of list) {
    const k = r.bexioCode?.trim() || "__none__";
    if (k === "__none__") unassigned++;
    map[k] = map[k] || { amount: 0, count: 0 };
    map[k].amount += r.amount || 0;
    map[k].count += 1;
  }
  const labelOf = (code: string) =>
    code === "__none__" ? "Unassigned" : codes.find((c) => c.code === code)?.label || "—";
  const byCode: CodeStat[] = Object.entries(map)
    .map(([code, v]) => ({
      code: code === "__none__" ? "" : code,
      label: labelOf(code),
      amount: v.amount,
      count: v.count,
      share: gross ? v.amount / gross : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    count: list.length,
    gross,
    vat,
    net: gross - vat,
    avg: list.length ? gross / list.length : 0,
    currency,
    mixedCurrency,
    unassigned,
    byCode,
  };
}

// Monthly gross totals across the last `n` months for a trend chart.
export function monthlyTotals(list: Receipt[], n = 6): { ym: string; gross: number }[] {
  const now = new Date();
  const out: { ym: string; gross: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const gross = list.filter((r) => monthOf(r) === ym).reduce((s, r) => s + (r.amount || 0), 0);
    out.push({ ym, gross });
  }
  return out;
}
