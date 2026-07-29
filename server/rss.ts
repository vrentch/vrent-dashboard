import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string | null; // ISO
  summary: string;
  imageUrl: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Google News feeds are entity-heavy and trip the parser's billion-laughs
  // guard. We leave entities untouched here and decode them ourselves in
  // decodeEntities() / stripHtml(), which is safe and avoids that limit.
  processEntities: false,
});

const UA =
  "Mozilla/5.0 (compatible; VrentDashboard/1.0; +https://vrent.ch)";

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as any)) return String((v as any)["#text"] ?? "");
  return String(v);
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

function decodeEntities(s: string): string {
  return s
    // Numeric decimal (&#39;) and hex (&#x27;) entities.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    // Common named entities.
    .replace(/&([a-zA-Z]+|#\d+);/g, (m, name) => NAMED[name] ?? m);
}

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  return decodeEntities(
    html.replace(/<[^>]*>/g, " ")
  )
    // A second pass catches entities that were themselves inside tags/text.
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function findImage(item: any, summaryHtml: string): string | null {
  // Common RSS image carriers
  const mediaContent = asArray(item["media:content"])[0];
  if (mediaContent?.["@_url"]) return mediaContent["@_url"];
  const mediaThumb = asArray(item["media:thumbnail"])[0];
  if (mediaThumb?.["@_url"]) return mediaThumb["@_url"];
  const enclosure = asArray(item.enclosure).find((e: any) =>
    String(e?.["@_type"] || "").startsWith("image")
  );
  if (enclosure?.["@_url"]) return enclosure["@_url"];
  // Fall back to first <img> inside the description HTML
  const m = summaryHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Fetch a single RSS/Atom feed and normalise its items. */
export async function fetchFeed(
  url: string,
  fallbackSource: string,
  limit = 40
): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`feed ${res.status} for ${url}`);
  const xml = await res.text();
  const doc = parser.parse(xml);

  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"];
  const feed = doc?.feed; // Atom
  const channelTitle = textOf(channel?.title) || textOf(feed?.title) || fallbackSource;

  const rawItems = channel ? asArray(channel.item) : asArray(feed?.entry);

  const items: FeedItem[] = rawItems.slice(0, limit).map((it: any, i: number) => {
    const title = stripHtml(textOf(it.title));
    // Atom links are objects with @_href; RSS links are plain text.
    let link = "";
    if (typeof it.link === "string") link = it.link;
    else if (Array.isArray(it.link)) {
      const alt = it.link.find((l: any) => l["@_rel"] === "alternate") || it.link[0];
      link = alt?.["@_href"] || "";
    } else if (it.link?.["@_href"]) link = it.link["@_href"];
    link = decodeEntities(link || textOf(it.guid) || textOf(it.id));

    const rawSummary = textOf(it.description) || textOf(it.summary) || textOf(it["content:encoded"]) || textOf(it.content);
    const summary = stripHtml(rawSummary).slice(0, 320);

    // Google News embeds the origin outlet inside <source>
    const sourceName = decodeEntities(textOf(it.source) || channelTitle);

    const dateStr = textOf(it.pubDate) || textOf(it.published) || textOf(it.updated) || textOf(it["dc:date"]);
    const parsed = dateStr ? new Date(dateStr) : null;
    const publishedAt = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;

    return {
      id: link || `${channelTitle}-${i}`,
      title,
      link,
      source: sourceName,
      publishedAt,
      summary,
      imageUrl: findImage(it, rawSummary),
    };
  });

  return items.filter((it) => it.title && it.link);
}

/** Fetch several feeds in parallel, tolerating individual failures. */
export async function fetchFeeds(
  feeds: { url: string; source: string }[]
): Promise<{ items: FeedItem[]; errors: string[] }> {
  const results = await Promise.allSettled(
    feeds.map((f) => fetchFeed(f.url, f.source))
  );
  const items: FeedItem[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${feeds[i].source}: ${String(r.reason).slice(0, 120)}`);
  });
  return { items, errors };
}
