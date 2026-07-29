// Self-contained serverless API for AC News.
//
// IMPORTANT: this file must not use relative imports. Vercel runs each API
// file as native ESM (the project is `"type": "module"`), and native ESM does
// not resolve extensionless cross-file imports — that previously crashed the
// function with ERR_MODULE_NOT_FOUND / FUNCTION_INVOCATION_FAILED. Everything
// the endpoint needs is inlined here; the only import is the published
// `fast-xml-parser` package (a bare specifier, always resolvable).
//
// The Vite dev middleware imports `handleApi` from this same file, so local
// dev and production run identical code.

import type { IncomingMessage, ServerResponse } from "node:http";
import { XMLParser } from "fast-xml-parser";

// ── RSS parsing ─────────────────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  imageUrl: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Feeds are entity-heavy and trip the parser's billion-laughs guard; we
  // leave entities untouched and decode them ourselves below.
  processEntities: false,
});

const RSS_UA = "Mozilla/5.0 (compatible; ACNews/1.0; +https://vrent.ch)";

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'",
};

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+|#\d+);/g, (m, name) => NAMED[name] ?? m);
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return String(v);
}

function findImage(item: Record<string, any>, summaryHtml: string): string | null {
  const mediaContent = asArray(item["media:content"])[0];
  if (mediaContent?.["@_url"]) return mediaContent["@_url"];
  const mediaThumb = asArray(item["media:thumbnail"])[0];
  if (mediaThumb?.["@_url"]) return mediaThumb["@_url"];
  const enclosure = asArray(item.enclosure).find((e: any) =>
    String(e?.["@_type"] || "").startsWith("image")
  );
  if (enclosure?.["@_url"]) return enclosure["@_url"];
  const m = summaryHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

async function fetchFeed(url: string, fallbackSource: string, limit = 40): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": RSS_UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const xml = await res.text();
  const doc = parser.parse(xml);

  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"];
  const feed = doc?.feed;
  const channelTitle = textOf(channel?.title) || textOf(feed?.title) || fallbackSource;
  const rawItems = channel ? asArray(channel.item) : asArray(feed?.entry);

  const items: FeedItem[] = rawItems.slice(0, limit).map((it: any, i: number) => {
    const title = stripHtml(textOf(it.title));
    let link = "";
    if (typeof it.link === "string") link = it.link;
    else if (Array.isArray(it.link)) {
      const alt = it.link.find((l: any) => l["@_rel"] === "alternate") || it.link[0];
      link = alt?.["@_href"] || "";
    } else if (it.link?.["@_href"]) link = it.link["@_href"];
    link = decodeEntities(link || textOf(it.guid) || textOf(it.id));

    const rawSummary =
      textOf(it.description) || textOf(it.summary) || textOf(it["content:encoded"]) || textOf(it.content);
    const summary = stripHtml(rawSummary).slice(0, 320);
    const source = decodeEntities(textOf(it.source) || channelTitle);
    const dateStr =
      textOf(it.pubDate) || textOf(it.published) || textOf(it.updated) || textOf(it["dc:date"]);
    const parsed = dateStr ? new Date(dateStr) : null;
    const publishedAt = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;

    return { id: link || `${channelTitle}-${i}`, title, link, source, publishedAt, summary, imageUrl: findImage(it, rawSummary) };
  });

  return items.filter((it) => it.title && it.link);
}

// ── News ─────────────────────────────────────────────────────────────────────

// The client (which owns the country/topic catalog) sends fully-resolved feed
// descriptors, so this endpoint needs no catalog of its own.
interface FeedSpec {
  country: string;
  topic: string;
  hl: string;
  gl: string;
  ceid: string;
  section?: string;
  query?: string;
}

interface NewsItem extends FeedItem {
  countryCode: string;
  topicKey: string;
}

const GN = "https://news.google.com/rss";

