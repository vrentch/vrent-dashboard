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
import * as webpush from "web-push";

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
  // Decode entities FIRST, so entity-encoded markup (e.g. &lt;a href&gt;) turns
  // into real tags and gets stripped — otherwise it surfaces as literal text.
  const decoded = decodeEntities(html);
  return decodeEntities(decoded.replace(/<[^>]*>/g, " "))
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

async function fetchFeed(url: string, fallbackSource: string, limit = 40, tries = 2): Promise<FeedItem[]> {
  // Google News RSS intermittently throttles data-center IPs (503 / hang), so
  // retry transient failures before giving up (the caller then falls back to a
  // different provider).
  let xml = "";
  let lastErr: unknown = new Error("feed failed");
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": RSS_UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        xml = await res.text();
        lastErr = null;
        break;
      }
      lastErr = new Error(`feed ${res.status}`);
      if (res.status < 500 && res.status !== 429) throw lastErr; // 4xx won't fix on retry
    } catch (e) {
      lastErr = e; // network error / timeout — retry
    }
  }
  if (lastErr) throw lastErr;
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

// Fallback feeds for when Google News throttles our data-center IP. BBC's RSS
// is keyless, standards-clean, and reliably reachable from data centres; it
// covers every major topic, so we map each section to the closest BBC feed
// (World is the default). Not localized per country, but it keeps real news
// flowing instead of showing an empty screen during a Google outage window.
const BBC = "https://feeds.bbci.co.uk";
const FALLBACK_FEEDS: Record<string, string[]> = {
  TOP: [`${BBC}/news/world/rss.xml`],
  WORLD: [`${BBC}/news/world/rss.xml`],
  NATION: [`${BBC}/news/rss.xml`],
  BUSINESS: [`${BBC}/news/business/rss.xml`],
  TECHNOLOGY: [`${BBC}/news/technology/rss.xml`],
  SCIENCE: [`${BBC}/news/science_and_environment/rss.xml`],
  HEALTH: [`${BBC}/news/health/rss.xml`],
  ENTERTAINMENT: [`${BBC}/news/entertainment_and_arts/rss.xml`],
  SPORTS: [`${BBC}/sport/rss.xml`],
};

