// Self-contained serverless API for AC App.
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

// Last-good results per feed, remembered in the warm serverless instance. When
// a live fetch fails, we serve this instead of an empty screen — keeping the
// user's own country/language, just a little older. 2-hour freshness window.
const specCache = new Map<string, { at: number; items: NewsItem[] }>();
const SPEC_TTL = 2 * 60 * 60 * 1000;

async function fetchSpec(s: FeedSpec, query?: string): Promise<NewsItem[]> {
  const key = JSON.stringify([s.country, s.topic, s.section || "", s.query || "", query || ""]);
  const tag = (items: FeedItem[]): NewsItem[] => items.map((it) => ({ ...it, countryCode: s.country, topicKey: s.topic }));

  // 1) Primary: Google News (localized, best quality) with retry.
  try {
    const items = tag(await fetchFeed(gnUrl(s, query), `${s.country} · ${s.topic}`));
    if (items.length) {
      specCache.set(key, { at: Date.now(), items });
      return items;
    }
  } catch {
    /* fall through */
  }

  // 2) Serve last-good cached content for this exact feed if still fresh —
  //    keeps the user's language/country during a brief Google outage.
  const cached = specCache.get(key);
  if (cached && Date.now() - cached.at < SPEC_TTL) return cached.items;

  // 3) Last resort (never loaded before AND Google is down): BBC feeds.
  for (const url of fallbackFeeds(s)) {
    try {
      const items = tag(await fetchFeed(url, `${s.country} · ${s.topic}`));
      if (items.length) {
        specCache.set(key, { at: Date.now(), items });
        return items;
      }
    } catch {
      /* try next fallback */
    }
  }
  return [];
}

async function getNews(specs: FeedSpec[], query?: string) {
  const list = specs.length ? specs : [];
  const tagged: NewsItem[] = [];
  const errors: string[] = [];

  const results = await Promise.all(list.map((s) => fetchSpec(s, query)));
  results.forEach((items, i) => {
    if (items.length) tagged.push(...items);
    else errors.push(`${list[i].country}/${list[i].topic}: news source unavailable`);
  });

  const merged = dedupe(tagged);
  merged.sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0));
  return { items: merged.slice(0, 150), errors, count: merged.length };
}

// ── Article image resolver ───────────────────────────────────────────────────
//
// Google News RSS carries no images, so headlines looked bare. This resolves an
// article link to its real `og:image` (the picture the publisher set for
// sharing), upscales Google's thumbnail, and 302-redirects the browser to it —
// so `<img src="/api/img?u=…" loading="lazy">` shows the true source photo and
// only fires for cards actually on screen. Results are cached hard.

const IMG_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const imgCache = new Map<string, { at: number; url: string | null }>();
const IMG_TTL = 6 * 60 * 60 * 1000;

function safeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    // Block obvious internal targets (basic SSRF guard).
    if (h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
    return u;
  } catch {
    return null;
  }
}

