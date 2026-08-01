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