function fallbackFeeds(spec: FeedSpec): string[] {
  const key = (spec.section || "").toUpperCase();
  return FALLBACK_FEEDS[key] || (spec.topic === "top" ? FALLBACK_FEEDS.TOP : FALLBACK_FEEDS.WORLD);
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
  const tagged: NewsItem[] = [];
  const errors: string[] = [];

  await Promise.all(
    list.map(async (s) => {
      const tag = (items: FeedItem[]) => {
        for (const it of items) tagged.push({ ...it, countryCode: s.country, topicKey: s.topic });
      };
      try {
        tag(await fetchFeed(gnUrl(s, query), `${s.country} · ${s.topic}`));
      } catch {
        // Google News unreachable for this datacenter IP right now — fall back
        // to BBC feeds so news still shows.
        const before = tagged.length;
        for (const url of fallbackFeeds(s)) {
          try {
            const items = await fetchFeed(url, `${s.country} · ${s.topic}`);
            if (items.length) { tag(items); break; }
          } catch {
            /* try next fallback */
          }
        }
        if (tagged.length === before) errors.push(`${s.country}/${s.topic}: news source unavailable`);
      }
    })
  );

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
  "^HSI": ".HSI", "^SSMI": ".SSMI", "^STOXX50E": ".STOXX50E",
  "BTC-USD": "BTC.CM=", "ETH-USD": "ETH.CM=", "SOL-USD": "SOL.CM=", "XRP-USD": "XRP.CM=",
  "DOGE-USD": "DOGE.CM=", "ADA-USD": "ADA.CM=", "AVAX-USD": "AVAX.CM=",
  "LINK-USD": "LINK.CM=", "DOT-USD": "DOT.CM=", "LTC-USD": "LTC.CM=",
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
  if (/^@(GC|SI|PL|PA|HG)\./.test(c)) return { region: "Metals", flag: "🥇" };
  if (c.startsWith("@")) return { region: "Raw materials", flag: "🛢️" };
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

// ── Smart Signal (educational technical analysis — NOT financial advice) ─────
//
// A transparent, rule-based rating computed from price history: trend vs 20/50
// day moving averages, a moving-average cross, momentum, and RSI. It is
// deterministic and explainable — deliberately not a black box or a promise.

function sma(a: number[], n: number): number | null {
  if (a.length < n) return null;
  let s = 0;
  for (let i = a.length - n; i < a.length; i++) s += a[i];
  return s / n;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgG = gains / period, avgL = losses / period;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

interface Reason { text: string; tone: "pos" | "neg" | "neutral" }

function computeSignal(closes: number[]) {
  if (closes.length < 20) return null;
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50) ?? sma(closes, Math.min(50, closes.length));
  const r = rsi(closes, 14);
  const momN = Math.min(20, closes.length - 1);
  const base = closes[closes.length - 1 - momN];
  const mom = base ? ((last - base) / base) * 100 : 0;

  let score = 0;
  const reasons: Reason[] = [];

  if (s20 != null) {
    if (last > s20) { score += 25; reasons.push({ text: "Trading above its 20-day average", tone: "pos" }); }
    else { score -= 25; reasons.push({ text: "Trading below its 20-day average", tone: "neg" }); }
  }
  if (s50 != null) {
    if (last > s50) { score += 25; reasons.push({ text: "Trading above its 50-day average", tone: "pos" }); }
    else { score -= 25; reasons.push({ text: "Trading below its 50-day average", tone: "neg" }); }
  }
  if (s20 != null && s50 != null) {
    if (s20 > s50) { score += 15; reasons.push({ text: "Short-term trend above long-term", tone: "pos" }); }
    else { score -= 15; reasons.push({ text: "Short-term trend below long-term", tone: "neg" }); }
  }
  if (mom > 3) { score += 20; reasons.push({ text: `Positive momentum (+${mom.toFixed(1)}% over ~1 month)`, tone: "pos" }); }
  else if (mom < -3) { score -= 20; reasons.push({ text: `Negative momentum (${mom.toFixed(1)}% over ~1 month)`, tone: "neg" }); }
  else reasons.push({ text: "Momentum is roughly flat", tone: "neutral" });
  if (r != null) {
    if (r > 70) { score -= 15; reasons.push({ text: `Overbought — RSI ${r.toFixed(0)}`, tone: "neg" }); }
    else if (r < 30) { score += 15; reasons.push({ text: `Oversold — RSI ${r.toFixed(0)}`, tone: "pos" }); }
    else reasons.push({ text: `RSI neutral (${r.toFixed(0)})`, tone: "neutral" });
  }

  score = Math.max(-100, Math.min(100, score));
  const label = score >= 45 ? "Strong Buy" : score >= 15 ? "Buy" : score > -15 ? "Hold" : score > -45 ? "Sell" : "Strong Sell";
  const tone: "pos" | "neg" | "neutral" = score >= 15 ? "pos" : score <= -15 ? "neg" : "neutral";
  return { score, label, tone, rsi: r, sma20: s20, sma50: s50, momentumPct: mom, reasons };
}

// Bounded-concurrency map so a big watchlist doesn't fire 40 fetches at once.
async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<(R | null)[]> {
  const res: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        res[i] = await fn(items[i], i);
      } catch {
        res[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return res;
}

async function getSignals(symbols: string[]) {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 45);
  const out = await mapPool(clean, 8, async (sym) => {
    const h = await getHistory(sym, "6M");
    const sig = computeSignal(h.closes);
    return sig ? { symbol: sym, ...sig } : null;
  });
  return { signals: out.filter(Boolean) };
}

// ── Sports (ESPN public site API — keyless, reachable from data centres) ─────
//
// Football (soccer), tennis and basketball scores/fixtures and league tables
// come from ESPN's public `site.api.espn.com` JSON, the same feed their apps
// use. No key, and — unlike Yahoo Finance — it answers cloud IPs. The client
// owns the league catalogue and sends `sport` + `league` slugs.

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_CORE = "https://site.api.espn.com/apis/v2/sports";
const ESPN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function espn(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": ESPN_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`espn ${res.status}`);
  return res.json();
}

type Side = { name: string; abbrev: string; logo: string | null; score: string; winner: boolean };

function competitorSide(c: any): Side {
  const t = c?.team || c?.athlete || {};
  const logo = t.logo || (Array.isArray(t.logos) && t.logos[0]?.href) || t.flag?.href || null;
  let score = c?.score != null ? String(c.score) : "";
  // Tennis carries per-set values in `linescores` rather than a single score.
  if (!score && Array.isArray(c?.linescores) && c.linescores.length) {
    score = c.linescores
      .map((ls: any) => (ls?.value != null ? String(Math.trunc(ls.value)) : ls?.displayValue ?? ""))
      .filter(Boolean)
      .join(" ");
  }
  return {
    name: t.displayName || t.shortDisplayName || t.name || "—",
    abbrev: t.abbreviation || t.shortDisplayName || "",
    logo,
    score,
    winner: !!c?.winner,
  };
}

function normalizeGame(e: any, comp: any) {
  const status = comp?.status || e?.status || {};
  const type = status.type || {};
  const comps: any[] = comp?.competitors || [];
  const home = comps.find((c) => c.homeAway === "home") || comps[0];
  const away = comps.find((c) => c.homeAway === "away") || comps[1];
  return {
    id: String(comp?.id || e?.id || ""),
    date: comp?.date || e?.date || null,
    state: (type.state || "pre") as "pre" | "in" | "post",
    detail: type.shortDetail || type.detail || type.description || "",
    clock: status.displayClock && status.displayClock !== "0'" ? status.displayClock : "",
    home: home ? competitorSide(home) : null,
    away: away ? competitorSide(away) : null,
    note: comp?.notes?.[0]?.headline || "",
  };
}

async function getSportsScores(sport: string, league: string) {
  const data = await espn(`${ESPN_SITE}/${sport}/${league}/scoreboard`);
  const leagueMeta = data?.leagues?.[0] || {};
  const events: any[] = data?.events || [];

  // Tennis events are tournaments that contain many matches (in `groupings`);
  // everything else is one game per event.
  const games: any[] = [];
  if (sport === "tennis") {
    for (const e of events) {
      const tournament = e.name || e.shortName || "";
      const groupings: any[] = e.groupings || [];
      for (const g of groupings) {
        const roundName = g?.grouping?.displayName || g?.grouping?.shortName || "";
        for (const comp of g.competitions || []) {
          const game = normalizeGame(e, comp);
          games.push({ ...game, tournament, round: roundName });
        }
      }
    }
    // Prefer live, then finished, then upcoming; keep it digestible.
    const order = { in: 0, post: 1, pre: 2 } as Record<string, number>;
    games.sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3));
    return { league: leagueMeta.name || league, season: leagueMeta.season?.displayName || "", games: games.slice(0, 60) };
  }

  for (const e of events) {
    const comp = e.competitions?.[0];
    if (comp) games.push(normalizeGame(e, comp));
  }
  return { league: leagueMeta.name || league, season: leagueMeta.season?.displayName || "", games };
}