function upscaleImage(url: string): string {
  // Google-hosted thumbnails (lh3/lh4/…googleusercontent) take a size suffix.
  if (/googleusercontent\.com\//.test(url)) return url.replace(/=[-\w]+$/, "=w960");
  return url;
}

// Google News RSS article links point at an aggregator page whose only image is
// a generic Google card — useless. The real publisher URL is signed into the
// page and resolved through Google's private `batchexecute` RPC. Decode it so we
// can read the publisher's own og:image.
async function decodeGoogleNewsUrl(link: string): Promise<string | null> {
  const id = link.match(/\/articles\/([^?/]+)/)?.[1];
  if (!id) return null;
  try {
    const page = await fetch(link, {
      headers: { "User-Agent": IMG_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!page.ok) return null;
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id, Number(ts), sg,
    ]);
    const payload = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);
    const rpc = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
      method: "POST",
      headers: { "User-Agent": IMG_UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      signal: AbortSignal.timeout(9000),
      body: "f.req=" + encodeURIComponent(payload),
    });
    if (!rpc.ok) return null;
    const txt = await rpc.text();
    const m = txt.match(/https?:\/\/[^"\\\s]+/);
    return m && safeHttpUrl(m[0]) ? m[0] : null;
  } catch {
    return null;
  }
}

// Fetch a publisher page and pull its og:image / twitter:image. Streams only far
// enough to reach the tag (it lives in <head>) and caps the read.
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": IMG_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;
    const reader = (res.body as any).getReader();
    const dec = new TextDecoder();
    let html = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += dec.decode(value, { stream: true });
      if (/og:image|twitter:image/i.test(html) || bytes > 320000) {
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
    }
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["']/i);
    // Fallbacks for publishers that don't emit og:image: image_src link,
    // schema.org itemprop, or a JSON-LD image/thumbnail field.
    const alt =
      m ||
      html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/"image"\s*:\s*"([^"']+?\.(?:jpe?g|png|webp)[^"']*)"/i) ||
      html.match(/"image"\s*:\s*\{[^}]*?"url"\s*:\s*"([^"']+)"/i) ||
      html.match(/"thumbnailUrl"\s*:\s*"([^"']+)"/i);
    if (alt && alt[1]) {
      const raw = decodeEntities(alt[1].trim());
      const abs = raw.startsWith("//") ? "https:" + raw : raw.startsWith("/") ? new URL(raw, url).toString() : raw;
      if (safeHttpUrl(abs)) return upscaleImage(abs);
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function resolveArticleImage(link: string): Promise<string | null> {
  const cached = imgCache.get(link);
  if (cached && Date.now() - cached.at < IMG_TTL) return cached.url;

  let found: string | null = null;
  try {
    let target = link;
    const host = new URL(link).hostname.toLowerCase();
    if (host === "news.google.com" || host.endsWith(".news.google.com")) {
      const pub = await decodeGoogleNewsUrl(link);
      target = pub || "";
    }
    if (target) found = await fetchOgImage(target);
  } catch {
    /* leave found null */
  }
  imgCache.set(link, { at: Date.now(), url: found });
  return found;
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
  // Precious-metal spot (XAU=/XAG=/XPT=/XPD=) must be caught before the generic
  // 3-letter currency check below.
  if (/^X(AU|AG|PT|PD)=$/.test(c)) return { region: "Metals", flag: "🥇" };
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
// Football (soccer), tennis and Formula 1 (racing) scores/fixtures and league
// tables come from ESPN's public `site.api.espn.com` JSON, the same feed their
// apps use. No key, and — unlike Yahoo Finance — it answers cloud IPs. The
// client owns the league catalogue and sends `sport` + `league` slugs.

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
  // Formula 1's plain scoreboard returns only the next race; scoping by year
  // yields the whole ~24-race calendar (past results + upcoming). If the
  // year-scoped call fails, fall back to the plain scoreboard.
  let data: any;
  if (sport === "racing") {
    const base = `${ESPN_SITE}/${sport}/${league}/scoreboard`;
    try {
      data = await espn(`${base}?dates=${new Date().getFullYear()}`);
    } catch {
      data = await espn(base);
    }
  } else {
    data = await espn(`${ESPN_SITE}/${sport}/${league}/scoreboard`);
  }
  const leagueMeta = data?.leagues?.[0] || {};
  const events: any[] = data?.events || [];

  // Tennis events are tournaments that contain many matches (in `groupings`);
  // everything else is one game per event.
  const games: any[] = [];

  // Formula 1: each event is a Grand Prix weekend, not a two-sided game. Render
  // it as a race card — GP name, circuit, status, and the podium when finished.
  if (sport === "racing") {
    for (const e of events) {
      const type = e?.status?.type || {};
      // Race results live in whichever session competition carries drivers.
      let field: any[] = [];
      for (const c of e.competitions || []) {
        const cs = c?.competitors || [];
        if (cs.length > field.length) field = cs;
      }
      const podium = field
        .slice()
        .sort((a, b) => (Number(a?.order) || 99) - (Number(b?.order) || 99))
        .slice(0, 3)
        .map((c) => ({
          pos: Number(c?.order) || null,
          name: c?.athlete?.displayName || c?.athlete?.shortName || c?.athlete?.name || "",
          flag: c?.athlete?.flag?.href || null,
        }))
        .filter((p) => p.name);
      const circuit = e?.circuit?.fullName || e?.circuit?.address?.city || "";
      games.push({
        id: String(e?.id || ""),
        date: e?.date || null,
        state: (type.state || "pre") as "pre" | "in" | "post",
        detail: type.shortDetail || type.description || "",
        clock: "",
        home: null,
        away: null,
        tournament: e?.name || e?.shortName || "Grand Prix",
        round: circuit,
        note: podium[0] ? `🏆 ${podium[0].name}` : "",
        podium,
      });
    }
    // Live first, then upcoming (soonest first), then finished (most recent).
    const rank = { in: 0, pre: 1, post: 2 } as Record<string, number>;
    games.sort((a, b) => {
      const r = (rank[a.state] ?? 3) - (rank[b.state] ?? 3);
      if (r) return r;
      const ta = a.date ? Date.parse(a.date) : 0;
      const tb = b.date ? Date.parse(b.date) : 0;
      return a.state === "post" ? tb - ta : ta - tb;
    });
    return { league: leagueMeta.name || "Formula 1", season: leagueMeta.season?.displayName || String(new Date().getFullYear()), games };
  }
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
// Vision (food photos, scanner) and Studio both run on the strongest model by
// default — no env var needed. AI_STUDIO_MODEL falls through to this, so this
// one default powers both. Override with AI_VISION_MODEL / AI_STUDIO_MODEL to
// dial back cost; falls back to AI_MODEL automatically if it's unavailable.
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || "claude-opus-5";
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
// Length-independent, early-exit-free comparison so the access code can't be
// recovered via response-timing analysis.
function constantTimeEq(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function codeMatches(code: unknown): boolean {
  return !AI_CODE || (typeof code === "string" && constantTimeEq(code, AI_CODE));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── AI response normalization (never trust the model's JSON shape) ───────────
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const nnum = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
};
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function normalizeVision(task: string, d: any) {
  if (task === "receipt") {
    return {
      vendor: str(d?.vendor),
      date: str(d?.date).slice(0, 10),
      currency: (str(d?.currency) || "CHF").toUpperCase().slice(0, 5),
      total: nnum(d?.total),
      vatAmount: nnum(d?.vatAmount),
      vatRate: nnum(d?.vatRate),
      category: str(d?.category),
      description: str(d?.description),
      confidence: str(d?.confidence) || "medium",
    };
  }
  if (task === "food") {
    const t = d?.total && typeof d.total === "object" ? d.total : {};
    return {
      items: arr<any>(d?.items).map((it) => ({
        name: str(it?.name) || "Item",
        portion: str(it?.portion),
        quantity: nnum(it?.quantity),
        unit: str(it?.unit) || "g",
        calories: nnum(it?.calories),
        protein_g: nnum(it?.protein_g),
        carbs_g: nnum(it?.carbs_g),
        fat_g: nnum(it?.fat_g),
      })),
      total: { calories: nnum(t.calories), protein_g: nnum(t.protein_g), carbs_g: nnum(t.carbs_g), fat_g: nnum(t.fat_g) },
      confidence: str(d?.confidence) || "medium",
      note: str(d?.note),
    };
  }
  return {
    title: str(d?.title) || "Unknown",
    category: str(d?.category) || "Other",
    summary: str(d?.summary),
    details: arr<any>(d?.details).map((x) => ({ label: str(x?.label), value: str(x?.value) })).filter((x) => x.label || x.value),
    detectedText: str(d?.detectedText),
    searchQuery: str(d?.searchQuery) || str(d?.title),
  };
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

const FOOD_PROMPT = `You are an expert nutritionist estimating a meal's nutrition from a photo. Work carefully and systematically:
1. Identify EVERY distinct food and drink in the image — including sides, sauces, dressings, cooking oil, cheese, and garnishes that add real calories. Don't miss items partly hidden or in the background.
2. Estimate each item's portion using visual cues: plate/bowl size, cutlery, hands, packaging, or standard serving sizes. Judge cooking method (fried/roasted adds oil; grilled/steamed adds little).
3. Give realistic calorie and macro values for the portion actually shown — not generic averages. A large restaurant portion is not a "standard" serving.
Respond with ONLY a JSON object, no prose, matching exactly:
{
  "items": [{"name": "specific food name", "quantity": 0, "unit": "g | piece | slice | cup | tbsp | tsp | ml | serving | handful | bowl | plate | oz", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}],
  "total": {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0},
  "confidence": "low | medium | high",
  "note": "one short caveat or assumption you made"
}
For each item pick the MOST NATURAL unit a person would use: countable foods use "piece" (eggs, sausages, cookies) or "slice" (bread, pizza, cake); liquids use "ml"; loose/plated foods use "g", "cup" or "serving". "quantity" is how many of that unit is actually shown. The calories/macros must be for that whole quantity. Round to whole numbers. "total" MUST equal the sum of the items. If the image is not food, return empty items, a zeroed total, confidence "low", and explain in the note.`;

const RECEIPT_PROMPT = `You are a Swiss bookkeeping assistant reading a receipt or invoice image (it may be a photo of a paper receipt OR a screenshot of an email invoice). Extract the fields an accountant needs. Respond with ONLY a JSON object, no prose, matching exactly:
{
  "vendor": "supplier / merchant name",
  "date": "YYYY-MM-DD of the receipt or invoice (best guess from the document)",
  "currency": "ISO code, e.g. CHF, EUR, USD",
  "total": 0,
  "vatAmount": 0,
  "vatRate": 0,
  "category": "short expense category, e.g. Office supplies, Software, Travel, Meals, Fuel, Telecom, Hardware",
  "description": "one concise line describing the purchase for bookkeeping",
  "confidence": "low | medium | high"
}
"total" is the gross amount payable including VAT. "vatAmount" is the total VAT/MwSt shown (0 if none), "vatRate" the main rate as a number (e.g. 8.1, 2.6, 3.8, 0). Numbers must be plain numbers with no currency symbols or thousands separators. If a field isn't visible, use "" or 0.`;

async function aiVision(task: string, image: string, mediaType: string, code?: unknown, hints?: string[]) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false, error: "AI not configured" } };
  if (!codeMatches(code)) return NEED_CODE;
  // The user's frequent foods bias recognition toward what they actually eat.
  const foodPrompt =
    task === "food" && hints && hints.length
      ? `${FOOD_PROMPT}\n\nThe user frequently eats these foods — when an item in the photo closely matches one, prefer that exact name and its natural unit: ${hints.slice(0, 20).join(", ")}.`
      : FOOD_PROMPT;
  const prompt = task === "receipt" ? RECEIPT_PROMPT : task === "food" ? foodPrompt : IDENTIFY_PROMPT;
  const maxTokens = task === "food" ? 1400 : task === "receipt" ? 700 : 1000;
  const content = [
    { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
    { type: "text", text: prompt },
  ];

  // Prefer the stronger vision model; disable thinking so it can't eat the
  // token budget on this structured-extraction call. Fall back to the base
  // model if the vision model isn't available on this key/region.
  let json: any;
  let usedModel = AI_VISION_MODEL;
  try {
    json = await anthropic({ model: AI_VISION_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content }] });
  } catch {
    usedModel = AI_MODEL;
    json = await anthropic({ model: AI_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] });
  }

  const data = parseModelJson(aiText(json));
  if (!data) return { status: 200, body: { ok: false, error: "Could not read the AI response" } };
  return { status: 200, body: { ok: true, data: normalizeVision(task, data), model: usedModel } };
}

// Multi-turn chat about a photo: the Scanner's "ask a follow-up" feature. The
// image rides on the first user turn; later turns are plain text and the whole
// history is re-sent each request (the API is stateless).
async function aiChat(body: any) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false } };
  if (!codeMatches(body?.code)) return NEED_CODE;
  const turns = arr<any>(body?.messages)
    .map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", text: str(m?.text).slice(0, 4000) }))
    .filter((m) => m.text);
  if (!turns.length) return { status: 200, body: { ok: false, error: "No message" } };
  const image = typeof body?.image === "string" ? body.image : "";
  const mediaType = str(body?.mediaType) || "image/jpeg";

  const messages = turns.map((m, i) => {
    if (i === 0 && image && m.role === "user") {
      return { role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text: m.text }] };
    }
    return { role: m.role, content: m.text };
  });

  let json: any;
  try {
    json = await anthropic({
      model: AI_VISION_MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: "You are a sharp, helpful visual assistant. The user shared a photo and is asking about it or giving you a task (translate text, identify, find, explain, extract details). Answer concisely and usefully in plain language. If you can't tell from the image, say so.",
      messages,
    });
  } catch {
    json = await anthropic({ model: AI_MODEL, max_tokens: 1024, system: "You are a helpful visual assistant answering questions about a photo the user shared.", messages });
  }
  const reply = aiText(json);
  if (!reply) return { status: 200, body: { ok: false, error: "No reply" } };
  return { status: 200, body: { ok: true, reply } };
}

