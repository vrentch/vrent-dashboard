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

// ── Stocks (CNBC public quote + chart endpoints) ─────────────────────────────
//
// Keyless and reachable from data-center IPs (unlike Yahoo, which rate-limits
// cloud servers with HTTP 429). Quotes for all symbols come back in a single
// request; charts come from the harmony chart service.

const CNBC_QUOTE = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";
const CNBC_CHART = "https://ts-api.cnbc.com/harmony/app/charts";
const CNBC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Translate common Yahoo-style tickers to CNBC symbols. Plain stock tickers
// (AAPL, MSFT, …) pass through unchanged.
const SYMBOL_MAP: Record<string, string> = {
  "^GSPC": ".SPX", "^IXIC": ".IXIC", "^DJI": ".DJI", "^RUT": ".RUT",
  "^GDAXI": ".GDAXI", "^FTSE": ".FTSE", "^FCHI": ".FCHI", "^N225": ".N225",
  "^HSI": ".HSI", "^SSMI": ".SSMI",
  "BTC-USD": "BTC.CM=", "ETH-USD": "ETH.CM=", "SOL-USD": "SOL.CM=", "XRP-USD": "XRP.CM=",
  "EURUSD=X": "EUR=", "GBPUSD=X": "GBP=", "USDJPY=X": "JPY=", "USDCHF=X": "CHF=",
  "GC=F": "@GC.1", "SI=F": "@SI.1", "CL=F": "@CL.1", "NG=F": "@NG.1",
};

function toCnbc(sym: string): string {
  const s = sym.trim().toUpperCase();
  return SYMBOL_MAP[s] || s;
}

function num(s: unknown): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,%+\s]/g, ""));
  return isNaN(n) ? null : n;
}

// Group each instrument into a country/region section for the Markets overview.
const INDEX_COUNTRY: Record<string, string> = {
  ".SPX": "US", ".IXIC": "US", ".DJI": "US", ".RUT": "US",
  ".GDAXI": "DE", ".FTSE": "GB", ".FCHI": "FR", ".N225": "JP", ".HSI": "HK", ".SSMI": "CH",
};
const REGION_META: Record<string, { region: string; flag: string }> = {
  US: { region: "United States", flag: "🇺🇸" },
  DE: { region: "Germany", flag: "🇩🇪" },
  GB: { region: "United Kingdom", flag: "🇬🇧" },
  FR: { region: "France", flag: "🇫🇷" },
  CH: { region: "Switzerland", flag: "🇨🇭" },
  JP: { region: "Japan", flag: "🇯🇵" },
  HK: { region: "Hong Kong", flag: "🇭🇰" },
  CA: { region: "Canada", flag: "🇨🇦" },
};

function regionOf(cnbcSymbol: string, exchange: string): { region: string; flag: string } {
  const c = cnbcSymbol.toUpperCase();
  if (c.includes(".CM=")) return { region: "Crypto", flag: "🪙" };
  if (c.startsWith("@")) return { region: "Commodities", flag: "🛢️" };
  if (/^[A-Z]{3}=$/.test(c)) return { region: "Currencies", flag: "💱" };
  let cc = INDEX_COUNTRY[c];
  if (!cc) {
    const ex = (exchange || "").toUpperCase();
    if (/NASDAQ|NYSE|AMEX|ARCA|BATS|\bUS\b/.test(ex)) cc = "US";
    else if (/XETRA|FRANKFURT|GER|DAX/.test(ex)) cc = "DE";
    else if (/LONDON|LSE/.test(ex)) cc = "GB";
    else if (/PARIS|EURONEXT/.test(ex)) cc = "FR";
    else if (/SWISS|\bSIX\b/.test(ex)) cc = "CH";
    else if (/TOKYO|JPX|JAPAN/.test(ex)) cc = "JP";
    else if (/TORONTO|TSX/.test(ex)) cc = "CA";
    else if (/HONG KONG|HKEX/.test(ex)) cc = "HK";
  }
  return (cc && REGION_META[cc]) || { region: "Other markets", flag: "🌐" };
}

async function getQuotes(symbols: string[]) {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) return { quotes: [], errors: [] };
  const cnbcSyms = clean.map(toCnbc);
  const url = `${CNBC_QUOTE}?symbols=${encodeURIComponent(cnbcSyms.join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;

  const res = await fetch(url, {
    headers: { "User-Agent": CNBC_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`cnbc ${res.status}`);
  const json: any = await res.json();
  const arr: any[] = json?.FormattedQuoteResult?.FormattedQuote || [];
  const byCnbc = new Map<string, any>(arr.map((q) => [String(q.symbol).toUpperCase(), q]));

  const quotes: any[] = [];
  const errors: string[] = [];
  clean.forEach((orig, i) => {
    const q = byCnbc.get(cnbcSyms[i].toUpperCase());
    if (!q || q.code !== 0) {
      errors.push(`${orig}: no data`);
      return;
    }
    const price = num(q.last);
    let change = num(q.change);
    let changePercent = num(q.change_pct);
    if (q.changetype === "DOWN") {
      if (change != null) change = -Math.abs(change);
      if (changePercent != null) changePercent = -Math.abs(changePercent);
    }
    // CNBC's previous_day_closing can equal the day's close after hours, so
    // derive the true previous close from price − change instead.
    const previousClose = price != null && change != null ? price - change : num(q.previous_day_closing);
    const { region, flag } = regionOf(cnbcSyms[i], q.exchange || "");
    quotes.push({
      symbol: orig,
      name: q.name || q.shortName || orig,
      currency: q.currencyCode || "USD",
      price,
      previousClose,
      change,
      changePercent,
      marketState: q.realTime === "true" ? "REALTIME" : q.curmktstatus || "",
      exchange: q.exchange || "",
      region,
      flag,
    });
  });
  return { quotes, errors };
}

const CNBC_RANGES: Record<string, string> = {
  "1D": "1D", "5D": "5D", "1M": "1M", "6M": "6M", "1Y": "1Y", "5Y": "5Y",
};

async function getHistory(symbol: string, uiRange: string) {
  const range = CNBC_RANGES[uiRange] || "1M";
  const cs = toCnbc(symbol);
  const url = `${CNBC_CHART}/${range}.json?symbol=${encodeURIComponent(cs)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": CNBC_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`cnbc chart ${res.status}`);
  const json: any = await res.json();
  const bars: any[] = json?.barData?.priceBars || [];

  const timestamps: number[] = [];
  const closes: number[] = [];
  for (const b of bars) {
    const c = num(b.close);
    const ms = Number(b.tradeTimeinMills);
    if (c == null || !isFinite(ms)) continue;
    timestamps.push(Math.floor(ms / 1000));
    closes.push(c);
  }
  const currency = json?.barData?.currencyCode || "USD";
  return { symbol: symbol.toUpperCase(), range: uiRange, currency, timestamps, closes };
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