function statVal(stats: any[], ...names: string[]): string {
  for (const n of names) {
    const s = (stats || []).find((x) => x.name === n || x.type === n || x.abbreviation === n);
    if (s) return s.displayValue ?? String(s.value ?? "");
  }
  return "";
}

function normalizeTable(node: any): { name: string; entries: any[] } {
  const entries: any[] = (node?.standings?.entries || node?.entries || []).map((en: any) => {
    const t = en.team || {};
    const stats = en.stats || [];
    return {
      rank: statVal(stats, "rank") || "",
      name: t.displayName || t.shortDisplayName || t.name || "—",
      abbrev: t.abbreviation || "",
      logo: t.logos?.[0]?.href || t.logo || null,
      played: statVal(stats, "gamesPlayed"),
      win: statVal(stats, "wins"),
      draw: statVal(stats, "ties"),
      loss: statVal(stats, "losses"),
      gd: statVal(stats, "pointDifferential"),
      pts: statVal(stats, "points"),
      pct: statVal(stats, "winPercent", "leagueWinPercent"),
      form: statVal(stats, "total", "overall"),
    };
  });
  return { name: node?.name || node?.displayName || "", entries };
}

async function getSportsStandings(sport: string, league: string) {
  const data = await espn(`${ESPN_CORE}/${sport}/${league}/standings`);
  const groups: { name: string; entries: any[] }[] = [];

  // Layouts vary: a single table, conference/division `children`, or a
  // `standings` array. Flatten whichever we get into named groups.
  const children: any[] = data?.children || [];
  if (children.length) {
    for (const ch of children) {
      const g = normalizeTable(ch);
      if (g.entries.length) groups.push({ ...g, name: g.name || ch.name || "" });
    }
  } else if (Array.isArray(data?.standings)) {
    for (const s of data.standings) {
      const g = normalizeTable(s);
      if (g.entries.length) groups.push({ ...g, name: s.name || s.displayName || "" });
    }
  } else {
    const g = normalizeTable(data);
    if (g.entries.length) groups.push(g);
  }

  const hasDraws = sport === "soccer";
  return { league: data?.name || league, hasDraws, groups };
}