// Validate & coerce one assistant action; returns null for anything unknown.
function normalizeAction(a: any): any | null {
  const type = str(a?.type);
  switch (type) {
    case "navigate": {
      const tab = str(a?.tab);
      return ["home", "news", "sport", "markets", "health", "scan", "business", "calendar", "briefing", "money"].includes(tab)
        ? { type, tab }
        : null;
    }
    case "log_food":
      return { type, name: str(a?.name) || "Food", quantity: nnum(a?.quantity) || 1, unit: str(a?.unit) || "g", calories: nnum(a?.calories), protein_g: nnum(a?.protein_g), carbs_g: nnum(a?.carbs_g), fat_g: nnum(a?.fat_g) };
    case "log_water":
      return { type, ml: nnum(a?.ml) };
    case "log_steps":
      return { type, steps: nnum(a?.steps) };
    case "log_weight":
      return { type, kg: nnum(a?.kg) };
    case "log_activity":
      return { type, label: str(a?.label) || "Workout", minutes: nnum(a?.minutes), calories: nnum(a?.calories) };
    case "add_event":
      return { type, title: str(a?.title) || "Event", date: str(a?.date).slice(0, 10), time: str(a?.time).slice(0, 5), category: str(a?.category) || "other" };
    case "log_expense":
      return { type, amount: nnum(a?.amount), category: str(a?.category) || "other", note: str(a?.note) };
    default:
      return null;
  }
}

