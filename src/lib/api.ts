// Client-side API layer. Talks to /api/* which is served by the Vite dev
// middleware locally and by the serverless function in production.

import { COUNTRIES, TOPICS } from "../../shared/catalog";

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  imageUrl: string | null;
  countryCode: string;
  topicKey: string;
}

export interface NewsResponse {
  items: NewsItem[];
  errors: string[];
  count: number;
}

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
  timestamps: number[];
  closes: number[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function fetchNews(opts: {
  countries: string[];
  topics: string[];
  query?: string;
}): Promise<NewsResponse> {
  // The client owns the catalog, so it resolves each country×topic into a
  // fully-formed feed descriptor. The serverless function stays catalog-free.
  const countries = opts.countries.length
    ? COUNTRIES.filter((c) => opts.countries.includes(c.code))
    : [COUNTRIES[0]];
  const topics = opts.topics.length
    ? TOPICS.filter((t) => opts.topics.includes(t.key))
    : [TOPICS[0]];

  const spec = [] as Array<{
    country: string;
    topic: string;
    hl: string;
    gl: string;
    ceid: string;
    section?: string;
    query?: string;
  }>;
  for (const c of countries) {
    for (const t of topics) {
      spec.push({
        country: c.code,
        topic: t.key,
        hl: `${c.lang}-${c.code}`,
        gl: c.code,
        ceid: `${c.code}:${c.lang}`,
        section: t.section,
        query: t.query,
      });
    }
  }

  const p = new URLSearchParams();
  p.set("spec", JSON.stringify(spec));
  if (opts.query) p.set("q", opts.query);
  return getJson<NewsResponse>(`/api/news?${p.toString()}`);
}

export function fetchQuotes(symbols: string[]): Promise<{ quotes: Quote[]; errors: string[] }> {
  const p = new URLSearchParams({ symbols: symbols.join(",") });
  return getJson(`/api/quote?${p.toString()}`);
}

export function fetchHistory(symbol: string, range: string): Promise<History> {
  const p = new URLSearchParams({ symbol, range });
  return getJson<History>(`/api/history?${p.toString()}`);
}