// ── AI (Anthropic vision + planning) ────────────────────────────────────────
//
// Powers the camera Scanner (identify / explain / translate) and the Health
// food-photo calorie estimator + AI plans. The API key lives ONLY in the
// server env (ANTHROPIC_API_KEY) — never shipped to the client. Model is
// configurable via AI_MODEL (defaults to the fast, low-cost Haiku). If the key
// is missing the endpoints report "not configured" and the UI degrades kindly.
// Called with plain fetch to keep this file self-contained (no bundled SDK),
// matching every other data source here.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
// Optional shared access code that gates the paid AI features. When set, every
// AI request must include the matching code or it is rejected BEFORE any
// Anthropic call is made — so a stranger with the URL can never spend credit.
const AI_CODE = process.env.AI_ACCESS_CODE;

function aiConfigured(): boolean {
  return !!AI_KEY;
}
function aiLocked(): boolean {
  return !!AI_CODE;
}
function codeMatches(code: unknown): boolean {
  return !AI_CODE || (typeof code === "string" && code === AI_CODE);
}
// Returned (no Anthropic call) when the code is missing/wrong — zero cost.
const NEED_CODE = { status: 200, body: { ok: false, needCode: true, error: "Enter the access code to use AI features." } };

async function anthropic(body: any): Promise<any> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": AI_KEY as string,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