function normalizePlan(d: any) {
  const t = d?.targets && typeof d.targets === "object" ? d.targets : {};
  return {
    headline: str(d?.headline) || "Your plan",
    summary: str(d?.summary),
    targets: { calories: nnum(t.calories), protein_g: nnum(t.protein_g), carbs_g: nnum(t.carbs_g), fat_g: nnum(t.fat_g), steps: nnum(t.steps) },
    today: str(d?.today),
    workouts: arr<any>(d?.workouts).map((w) => ({ day: str(w?.day), focus: str(w?.focus), detail: str(w?.detail) })),
    nutrition: arr<any>(d?.nutrition).map(str).filter(Boolean),
  };
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
  } else if (task === "nutrition") {
    // Re-estimate nutrition for user-corrected items (fixed name and/or amount,
    // where amount is a quantity + unit like "2 piece", "1 cup", "200 g").
    const items = arr<any>(body?.items)
      .map((i) => ({ name: str(i?.name).slice(0, 80), quantity: nnum(i?.quantity) || 0, unit: str(i?.unit).slice(0, 16) || "g" }))
      .filter((i) => i.name)
      .slice(0, 20);
    if (!items.length) return { status: 200, body: { ok: false, error: "No items" } };
    maxTokens = 800;
    prompt = `Give accurate nutrition for each food at the EXACT amount specified as quantity + unit (e.g. "2 piece" = two whole items, "1 cup", "1 slice", "200 g", "330 ml"). Use the corrected food name (it may differ from what a photo suggested — e.g. beef vs chicken). Respond with ONLY a JSON object:
{"items":[{"name":"...","quantity":0,"unit":"...","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}]}
Keep each item's quantity and unit exactly as given. Round to whole numbers. Foods: ${JSON.stringify(items)}`;
  } else if (task === "food-lookup") {
    // Look up a manually-described food from brand/restaurant knowledge + the web.
    const desc = String(body?.desc || body?.text || "").slice(0, 300);
    if (!desc.trim()) return { status: 200, body: { ok: false, error: "Describe the food" } };
    maxTokens = 1000;
    prompt = `You are a nutrition database assistant. The user describes a food or meal — often a specific restaurant, cafe, brand, or packaged product (e.g. "McDonald's Big Mac", "Starbucks grande oat latte", "Coop Betty Bossi lasagne", "Migros chicken sandwich", "Gipfeli from a Swiss bakery"). Identify the exact product and give its nutrition using the brand/restaurant's known published values when you know them, or the web search tool to find them; otherwise give a careful estimate from a typical recipe. If the description is a combo/meal, split it into its components. Respond with ONLY a JSON object:
{"items":[{"name":"clear food name","quantity":0,"unit":"g | piece | slice | cup | ml | serving | …","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}],"source":"where the numbers came from, e.g. 'McDonald's official', 'brand label', 'typical recipe estimate'","note":"one short caveat"}
Use realistic values for the ACTUAL portion/product size (not per 100 g unless that is the unit). Pick the most natural unit per item. Round to whole numbers. Food: """${desc}"""`;
  } else if (task === "tax-lookup") {
    // Estimate the effective Swiss income-tax rate for a specific Gemeinde.
    const canton = str(body?.canton).slice(0, 30);
    const gemeinde = str(body?.gemeinde).slice(0, 60);
    const status = str(body?.status) === "married" ? "married" : "single";
    const incomeMonthly = nnum(body?.incomeMonthly);
    if (!gemeinde.trim() || !(incomeMonthly > 0)) return { status: 200, body: { ok: false, error: "Enter your Gemeinde and income first" } };
    maxTokens = 700;
    prompt = `You are a Swiss tax expert. Estimate the EFFECTIVE total income-tax rate (Bundessteuer + Kantonssteuer + Gemeindesteuer, incl. church tax excluded) as a percentage of gross annual income for this person. Use the web search tool if needed to find the Gemeinde's current Steuerfuss.
Person: ${status}, no children, resident of ${gemeinde}, canton ${canton}, annual gross income CHF ${Math.round(incomeMonthly * 12)}.
Respond with ONLY a JSON object:
{"taxPct": 0.0, "note": "one short line explaining the basis (e.g. Steuerfuss used)", "source": "where the figures came from"}
"taxPct" is the effective rate in percent (e.g. 9.8), realistic for that income level and municipality — low-tax Gemeinden like Küsnacht, Zug, Wollerau, Freienbach are well below the cantonal average.`;
  } else if (task === "assistant") {
    // In-app voice/text assistant: answers from context and emits actions the
    // client executes (navigate, log health, add events).
    const message = String(body?.message || body?.text || "").slice(0, 600);
    if (!message.trim()) return { status: 200, body: { ok: false, error: "Say or type something" } };
    const ctx = body?.context && typeof body.context === "object" ? body.context : {};
    const today = str(ctx?.date) || "";
    maxTokens = 900;
    prompt = `You are the built-in voice assistant for a personal mobile app called "AC App". The user speaks or types a request. You can ANSWER using the provided context, and you can perform ACTIONS the app will carry out. Respond with ONLY a JSON object:
{"reply":"a short, friendly, spoken-style response (1-2 sentences, no JSON, no markdown)","actions":[ ...zero or more action objects... ]}

Allowed actions (include ONLY when clearly intended):
- {"type":"navigate","tab":"home|news|sport|markets|health|scan|business|calendar|briefing|money"} — open a section (for "show/open/go to ...").
- {"type":"log_food","name":"","quantity":0,"unit":"g|piece|slice|cup|ml|serving|bowl|plate|tbsp|tsp|oz","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0} — log something the user ate/drank. Give accurate nutrition for that amount, using known brand/restaurant values when named.
- {"type":"log_water","ml":0}
- {"type":"log_steps","steps":0}
- {"type":"log_weight","kg":0}
- {"type":"log_activity","label":"","minutes":0,"calories":0} — a workout.
- {"type":"add_event","title":"","date":"YYYY-MM-DD","time":"HH:MM or empty for all-day","category":"work|meeting|deadline|finance|personal|other"}
- {"type":"log_expense","amount":0,"category":"food|groceries|transport|shopping|leisure|health|bills|other","note":""} — money the user spent (e.g. "I spent 25 on lunch"). Amount in CHF.

Rules:
- For questions about stats/data (calories left, spend this month, upcoming events, watchlist), ANSWER from context in "reply"; you may also navigate to that section.
- Resolve relative dates ("today", "tomorrow", "next Monday") using today's date. Today is ${today}.
- Keep "reply" natural and concise, as if spoken aloud. Confirm actions you took ("Logged 2 eggs — 180 calories.").
- Emit an empty actions array for a pure question. Never invent data not in context.
Context: ${JSON.stringify(ctx).slice(0, 3000)}
User said: """${message}"""`;
  } else {
    return { status: 400, body: { ok: false, error: "unknown task" } };
  }

  // food-lookup, tax-lookup + assistant run on the strong model (the lookups
  // also with web search), with graceful fallbacks; everything else uses the
  // fast text model.
  const strong = task === "food-lookup" || task === "tax-lookup" || task === "assistant";
  let usedModel = AI_MODEL;
  let json: any;
  if (strong) {
    usedModel = AI_VISION_MODEL;
    const msgs = [{ role: "user", content: [{ type: "text", text: prompt }] }];
    const tools = task === "food-lookup" || task === "tax-lookup" ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {};
    try {
      json = await anthropic({ model: AI_VISION_MODEL, max_tokens: maxTokens, messages: msgs, ...tools });
    } catch {
      try {
        json = await anthropic({ model: AI_VISION_MODEL, max_tokens: maxTokens, messages: msgs });
      } catch {
        usedModel = AI_MODEL;
        json = await anthropic({ model: AI_MODEL, max_tokens: maxTokens, messages: msgs });
      }
    }
  } else {
    json = await anthropic({
      model: AI_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
  }
  const data = parseModelJson(aiText(json));
  if (!data) return { status: 200, body: { ok: false, error: "Could not read the AI response" } };
  if (task === "assistant") {
    const actions = arr<any>(data?.actions).map(normalizeAction).filter(Boolean).slice(0, 8);
    return { status: 200, body: { ok: true, data: { reply: str(data?.reply), actions }, model: usedModel } };
  }
  if (task === "tax-lookup") {
    const pct = nnum(data?.taxPct);
    // Sanity-clamp: an effective Swiss income-tax rate outside 0–45% is noise.
    const taxPct = Math.max(0, Math.min(45, pct));
    return { status: 200, body: { ok: true, data: { taxPct, note: str(data?.note), source: str(data?.source) }, model: usedModel } };
  }
  if (task === "food-lookup") {
    const items = arr<any>(data?.items).map((i) => ({
      name: str(i?.name),
      quantity: nnum(i?.quantity) || 0,
      unit: str(i?.unit) || "g",
      calories: nnum(i?.calories) || 0,
      protein_g: nnum(i?.protein_g) || 0,
      carbs_g: nnum(i?.carbs_g) || 0,
      fat_g: nnum(i?.fat_g) || 0,
    })).filter((i) => i.name);
    return { status: 200, body: { ok: true, data: { items, source: str(data?.source), note: str(data?.note) }, model: usedModel } };
  }
  if (task === "nutrition") {
    const items = arr<any>(data?.items).map((i) => ({
      name: str(i?.name),
      quantity: nnum(i?.quantity) || 0,
      unit: str(i?.unit) || "g",
      calories: nnum(i?.calories) || 0,
      protein_g: nnum(i?.protein_g) || 0,
      carbs_g: nnum(i?.carbs_g) || 0,
      fat_g: nnum(i?.fat_g) || 0,
    }));
    return { status: 200, body: { ok: true, data: { items }, model: AI_MODEL } };
  }
  if (task === "plan") return { status: 200, body: { ok: true, data: normalizePlan(data), model: AI_MODEL } };
  if (task === "explain") {
    return { status: 200, body: { ok: true, data: { explanation: str(data?.explanation), keyPoints: arr<any>(data?.keyPoints).map(str).filter(Boolean) }, model: AI_MODEL } };
  }
  // translate
  return { status: 200, body: { ok: true, data: { translation: str(data?.translation), sourceLang: str(data?.sourceLang) }, model: AI_MODEL } };
}

// ── AI Studio (Instagram content generator) ─────────────────────────────────
//
// Powers the Studio tab: photos + a prompt (+ brand kit + brief answers) go in,
// a complete ready-to-publish Instagram package comes out — caption, hashtags,
// a layout spec the client renders onto the photos (post + story), and a
// scene-by-scene reel plan. Creative work runs on the strongest configured
// model (AI_STUDIO_MODEL, e.g. claude-opus-5) and falls back down the chain.

const AI_STUDIO_MODEL = process.env.AI_STUDIO_MODEL || AI_VISION_MODEL;

const STUDIO_TEMPLATES = ["clean", "bold", "frame"];
const STUDIO_POSITIONS = ["top", "center", "bottom"];
const STUDIO_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

function hexColor(v: unknown, fallback: string): string {
  const s = str(v).trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}
function oneOf(v: unknown, allowed: string[], fallback: string): string {
  const s = str(v).trim();
  return allowed.includes(s) ? s : fallback;
}

function normalizeLayout(d: any, photoCount: number) {
  const idx = Math.min(Math.max(0, Math.round(nnum(d?.photoIndex))), Math.max(0, photoCount - 1));
  return {
    template: oneOf(d?.template, STUDIO_TEMPLATES, "clean"),
    headline: str(d?.headline).slice(0, 60),
    subline: str(d?.subline).slice(0, 90),
    cta: str(d?.cta).slice(0, 30),
    textPosition: oneOf(d?.textPosition, STUDIO_POSITIONS, "bottom"),
    accentColor: hexColor(d?.accentColor, "#ffffff"),
    textColor: hexColor(d?.textColor, "#ffffff"),
    logoPosition: oneOf(d?.logoPosition, STUDIO_CORNERS, "top-left"),
    photoIndex: idx,
  };
}

function normalizeStudio(d: any, photoCount: number) {
  const post = d?.post && typeof d.post === "object" ? d.post : {};
  const story = d?.story && typeof d.story === "object" ? d.story : {};
  const reel = d?.reel && typeof d.reel === "object" ? d.reel : {};
  return {
    category: str(d?.category).slice(0, 40) || "General",
    concept: str(d?.concept).slice(0, 200),
    post: {
      caption: str(post?.caption).slice(0, 2200),
      hashtags: arr<any>(post?.hashtags).map(str).filter(Boolean).slice(0, 30),
      altText: str(post?.altText).slice(0, 200),
      layout: normalizeLayout(post?.layout, photoCount),
    },
    story: {
      layout: normalizeLayout(story?.layout, photoCount),
      sticker: str(story?.sticker).slice(0, 140),
    },
    reel: {
      hook: str(reel?.hook).slice(0, 90),
      caption: str(reel?.caption).slice(0, 2200),
      audio: str(reel?.audio).slice(0, 140),
      cover: normalizeLayout(reel?.cover, photoCount),
      scenes: arr<any>(reel?.scenes)
        .map((s) => ({
          text: str(s?.text).slice(0, 60),
          photoIndex: Math.min(Math.max(0, Math.round(nnum(s?.photoIndex))), Math.max(0, photoCount - 1)),
          seconds: Math.min(5, Math.max(1, nnum(s?.seconds) || 2.5)),
        }))
        .filter((s) => s.text || photoCount > 0)
        .slice(0, 8),
    },
    tips: arr<any>(d?.tips).map(str).filter(Boolean).slice(0, 4),
    alternatives: arr<any>(d?.alternatives).map(str).filter(Boolean).slice(0, 3),
  };
}

function studioPhotoBlocks(body: any): any[] {
  return arr<any>(body?.photos)
    .slice(0, 4)
    .map((p) => ({
      type: "image",
      source: { type: "base64", media_type: str(p?.mediaType) || "image/jpeg", data: str(p?.data) },
    }))
    .filter((b) => b.source.data);
}

function studioContext(body: any): string {
  const brand = body?.brand && typeof body.brand === "object" ? body.brand : {};
  const bits = [
    brand.name && `Business: ${str(brand.name).slice(0, 80)}`,
    brand.handle && `Instagram handle: ${str(brand.handle).slice(0, 60)}`,
    brand.tagline && `Tagline: ${str(brand.tagline).slice(0, 120)}`,
    brand.about && `About the business: ${str(brand.about).slice(0, 400)}`,
    brand.primary && `Brand colors: primary ${hexColor(brand.primary, "#18181b")}, secondary ${hexColor(brand.secondary, "#f4f4f5")}`,
    `Caption language: ${str(brand.language).slice(0, 30) || "match the user's request, default English"}`,
  ].filter(Boolean);
  const answers = arr<any>(body?.answers)
    .map((a) => `- ${str(a?.question).slice(0, 120)}: ${str(a?.answer).slice(0, 120)}`)
    .filter((a) => a.length > 4)
    .slice(0, 6);
  return [
    `BRAND KIT:\n${bits.join("\n")}`,
    `USER REQUEST: ${str(body?.prompt).slice(0, 1000) || "(none — infer the best angle from the photos)"}`,
    answers.length ? `CREATIVE BRIEF (the user answered these):\n${answers.join("\n")}` : "",
    str(body?.revision) ? `REVISION REQUEST (the user wants this changed vs. the previous attempt): ${str(body.revision).slice(0, 500)}` : "",
  ].filter(Boolean).join("\n\n");
}

const STUDIO_QUESTIONS_PROMPT = `You are an elite Instagram creative director doing a rapid client brief. Look at the photos and the context above, then ask the 3 multiple-choice questions whose answers would MOST improve the final content (think: goal of the post, tone/vibe, audience, offer/CTA, angle). Never ask something already answered by the context. Respond with ONLY a JSON object, no prose, matching exactly:
{
  "questions": [
    {"id": "q1", "question": "short clear question", "options": [{"key": "a", "label": "short option (max 6 words)"}]}
  ]
}
Exactly 3 questions, each with exactly 4 distinct options. Options must be concrete and opinionated, not vague.`;

function studioGeneratePrompt(photoCount: number, formats: string[]): string {
  return `You are an elite Instagram creative director and copywriter for small businesses. Using the brand kit, user request, brief answers and the ${photoCount} photo(s) above (indexed 0..${photoCount - 1}), produce a complete ready-to-publish package for: ${formats.join(", ")}.

Craft rules:
- Caption: scroll-stopping first line (the hook), then short line-broken paragraphs, tasteful emoji, and a clear CTA matching the goal. Write in the brand's caption language.
- Hashtags: 12-18, mixing broad reach and niche/local tags relevant to the business and photo. No banned or spammy tags.
- Layouts: pick the best photoIndex per format. headline <= 6 punchy words, subline <= 10 words, cta <= 4 words. Choose template ("clean" = elegant scrim + type, "bold" = big centered statement, "frame" = bordered editorial card) and textPosition to suit the photo's composition — never cover the photo's main subject. accentColor: a #rrggbb that complements BOTH the photo and brand palette. textColor: #ffffff or a near-black #rrggbb, whichever contrasts with the photo area behind the text. The client app overlays the business logo automatically — never mention the logo in text.
- Reel: hook <= 8 words, then 4-6 scenes. Each scene: on-screen text <= 8 words, a photoIndex, seconds (1.5-3.5). Story arc: hook → value/details → CTA. "audio" = a specific style of trending audio to search for (do not invent song licenses).
- Story: design for taps — bigger, bolder, one idea. "sticker" = one engagement sticker idea (poll/question/countdown) with its exact text.
- category: a short reusable library category for this shoot (e.g. "Apartments", "Team", "Promotions", "Behind the scenes").
- tips: 2-3 sharp, specific posting tips (best time, first comment, cross-posting). alternatives: 2 different creative angles the user could try next.

Respond with ONLY a JSON object, no prose, matching exactly:
{
  "category": "...",
  "concept": "one-line creative concept",
  "post": {
    "caption": "...", "hashtags": ["#..."], "altText": "accessibility description of the final image",
    "layout": {"template": "clean|bold|frame", "headline": "...", "subline": "...", "cta": "...", "textPosition": "top|center|bottom", "accentColor": "#rrggbb", "textColor": "#rrggbb", "logoPosition": "top-left|top-right|bottom-left|bottom-right", "photoIndex": 0}
  },
  "story": {"layout": {same shape as post.layout}, "sticker": "..."},
  "reel": {"hook": "...", "caption": "...", "audio": "...", "cover": {same shape as post.layout}, "scenes": [{"text": "...", "photoIndex": 0, "seconds": 2.5}]},
  "tips": ["..."], "alternatives": ["..."]
}
Include every key even for formats not requested (fill them sensibly anyway — they cost you nothing and the user may want them later).`;
}

async function aiStudio(body: any) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false, error: "AI not configured" } };
  if (!codeMatches(body?.code)) return NEED_CODE;
  const task = str(body?.task);
  const photos = studioPhotoBlocks(body);
  if (!photos.length) return { status: 400, body: { ok: false, error: "At least one photo is required" } };
  const formats = arr<any>(body?.formats).map(str).filter((f) => ["post", "story", "reel"].includes(f));
  const context = studioContext(body);

  const content: any[] = [...photos, { type: "text", text: `${context}\n\n${task === "questions" ? STUDIO_QUESTIONS_PROMPT : studioGeneratePrompt(photos.length, formats.length ? formats : ["post", "story", "reel"])}` }];
  const maxTokens = task === "questions" ? 900 : 3000;

  // Strongest model first (creative quality matters here), then down the chain.
  let json: any;
  let usedModel = AI_STUDIO_MODEL;
  try {
    json = await anthropic({ model: AI_STUDIO_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content }] });
  } catch {
    try {
      usedModel = AI_VISION_MODEL;
      json = await anthropic({ model: AI_VISION_MODEL, max_tokens: maxTokens, thinking: { type: "disabled" }, messages: [{ role: "user", content }] });
    } catch {
      usedModel = AI_MODEL;
      json = await anthropic({ model: AI_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] });
    }
  }

  const data = parseModelJson(aiText(json));
  if (!data) return { status: 200, body: { ok: false, error: "Could not read the AI response" } };

  if (task === "questions") {
    const questions = arr<any>(data?.questions)
      .map((q, i) => ({
        id: str(q?.id) || `q${i + 1}`,
        question: str(q?.question).slice(0, 160),
        options: arr<any>(q?.options)
          .map((o, j) => ({ key: str(o?.key) || String.fromCharCode(97 + j), label: str(o?.label).slice(0, 60) }))
          .filter((o) => o.label)
          .slice(0, 4),
      }))
      .filter((q) => q.question && q.options.length >= 2)
      .slice(0, 3);
    return { status: 200, body: { ok: true, data: { questions }, model: usedModel } };
  }

  return { status: 200, body: { ok: true, data: normalizeStudio(data, photos.length), model: usedModel } };
}

