// Live market data via Yahoo Finance's public chart endpoint. No API key
// required. This is an unofficial endpoint — reliable in practice and widely
// used, but not contractually guaranteed by Yahoo.

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketState: string;
  exchange: string;
}

export interface History {
  symbol: string;
  range: string;
  currency: string;
  timestamps: number[]; // seconds
  closes: number[];
}

// Map a UI range to Yahoo's range + interval.
const RANGES: Record<string, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};

async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${symbol}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`no data for ${symbol}`);
  return result;
}

export async function getQuotes(symbols: string[]): Promise<{ quotes: Quote[]; errors: string[] }> {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const settled = await Promise.allSettled(
    clean.map((s) => fetchChart(s, "1d", "5m"))
  );
  const quotes: Quote[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      errors.push(`${clean[i]}: ${String(r.reason).slice(0, 100)}`);
      return;
    }
    const meta = r.value.meta || {};
    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && prev != null ? price - prev : null;
    const changePercent = change != null && prev ? (change / prev) * 100 : null;
    quotes.push({
      symbol: meta.symbol || clean[i],
      name: meta.longName || meta.shortName || meta.symbol || clean[i],
      currency: meta.currency || "USD",
      price,
      previousClose: prev,
      change,
      changePercent,
      marketState: meta.marketState || "",
      exchange: meta.fullExchangeName || meta.exchangeName || "",
    });
  });
  // Preserve requested order.
  quotes.sort((a, b) => clean.indexOf(a.symbol.toUpperCase()) - clean.indexOf(b.symbol.toUpperCase()));
  return { quotes, errors };
}

export async function getHistory(symbol: string, uiRange: string): Promise<History> {
  const r = RANGES[uiRange] || RANGES["1M"];
  const result = await fetchChart(symbol, r.range, r.interval);
  const meta = result.meta || {};
  const timestamps: number[] = result.timestamp || [];
  const closesRaw: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

  // Yahoo pads gaps with nulls; drop them, keeping timestamp alignment.
  const timestampsOut: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closesRaw[i];
    if (c == null) continue;
    timestampsOut.push(timestamps[i]);
    closes.push(c);
  }

  return {
    symbol: meta.symbol || symbol.toUpperCase(),
    range: uiRange,
    currency: meta.currency || "USD",
    timestamps: timestampsOut,
    closes,
  };
}

export const SUPPORTED_RANGES = Object.keys(RANGES);