function aiText(json: any): string {
  return (json?.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}

// Pull the first JSON object/array out of a model response (tolerates prose or
// ```json fences around it).
function parseModelJson(s: string): any {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const first = t.search(/[[{]/);
  if (first >= 0) {
    for (let end = t.length; end > first; end--) {
      const slice = t.slice(first, end);
      const last = slice[slice.length - 1];
      if (last !== "}" && last !== "]") continue;
      try {
        return JSON.parse(slice);
      } catch {
        /* keep shrinking */
      }
    }
  }
  return null;
}

const IDENTIFY_PROMPT = `You are a visual identification assistant. Look at the image and identify the main subject. Respond with ONLY a JSON object, no prose, matching exactly:
{
  "title": "short name of the main subject",
  "category": "one of: Object, Product, Plant, Animal, Food, Landmark, Artwork, Text, Person, Vehicle, Nature, Other",
  "summary": "2-3 sentence plain-language explanation of what this is",
  "details": [{"label": "short label", "value": "short fact"}],
  "detectedText": "any readable text visible in the image, verbatim, or empty string",
  "searchQuery": "a concise web search query to learn more"
}
Provide up to 5 useful details. Be accurate; if unsure, say so in the summary.`;

const FOOD_PROMPT = `You are a nutrition estimator. Look at the food photo and estimate its nutrition. Respond with ONLY a JSON object, no prose, matching exactly:
{
  "items": [{"name": "food item", "portion": "estimated portion", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}],
  "total": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
  "confidence": "low | medium | high",
  "note": "one short caveat or tip"
}
Estimate realistic values for a normal serving as shown. Round to whole numbers. If the image is not food, return empty items, zeroed total, and explain in note.`;

async function aiVision(task: string, image: string, mediaType: string, code?: unknown) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false, error: "AI not configured" } };
  if (!codeMatches(code)) return NEED_CODE;
  const prompt = task === "food" ? FOOD_PROMPT : IDENTIFY_PROMPT;
  const json = await anthropic({
    model: AI_MODEL,
    max_tokens: 900,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  const data = parseModelJson(aiText(json));
  if (!data) return { status: 200, body: { ok: false, error: "Could not read the AI response" } };
  return { status: 200, body: { ok: true, data, model: AI_MODEL } };
}

async function aiTextTask(body: any) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false, error: "AI not configured" } };
  if (!codeMatches(body?.code)) return NEED_CODE;
  const task = body?.task;
  let prompt = "";
  let maxTokens = 700;

  if (task === "translate") {
    const text = String(body?.text || "").slice(0, 4000);
    const target = String(body?.target || "English");
    if (!text.trim()) return { status: 200, body: { ok: false, error: "Nothing to translate" } };
    prompt = `Translate the following text into ${target}. Respond with ONLY a JSON object: {"translation": "...", "sourceLang": "detected source language name"}.\n\nText:\n"""${text}"""`;
  } else if (task === "explain") {
    const topic = String(body?.topic || "").slice(0, 500);
    prompt = `Explain "${topic}" for a curious general reader. Respond with ONLY a JSON object: {"explanation": "3-5 short paragraphs, plain language", "keyPoints": ["...", "..."]}.`;
    maxTokens = 900;
  } else if (task === "plan") {
    const profile = JSON.stringify(body?.profile || {});
    const recent = JSON.stringify(body?.recent || {});
    maxTokens = 1100;
    prompt = `You are a friendly, evidence-based health & fitness coach. Given the user's profile and recent logged data, produce a concise personal plan. Profile: ${profile}. Recent data: ${recent}.
Respond with ONLY a JSON object matching exactly:
{
  "headline": "short motivating one-liner",
  "summary": "2-3 sentences on where they stand and the focus",
  "targets": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "steps": 0},
  "today": "what to do today, 1-2 sentences",
  "workouts": [{"day": "Mon", "focus": "e.g. Upper body", "detail": "short description"}],
  "nutrition": ["short actionable tip", "..."]
}
Base calorie/macro targets on the profile (goal, activity). Provide a 7-day workout array. Keep everything practical and safe; this is general guidance, not medical advice.`;
  } else {
    return { status: 400, body: { ok: false, error: "unknown task" } };
  }

  const json = await anthropic({
    model: AI_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });
  const data = parseModelJson(aiText(json));
  if (!data) return { status: 200, body: { ok: false, error: "Could not read the AI response" } };
  return { status: 200, body: { ok: true, data, model: AI_MODEL } };
}

// ── Push notifications (privacy-preserving: market open/close + daily recap) ─
//
// Storage is Vercel KV (Upstash Redis REST). VAPID keys come from env. If any
// of that is missing, the feature reports "not configured" and nothing breaks.

const VAPID_PUBLIC = "BNxnJi4BuHQzkMrh9pFVr3sJq70P15NklzGvjIJCO3EdA-Kxx3Siwr9aHTzZ3iPBQ8eJOdI4cmyxdT6FkYzuOPU";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

function pushConfigured(): boolean {
  return !!(KV_URL && KV_TOKEN && VAPID_PRIVATE);
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady || !VAPID_PRIVATE) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:info@vrent.ch", VAPID_PUBLIC, VAPID_PRIVATE);
  vapidReady = true;
}

// Minimal Upstash Redis REST client.
async function kv(command: (string | number)[]): Promise<any> {
  const res = await fetch(KV_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  return j.result;
}

function subId(endpoint: string): string {
  // Stable short id from the endpoint (no crypto needed for uniqueness here).
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) >>> 0;
  return h.toString(36) + endpoint.length.toString(36);
}

interface SubRecord {
  subscription: any;
  settings: { marketOpen: boolean; marketClose: boolean; dailyRecap: boolean; recapTime: string };
  tz: string;
}

async function subscribeHandler(body: any) {
  if (!pushConfigured()) return { status: 200, body: { ok: false, configured: false, error: "not configured" } };
  const { subscription, settings, tz } = body || {};
  if (!subscription?.endpoint) return { status: 400, body: { ok: false, error: "subscription required" } };
  const id = subId(subscription.endpoint);
  const rec: SubRecord = { subscription, settings, tz: tz || "UTC" };
  await kv(["SET", `sub:${id}`, JSON.stringify(rec)]);
  await kv(["SADD", "subs", id]);
  return { status: 200, body: { ok: true, configured: true } };
}