// ── Push notifications (privacy-preserving: market open/close + daily recap) ─
//
// Storage is Vercel KV (Upstash Redis REST). VAPID keys come from env. If any
// of that is missing, the feature reports "not configured" and nothing breaks.

const VAPID_PUBLIC = "BNxnJi4BuHQzkMrh9pFVr3sJq70P15NklzGvjIJCO3EdA-Kxx3Siwr9aHTzZ3iPBQ8eJOdI4cmyxdT6FkYzuOPU";
// Accept either the Vercel KV names or the native Upstash names, so whichever
// the storage integration injects works without extra config.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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
    { title: "AC App", body: "🔔 Notifications are working — you're all set!", url: "/" },
    subId(sub.endpoint)
  );
  return { status: 200, body: { ok } };
}

// ── Apple Health background sync ─────────────────────────────────────────────
// An iOS Shortcut sends the day's metrics to health-push (keyed by a private
// per-device sync key); the installed app pulls them on open. This is what lets
// automation data reach the standalone Home Screen app, whose storage is
// isolated from Safari (where the Shortcut's "Open URLs" would otherwise land).
function kvConfigured(): boolean {
  return !!(KV_URL && KV_TOKEN);
}

const HEALTH_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HEALTH_MAX_DAYS = 120;

function healthNum(v: string | null | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const f = parseFloat(String(v));
  return isFinite(f) && f > 0 ? f : undefined;
}

