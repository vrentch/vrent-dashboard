import type { History } from "./api";

export interface Analytics {
  last: number | null;
  changePct: number | null; // over the whole range
  high: number | null;
  low: number | null;
  sma: number | null; // simple moving average across the series
  volatilityPct: number | null; // stdev of daily returns, annualised-ish %
  trend: "up" | "down" | "flat";
}

export function computeAnalytics(h: History | null): Analytics {
  const empty: Analytics = {
    last: null,
    changePct: null,
    high: null,
    low: null,
    sma: null,
    volatilityPct: null,
    trend: "flat",
  };
  if (!h || h.closes.length < 2) return empty;

  const c = h.closes;
  const first = c[0];
  const last = c[c.length - 1];
  const high = Math.max(...c);
  const low = Math.min(...c);
  const sma = c.reduce((a, b) => a + b, 0) / c.length;
  const changePct = first ? ((last - first) / first) * 100 : null;

  // Standard deviation of period-over-period returns.
  const returns: number[] = [];
  for (let i = 1; i < c.length; i++) {
    if (c[i - 1]) returns.push((c[i] - c[i - 1]) / c[i - 1]);
  }
  let volatilityPct: number | null = null;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    volatilityPct = Math.sqrt(variance) * 100;
  }

  const trend: Analytics["trend"] =
    changePct == null || Math.abs(changePct) < 0.05 ? "flat" : changePct > 0 ? "up" : "down";

  return { last, changePct, high, low, sma, volatilityPct, trend };
}