async function unsubscribeHandler(body: any) {
  if (!pushConfigured()) return { status: 200, body: { ok: false } };
  const endpoint = body?.endpoint;
  if (!endpoint) return { status: 400, body: { ok: false } };
  const id = subId(endpoint);
  await kv(["DEL", `sub:${id}`]);
  await kv(["SREM", "subs", id]);
  return { status: 200, body: { ok: true } };
}

async function sendTo(rec: SubRecord, payload: { title: string; body: string; url?: string; tag?: string }, id: string) {
  ensureVapid();
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify(payload));
    return true;
  } catch (err: any) {
    // Subscription expired/invalid — clean it up.
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await kv(["DEL", `sub:${id}`]);
      await kv(["SREM", "subs", id]);
    }
    return false;
  }
}

async function testHandler(body: any) {
  if (!pushConfigured()) return { status: 200, body: { ok: false, error: "not configured" } };
  const sub = body?.subscription;
  if (!sub?.endpoint) return { status: 400, body: { ok: false } };
  const ok = await sendTo(
    { subscription: sub, settings: { marketOpen: true, marketClose: true, dailyRecap: true, recapTime: "" }, tz: "UTC" },
    { title: "AC News", body: "🔔 Notifications are working — you're all set!", url: "/" },
    subId(sub.endpoint)
  );
  return { status: 200, body: { ok } };
}

// Exchange hours for open/close pushes.
const PUSH_MARKETS = [
  { key: "us", name: "US markets", tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60 },
  { key: "ch", name: "Swiss market (SIX)", tz: "Europe/Zurich", open: 9 * 60, close: 17 * 60 + 30 },
  { key: "eu", name: "European markets", tz: "Europe/Berlin", open: 9 * 60, close: 17 * 60 + 30 },
  { key: "uk", name: "UK market (LSE)", tz: "Europe/London", open: 8 * 60, close: 16 * 60 + 30 },
];
const WINDOW = 12; // minutes — matches an every-~5-min scheduler with jitter

function tzParts(tz: string, now: Date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const day = `${get("year")}${get("month")}${get("day")}`;
  return { minutes: hour * 60 + minute, weekday: wd, day };
}

async function once(id: string, day: string, kind: string): Promise<boolean> {
  // Returns true if this is the first time today (and marks it sent).
  const key = `sent:${id}:${day}:${kind}`;
  const set = await kv(["SET", key, "1", "NX", "EX", 90000]);
  return set === "OK";
}

async function recapText(): Promise<string> {
  try {
    const { quotes } = await getQuotes(["^GSPC", "^IXIC", "^DJI"]);
    const bits = quotes
      .filter((q) => q.changePercent != null)
      .map((q) => `${q.symbol.replace("^GSPC", "S&P").replace("^IXIC", "Nasdaq").replace("^DJI", "Dow")} ${q.changePercent! >= 0 ? "+" : ""}${q.changePercent!.toFixed(1)}%`);
    return bits.length ? `Today: ${bits.join(", ")}. Open AC News for your watchlist.` : "Open AC News for today's market recap.";
  } catch {
    return "Open AC News for today's market recap.";
  }
}

async function tickHandler() {
  if (!pushConfigured()) return { status: 200, body: { ok: false, configured: false } };
  const now = new Date();
  const ids: string[] = (await kv(["SMEMBERS", "subs"])) || [];
  let sent = 0;

  // Precompute market events that are firing right now.
  const firing: { kind: string; name: string; type: "open" | "close" }[] = [];
  for (const m of PUSH_MARKETS) {
    const t = tzParts(m.tz, now);
    if (t.weekday < 1 || t.weekday > 5) continue;
    if (t.minutes >= m.open && t.minutes < m.open + WINDOW) firing.push({ kind: `${m.key}-open-${t.day}`, name: m.name, type: "open" });
    if (t.minutes >= m.close && t.minutes < m.close + WINDOW) firing.push({ kind: `${m.key}-close-${t.day}`, name: m.name, type: "close" });
  }

  let recap: string | null = null;

  for (const id of ids) {
    const raw = await kv(["GET", `sub:${id}`]);
    if (!raw) {
      await kv(["SREM", "subs", id]);
      continue;
    }
    let rec: SubRecord;
    try {
      rec = JSON.parse(raw);
    } catch {
      continue;
    }
    const s = rec.settings || ({} as SubRecord["settings"]);

    for (const f of firing) {
      if (f.type === "open" && !s.marketOpen) continue;
      if (f.type === "close" && !s.marketClose) continue;
      if (await once(id, "", f.kind)) {
        const ok = await sendTo(rec, { title: "AC News", body: f.type === "open" ? `🟢 ${f.name} are open` : `🔴 ${f.name} have closed`, url: "/markets" }, id);
        if (ok) sent++;
      }
    }

    if (s.dailyRecap && s.recapTime) {
      const t = tzParts(rec.tz || "UTC", now);
      const [rh, rm] = s.recapTime.split(":").map(Number);
      const target = (rh || 0) * 60 + (rm || 0);
      if (t.minutes >= target && t.minutes < target + WINDOW) {
        if (await once(id, t.day, "recap")) {
          if (recap == null) recap = await recapText();
          const ok = await sendTo(rec, { title: "📊 Market recap", body: recap, url: "/" }, id);
          if (ok) sent++;
        }
      }
    }
  }

  return { status: 200, body: { ok: true, subs: ids.length, sent } };
}