function readHealthParams(get: (k: string) => string | null) {
  return {
    date: (get("date") || "").slice(0, 10) || undefined,
    steps: healthNum(get("steps")),
    weightKg: healthNum(get("weight")),
    sleepH: healthNum(get("sleep")),
    waterMl: healthNum(get("water")),
    activeKcal: healthNum(get("kcal")),
  };
}

async function healthPush(key: string, get: (k: string) => string | null) {
  if (!kvConfigured()) return { status: 200, body: { ok: false, configured: false } };
  if (!HEALTH_KEY_RE.test(key)) return { status: 400, body: { ok: false, error: "bad key" } };
  const p = readHealthParams(get);
  const date = p.date || new Date().toISOString().slice(0, 10);
  const metrics: Record<string, number> = {};
  if (p.steps != null) metrics.steps = Math.round(p.steps);
  if (p.weightKg != null) metrics.weightKg = p.weightKg;
  if (p.sleepH != null) metrics.sleepH = p.sleepH;
  if (p.waterMl != null) metrics.waterMl = Math.round(p.waterMl);
  if (p.activeKcal != null) metrics.activeKcal = Math.round(p.activeKcal);
  if (Object.keys(metrics).length === 0) return { status: 400, body: { ok: false, error: "no data" } };

  const raw = await kv(["GET", `health:${key}`]);
  let map: Record<string, any> = {};
  try { if (raw) map = JSON.parse(raw); } catch { map = {}; }
  map[date] = { ...(map[date] || {}), ...metrics, at: Date.now() };
  // Keep only the most recent days so the blob can't grow without bound.
  const dates = Object.keys(map).sort();
  while (dates.length > HEALTH_MAX_DAYS) { const d = dates.shift(); if (d) delete map[d]; }
  await kv(["SET", `health:${key}`, JSON.stringify(map)]);
  return { status: 200, body: { ok: true, configured: true, saved: { date, ...metrics } } };
}