function gnUrl(spec: FeedSpec, extra?: string): string {
  const loc = `hl=${encodeURIComponent(spec.hl)}&gl=${encodeURIComponent(spec.gl)}&ceid=${encodeURIComponent(spec.ceid)}`;
  const extraQ = (extra || "").trim();
  if (spec.topic === "top" && !spec.query && !extraQ) return `${GN}?${loc}`;
  if (spec.section && !extraQ) {
    return `${GN}/headlines/section/topic/${encodeURIComponent(spec.section)}?${loc}`;
  }
  const q = [spec.query, extraQ].filter(Boolean).join(" ");
  if (!q) return `${GN}?${loc}`;
  return `${GN}/search?q=${encodeURIComponent(q)}&${loc}`;
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(it);
  }
  return out;
}

async function getNews(specs: FeedSpec[], query?: string) {
  const list = specs.length ? specs : [];
  const results = await Promise.allSettled(
    list.map((s) => fetchFeed(gnUrl(s, query), `${s.country} · ${s.topic}`))
  );
  const tagged: NewsItem[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    const s = list[i];
    if (r.status === "fulfilled") {
      for (const it of r.value) tagged.push({ ...it, countryCode: s.country, topicKey: s.topic });
    } else {
      errors.push(`${s.country}/${s.topic}: ${String(r.reason).slice(0, 100)}`);
    }
  });
  const merged = dedupe(tagged);
  merged.sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0));
  return { items: merged.slice(0, 150), errors, count: merged.length };
}

// ── Stocks (Yahoo Finance public chart endpoint) ────────────────────────────

const Y_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const Y_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const RANGES: Record<string, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};

async function fetchChart(symbol: string, range: string, interval: string) {
  const url = `${Y_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": Y_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`no data for ${symbol}`);
  return result;
}

async function getQuotes(symbols: string[]) {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const settled = await Promise.allSettled(clean.map((s) => fetchChart(s, "1d", "5m")));
  const quotes: any[] = [];
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
      price, previousClose: prev, change, changePercent,
      marketState: meta.marketState || "",
      exchange: meta.fullExchangeName || meta.exchangeName || "",
    });
  });
  quotes.sort((a, b) => clean.indexOf(a.symbol.toUpperCase()) - clean.indexOf(b.symbol.toUpperCase()));
  return { quotes, errors };
}

async function getHistory(symbol: string, uiRange: string) {
  const r = RANGES[uiRange] || RANGES["1M"];
  const result = await fetchChart(symbol, r.range, r.interval);
  const meta = result.meta || {};
  const timestamps: number[] = result.timestamp || [];
  const closesRaw: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
  const timestampsOut: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closesRaw[i];
    if (c == null) continue;
    timestampsOut.push(timestamps[i]);
    closes.push(c);
  }
  return { symbol: meta.symbol || symbol.toUpperCase(), range: uiRange, currency: meta.currency || "USD", timestamps: timestampsOut, closes };
}

// ── Router (shared by dev middleware and the serverless handler) ─────────────

export async function handleApi(pathname: string, search: URLSearchParams): Promise<{ status: number; body: unknown }> {
  try {
    const route = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

    if (route === "news") {
      let specs: FeedSpec[] = [];
      try {
        specs = JSON.parse(search.get("spec") || "[]");
      } catch {
        specs = [];
      }
      const data = await getNews(Array.isArray(specs) ? specs : [], search.get("q") || undefined);
      return { status: 200, body: data };
    }

    if (route === "quote") {
      const symbols = (search.get("symbols") || "").split(",").filter(Boolean);
      if (!symbols.length) return { status: 400, body: { error: "symbols required" } };
      return { status: 200, body: await getQuotes(symbols) };
    }

    if (route === "history") {
      const symbol = search.get("symbol") || "";
      const range = search.get("range") || "1M";
      if (!symbol) return { status: 400, body: { error: "symbol required" } };
      return { status: 200, body: await getHistory(symbol, range) };
    }

    return { status: 404, body: { error: `unknown route: ${route}` } };
  } catch (err) {
    return { status: 502, body: { error: String(err instanceof Error ? err.message : err) } };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const { status, body } = await handleApi(url.pathname, url.searchParams);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.end(JSON.stringify(body));
}