// ── Router (shared by dev middleware and the serverless handler) ─────────────

export async function handleApi(
  pathname: string,
  search: URLSearchParams,
  ctx: { method?: string; body?: any } = {}
): Promise<{ status: number; body: unknown }> {
  try {
    const route = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

    if (route === "push-status") return { status: 200, body: { configured: pushConfigured() } };
    if (route === "push-subscribe") return await subscribeHandler(ctx.body);
    if (route === "push-unsubscribe") return await unsubscribeHandler(ctx.body);
    if (route === "push-test") return await testHandler(ctx.body);
    if (route === "tick") return await tickHandler();

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

    if (route === "signals") {
      const symbols = (search.get("symbols") || "").split(",").filter(Boolean);
      if (!symbols.length) return { status: 400, body: { error: "symbols required" } };
      return { status: 200, body: await getSignals(symbols) };
    }

    if (route === "sports-scores") {
      const sport = search.get("sport") || "";
      const league = search.get("league") || "";
      if (!sport || !league) return { status: 400, body: { error: "sport and league required" } };
      return { status: 200, body: await getSportsScores(sport, league) };
    }

    if (route === "sports-standings") {
      const sport = search.get("sport") || "";
      const league = search.get("league") || "";
      if (!sport || !league) return { status: 400, body: { error: "sport and league required" } };
      return { status: 200, body: await getSportsStandings(sport, league) };
    }

    if (route === "ai-status") {
      return { status: 200, body: { configured: aiConfigured(), model: aiConfigured() ? AI_MODEL : null, locked: aiLocked() } };
    }

    if (route === "ai-unlock") {
      // Verify an access code without spending any credit.
      if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false } };
      return { status: 200, body: { ok: codeMatches(ctx.body?.code) } };
    }

    if (route === "ai-vision") {
      const b = ctx.body || {};
      if (!b.image) return { status: 400, body: { ok: false, error: "image required" } };
      return await aiVision(b.task || "identify", String(b.image), b.mediaType || "image/jpeg", b.code);
    }

    if (route === "ai-text") {
      return await aiTextTask(ctx.body || {});
    }

    return { status: 404, body: { error: `unknown route: ${route}` } };
  } catch (err) {
    return { status: 502, body: { error: String(err instanceof Error ? err.message : err) } };
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    // Some runtimes pre-parse the body.
    if ((req as any).body !== undefined) {
      const b = (req as any).body;
      resolve(typeof b === "string" ? safeJson(b) : b);
      return;
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(safeJson(data)));
    req.on("error", () => resolve(undefined));
  });
}
function safeJson(s: string): any {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const body = req.method === "POST" ? await readBody(req) : undefined;
  const { status, body: out } = await handleApi(url.pathname, url.searchParams, { method: req.method, body });
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  // Push/tick endpoints must never be cached.
  const noCache = url.pathname.includes("/push-") || url.pathname.endsWith("/tick") || url.pathname.includes("/ai-");
  res.setHeader("Cache-Control", noCache ? "no-store" : "s-maxage=60, stale-while-revalidate=300");
  res.end(JSON.stringify(out));
}