async function healthPull(key: string) {
  if (!kvConfigured()) return { status: 200, body: { configured: false, days: [] } };
  if (!HEALTH_KEY_RE.test(key)) return { status: 400, body: { configured: true, error: "bad key", days: [] } };
  const raw = await kv(["GET", `health:${key}`]);
  let map: Record<string, any> = {};
  try { if (raw) map = JSON.parse(raw); } catch { map = {}; }
  const days = Object.keys(map).sort().map((date) => ({ date, ...map[date] }));
  return { status: 200, body: { configured: true, days } };
}

// ── Daily briefings ──────────────────────────────────────────────────────────
// News is accumulated through the day (piggybacking on the news the app already
// fetches — no cron needed), then an AI editor ranks the day's most important
// stories at briefing time. The briefing also folds in a market snapshot and a
// short AI health recommendation from the user's own data.
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function collectDayNews(items: any[]): Promise<void> {
  if (!kvConfigured() || !Array.isArray(items) || items.length === 0) return;
  const key = `news:day:${utcDay()}`;
  try {
    const raw = await kv(["GET", key]);
    let arr: any[] = [];
    try { if (raw) arr = JSON.parse(raw); } catch { arr = []; }
    const seen = new Set(arr.map((a) => a.id));
    let added = 0;
    for (const it of items) {
      if (!it?.id || seen.has(it.id)) continue;
      seen.add(it.id);
      arr.push({ id: it.id, title: it.title, source: it.source, section: it.topicKey || "", country: it.countryCode || "", link: it.link, at: it.publishedAt || null });
      added++;
    }
    if (!added) return;
    if (arr.length > 400) arr = arr.slice(arr.length - 400);
    await kv(["SET", key, JSON.stringify(arr), "EX", 172800]);
  } catch {
    /* collection is best-effort */
  }
}

async function rankDayNews(date: string) {
  if (!kvConfigured()) return { items: [], note: "Storage not set up." };
  const raw = await kv(["GET", `news:day:${date}`]);
  let arr: any[] = [];
  try { if (raw) arr = JSON.parse(raw); } catch { arr = []; }
  if (!arr.length) return { items: [], note: "No news gathered yet today — open the News tab and it'll fill up." };
  const recent = arr.slice(-140);
  const list = recent.map((a, i) => `${i}. [${a.section || a.country || "general"}] ${a.title} — ${a.source}`).join("\n");
  const prompt = `You are a news editor assembling a reader's daily briefing. From the day's headlines below, pick the TOP 10 most important and newsworthy, spread across different sections (don't over-pick one topic). Respond with ONLY a JSON object:
{"items":[{"i": <headline number>, "section":"short section label", "why":"one short sentence on why it matters"}]}
Headlines:
${list}`;
  try {
    const json = await anthropic({ model: AI_MODEL, max_tokens: 900, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] });
    const parsed = parseModelJson(aiText(json));
    const picks = Array.isArray(parsed?.items) ? parsed.items : [];
    const items = picks
      .map((p: any) => {
        const src = recent[Number(p?.i)];
        if (!src) return null;
        return { title: str(src.title), source: str(src.source), link: str(src.link), section: str(p?.section) || str(src.section), why: str(p?.why) };
      })
      .filter(Boolean)
      .slice(0, 10);
    return { items };
  } catch {
    // Fall back to the most recent headlines unranked.
    return { items: recent.slice(-10).reverse().map((a) => ({ title: str(a.title), source: str(a.source), link: str(a.link), section: str(a.section), why: "" })), note: "Showing latest (ranking unavailable)." };
  }
}

async function healthAdvice(slot: string, summary: any) {
  const prompt = `You are a supportive, practical health coach. It's the user's ${slot} check-in. Using their data today and recent trend, write a short, specific, encouraging note. Data: ${JSON.stringify(summary).slice(0, 1600)}.
Respond with ONLY JSON: {"headline":"<4-8 word upbeat headline>","advice":"<2-3 sentences, concrete and personal>","focus":["<short actionable tip>","<short actionable tip>"]}.`;
  try {
    const json = await anthropic({ model: AI_MODEL, max_tokens: 450, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] });
    const d = parseModelJson(aiText(json));
    if (!d) return null;
    return { headline: str(d.headline), advice: str(d.advice), focus: arr<any>(d.focus).map(str).filter(Boolean).slice(0, 3) };
  } catch {
    return null;
  }
}

