// Swiss-formatted money + month helpers for the Business stats.

// e.g. chf(1234.5) → "CHF 1'234.50"  (Swiss apostrophe thousands separator).
// Negatives are formatted ourselves ("− CHF 19.87") because de-CH's CLDR
// pattern glues the minus to the code ("CHF-19.87"); sub-cent values round to
// a clean zero instead of "−0.00".
export function chf(n: number, currency = "CHF"): string {
  let v = Math.round((n || 0) * 100) / 100;
  if (v === 0) v = 0; // normalize −0
  const neg = v < 0;
  const abs = neg ? -v : v;
  try {
    const out = new Intl.NumberFormat("de-CH", { style: "currency", currency }).format(abs);
    return neg ? `− ${out}` : out;
  } catch {
    return `${neg ? "− " : ""}${currency} ${abs.toFixed(2)}`;
  }
}

// Whole-franc version for compact tiles: "CHF 1'235"
export function chfRound(n: number, currency = "CHF"): string {
  try {
    return new Intl.NumberFormat("de-CH", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return `${currency} ${Math.round(n || 0)}`;
  }
}

// "2026-08" → "August 2026" (long) or "Aug 2026" (short)
export function monthLabel(ym: string, long = true): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: "numeric" });
}

// "2026-08" → "Aug '26" for compact chips
export function monthChip(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return `${d.toLocaleDateString("en-GB", { month: "short" })} '${String(y).slice(2)}`;
}
