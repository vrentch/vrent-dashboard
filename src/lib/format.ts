export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtPrice(v: number | null, currency = "USD"): string {
  if (v == null) return "—";
  const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v);
  } catch {
    return v.toFixed(digits);
  }
}

export function fmtNum(v: number | null, digits = 2): string {
  if (v == null) return "—";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// Friendly names for commodity futures (CNBC uses "@GC.1" etc.).
const COMMODITY_NAMES: Record<string, string> = {
  "@GC.1": "Gold", "@SI.1": "Silver", "@PL.1": "Platinum", "@PA.1": "Palladium", "@HG.1": "Copper",
  "@CL.1": "WTI Crude", "@BZ.1": "Brent", "@LCO.1": "Brent", "@NG.1": "Nat Gas", "@RB.1": "Gasoline", "@HO.1": "Heating Oil",
  "@C.1": "Corn", "@W.1": "Wheat", "@S.1": "Soybeans", "@KC.1": "Coffee", "@SB.1": "Sugar", "@CT.1": "Cotton", "@CC.1": "Cocoa",
};

/** Tidy a provider ticker for display: NESN-CH → NESN, BTC-USD → BTC, @GC.1 → Gold. */
export function cleanSymbol(sym: string): string {
  const upper = sym.toUpperCase();
  if (COMMODITY_NAMES[upper]) return COMMODITY_NAMES[upper];
  return sym
    .replace(/-CH$/, "")
    .replace(/-USD$/, "")
    .replace(/=X$/, "")
    .replace(/=F$/, "")
    .replace(/^@/, "")
    .replace(/\.\d+$/, "")
    .replace(/^\^/, "");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