async function briefingHandler(body: any) {
  if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false } };
  if (!codeMatches(body?.code)) return NEED_CODE;
  const slot = ["morning", "lunch", "evening"].includes(body?.slot) ? body.slot : "morning";
  const date = utcDay();

  // Top news, cached per day+slot (shared, so repeated opens don't re-bill AI).
  let news: any = null;
  const cacheKey = `briefing:news:${date}:${slot}`;
  if (kvConfigured()) {
    try { const c = await kv(["GET", cacheKey]); if (c) news = JSON.parse(c); } catch { news = null; }
  }
  if (!news) {
    news = await rankDayNews(date);
    if (kvConfigured() && news?.items?.length) {
      try { await kv(["SET", cacheKey, JSON.stringify(news), "EX", 10800]); } catch { /* ignore */ }
    }
  }

  // Market snapshot.
  let market: any = null;
  try {
    const { quotes } = await getQuotes(["^GSPC", "^IXIC", "^DJI", "^GDAXI", "^SSMI"]);
    market = quotes.map((q: any) => ({ symbol: q.symbol, name: q.name, price: q.price, changePercent: q.changePercent }));
  } catch {
    market = null;
  }

  // Personal health advice from the summary the client sends.
  let health: any = null;
  if (body?.health && typeof body.health === "object") {
    health = await healthAdvice(slot, body.health);
  }

  return { status: 200, body: { ok: true, slot, date, news, market, health, model: AI_MODEL } };
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
    return bits.length ? `Today: ${bits.join(", ")}. Open AC App for your watchlist.` : "Open AC App for today's market recap.";
  } catch {
    return "Open AC App for today's market recap.";
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
        const ok = await sendTo(rec, { title: "AC App", body: f.type === "open" ? `🟢 ${f.name} are open` : `🔴 ${f.name} have closed`, url: "/markets" }, id);
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

// ── Rate limiting ────────────────────────────────────────────────────────────
// Two tiers. Free/high-traffic routes (news, quotes, img, sports) use an
// in-memory fixed-window counter — per serverless instance, zero latency, and
// still enough to blunt a hammering client. Routes that spend money (AI) or
// write to storage (health-push) use a KV-backed counter shared across all
// instances. KV errors fail OPEN: the limiter is nuisance-control, not a
// vault — an Upstash hiccup must never take the app down.

const rlMem = new Map<string, { n: number; reset: number }>();

function memBump(key: string, windowSec: number): number {
  const now = Date.now();
  let e = rlMem.get(key);
  if (!e || e.reset <= now) {
    if (rlMem.size > 5000) rlMem.clear(); // bound memory under an IP-spray flood
    e = { n: 0, reset: now + windowSec * 1000 };
    rlMem.set(key, e);
  }
  e.n += 1;
  return e.n;
}

async function kvBump(key: string, windowSec: number): Promise<number> {
  if (!kvConfigured()) return memBump(key, windowSec);
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const k = `rl:${key}:${bucket}`;
  try {
    const n = Number(await kv(["INCR", k]));
    if (n === 1) await kv(["EXPIRE", k, windowSec]);
    return isFinite(n) ? n : 0;
  } catch {
    return 0; // fail open
  }
}

// Read the wrong-code counter without incrementing it.
async function badCodeCount(ip: string): Promise<number> {
  if (!kvConfigured()) {
    const e = rlMem.get(`bad:${ip}`);
    return e && e.reset > Date.now() ? e.n : 0;
  }
  const bucket = Math.floor(Date.now() / (BAD_CODE_WINDOW * 1000));
  try {
    return Number(await kv(["GET", `rl:bad:${ip}:${bucket}`])) || 0;
  } catch {
    return 0;
  }
}

const FREE_LIMIT = 300;   // free-route hits per minute per IP
const AI_LIMIT = 30;      // AI calls per 5 minutes per IP
const AI_WINDOW = 300;
const PUSH_LIMIT = 40;    // health-push writes per 15 minutes per IP
const PUSH_WINDOW = 900;
const BAD_CODE_LIMIT = 5; // wrong access codes per 15 minutes → AI lockout
const BAD_CODE_WINDOW = 900;

const AI_ROUTES = new Set(["ai-vision", "ai-text", "ai-chat", "ai-studio", "briefing", "ai-unlock"]);

// ── Router (shared by dev middleware and the serverless handler) ─────────────

export async function handleApi(
  pathname: string,
  search: URLSearchParams,
  ctx: { method?: string; body?: any; ip?: string } = {}
): Promise<{ status: number; body: unknown; location?: string; cache?: string }> {
  try {
    const route = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const ip = (ctx.ip || "").trim() || "unknown";

    if (AI_ROUTES.has(route)) {
      if ((await badCodeCount(ip)) >= BAD_CODE_LIMIT) {
        return { status: 429, body: { ok: false, error: "Too many wrong access codes from this connection. Locked for a while — try again in about 15 minutes." } };
      }
      if ((await kvBump(`ai:${ip}`, AI_WINDOW)) > AI_LIMIT) {
        return { status: 429, body: { ok: false, error: "Too many AI requests — take a short break and try again in a few minutes." } };
      }
      // Count wrong (non-empty) codes toward the lockout. A missing code is a
      // fresh user seeing the unlock screen, not a guess — don't punish that.
      const given = ctx.body?.code;
      if (aiLocked() && typeof given === "string" && given !== "" && !codeMatches(given)) {
        await kvBump(`bad:${ip}`, BAD_CODE_WINDOW);
      }
    } else if (route === "health-push") {
      if ((await kvBump(`hp:${ip}`, PUSH_WINDOW)) > PUSH_LIMIT) {
        return { status: 429, body: { ok: false, error: "rate limited" } };
      }
    } else if (memBump(`g:${ip}`, 60) > FREE_LIMIT) {
      return { status: 429, body: { error: "rate limited" }, cache: "no-store" };
    }

    if (route === "img") {
      const u = search.get("u") || "";
      const safe = safeHttpUrl(u);
      if (!safe) return { status: 400, body: { error: "bad url" } };
      const img = await resolveArticleImage(safe.toString());
      if (!img) return { status: 404, body: { error: "no image" }, cache: "no-store" };
      // Redirect the <img> to the resolved photo; cache the redirect hard.
      return { status: 302, body: null, location: img, cache: "public, max-age=86400, s-maxage=86400" };
    }

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
      // Accumulate the day's headlines for the briefing (best-effort, no-op if
      // storage isn't configured).
      try { await collectDayNews((data as any).items); } catch { /* ignore */ }
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
      // Verify an access code without spending any credit. Constant-time
      // compare + a small delay throttle brute-force attempts.
      if (!aiConfigured()) return { status: 200, body: { ok: false, configured: false } };
      const ok = codeMatches(ctx.body?.code);
      if (!ok) await sleep(400);
      return { status: 200, body: { ok } };
    }

    if (route === "ai-vision") {
      const b = ctx.body || {};
      if (!b.image) return { status: 400, body: { ok: false, error: "image required" } };
      return await aiVision(b.task || "identify", String(b.image), b.mediaType || "image/jpeg", b.code, arr<any>(b.hints).map(str).filter(Boolean));
    }

    if (route === "ai-text") {
      return await aiTextTask(ctx.body || {});
    }

    if (route === "ai-chat") {
      return await aiChat(ctx.body || {});
    }

    if (route === "ai-studio") {
      return await aiStudio(ctx.body || {});
    }

    if (route === "health-status") {
      return { status: 200, body: { configured: kvConfigured() } };
    }

    if (route === "health-push") {
      // Accept the key + metrics from either the query string (Shortcut GET) or
      // a JSON POST body.
      const body = ctx.body || {};
      const key = search.get("key") || body.key || "";
      const get = (k: string): string | null => {
        const q = search.get(k);
        if (q != null) return q;
        return body[k] != null ? String(body[k]) : null;
      };
      return await healthPush(String(key), get);
    }

    if (route === "health-pull") {
      return await healthPull(search.get("key") || ctx.body?.key || "");
    }

    if (route === "briefing") {
      return await briefingHandler(ctx.body || {});
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
  // Vercel sets x-forwarded-for itself; the first entry is the real client.
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
  const { status, body: out, location, cache } = await handleApi(url.pathname, url.searchParams, { method: req.method, body, ip });

  // Redirect responses (e.g. the image resolver).
  if (location) {
    res.statusCode = status;
    res.setHeader("Location", location);
    if (cache) res.setHeader("Cache-Control", cache);
    res.end();
    return;
  }

  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  // Push/tick/AI endpoints must never be cached. An empty news response (all
  // sources momentarily down) must also not be cached, or the CDN would pin the
  // empty screen for its whole TTL — force a fresh retry on the next request.
  const emptyNews = url.pathname.endsWith("/news") && (out as any)?.count === 0;
  const noCache = url.pathname.includes("/push-") || url.pathname.endsWith("/tick") || url.pathname.includes("/ai-") || url.pathname.includes("/health-") || url.pathname.endsWith("/briefing") || emptyNews;
  res.setHeader("Cache-Control", cache || (noCache ? "no-store" : "s-maxage=60, stale-while-revalidate=300"));
  res.end(JSON.stringify(out));
}
