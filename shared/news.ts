import { XMLParser } from 'fast-xml-parser'

// ---------------------------------------------------------------------------
// VR / AR news engine
// ---------------------------------------------------------------------------
// Pulls headlines from public Google News RSS searches (no API key, no cost),
// merges + de-duplicates them, and tags each item with topics so the UI can
// filter client-side. This module is imported by BOTH the Vercel serverless
// function (api/news.ts) and the Vite dev middleware, so live data behaves
// identically in dev and production.

export type Topic =
  | 'vr'
  | 'ar'
  | 'mr'
  | 'hardware'
  | 'apps'
  | 'business'

export interface Article {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string // ISO
  topics: Topic[]
  snippet: string
}

export const TOPIC_LABELS: Record<Topic, string> = {
  vr: 'Virtual Reality',
  ar: 'Augmented Reality',
  mr: 'Mixed Reality',
  hardware: 'Headsets & Hardware',
  apps: 'Apps & Games',
  business: 'Industry & Business',
}

// Each query is a Google News RSS search. Keeping them focused (rather than one
// broad "VR" query) gives better recall across the VR/AR landscape.
const QUERIES: string[] = [
  '"virtual reality" OR "VR headset"',
  '"augmented reality" OR "AR glasses"',
  '"mixed reality" OR "spatial computing"',
  '"Meta Quest" OR "Quest 3"',
  '"Apple Vision Pro"',
  '"XREAL" OR "Ray-Ban Meta" smart glasses',
  '"VR gaming" OR "VR app"',
]

// Keyword → topic classification. Applied against title + snippet.
const CLASSIFIERS: Array<{ topic: Topic; re: RegExp }> = [
  { topic: 'vr', re: /\b(virtual reality|vr\b|quest|vive|pico|psvr|valve index)/i },
  { topic: 'ar', re: /\b(augmented reality|\bar\b|ar glasses|xreal|ray-ban meta|smart glasses|hololens)/i },
  { topic: 'mr', re: /\b(mixed reality|spatial computing|passthrough|vision pro)/i },
  { topic: 'hardware', re: /\b(headset|glasses|controller|chipset|display|lens|hardware|device|wearable|camera)/i },
  { topic: 'apps', re: /\b(game|gaming|app|experience|title|studio|steam|play|multiplayer)/i },
  { topic: 'business', re: /\b(market|revenue|funding|acquisition|launch|price|sales|company|startup|billion|million|invest|enterprise|training)/i },
]

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

interface RssItem {
  title?: string
  link?: string
  pubDate?: string
  description?: string
  source?: { '#text'?: string } | string
}

function classify(text: string): Topic[] {
  const topics = CLASSIFIERS.filter((c) => c.re.test(text)).map((c) => c.topic)
  // Guarantee at least one bucket so nothing is unfilterable.
  return topics.length ? topics : ['vr']
}

// Google News titles look like "Headline - Source". Split the source out.
function splitTitleSource(raw: string, fallbackSource: string): { title: string; source: string } {
  const idx = raw.lastIndexOf(' - ')
  if (idx > 0 && idx > raw.length - 60) {
    return { title: raw.slice(0, idx).trim(), source: raw.slice(idx + 3).trim() }
  }
  return { title: raw.trim(), source: fallbackSource }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stableId(url: string): string {
  // Small deterministic hash so the client has a stable React key / dedupe key.
  let h = 0
  for (let i = 0; i < url.length; i++) {
    h = (h << 5) - h + url.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

async function fetchQuery(query: string, signal?: AbortSignal): Promise<Article[]> {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=en-US&gl=US&ceid=US:en'

  const res = await fetch(url, {
    signal,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; VrentNewsBot/1.0)' },
  })
  if (!res.ok) throw new Error(`feed ${res.status}`)
  const xml = await res.text()
  const doc = parser.parse(xml)
  const items: RssItem[] = doc?.rss?.channel?.item ?? []
  const list = Array.isArray(items) ? items : [items]

  return list
    .filter((it) => it && it.title && it.link)
    .map((it) => {
      const fallbackSource =
        typeof it.source === 'object' ? (it.source?.['#text'] ?? '') : (it.source ?? '')
      const { title, source } = splitTitleSource(String(it.title), fallbackSource)
      const snippet = it.description ? stripHtml(String(it.description)).slice(0, 220) : ''
      const url = String(it.link)
      return {
        id: stableId(url),
        title,
        url,
        source: source || 'News',
        publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : new Date(0).toISOString(),
        topics: classify(`${title} ${snippet}`),
        snippet,
      }
    })
}

export async function getNews(): Promise<Article[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const settled = await Promise.allSettled(
      QUERIES.map((q) => fetchQuery(q, controller.signal)),
    )
    const merged = settled
      .filter((s): s is PromiseFulfilledResult<Article[]> => s.status === 'fulfilled')
      .flatMap((s) => s.value)

    // De-dupe by URL, then by normalised title (same story, different feeds).
    const byUrl = new Map<string, Article>()
    for (const a of merged) if (!byUrl.has(a.url)) byUrl.set(a.url, a)

    const byTitle = new Map<string, Article>()
    for (const a of byUrl.values()) {
      const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80)
      const existing = byTitle.get(key)
      if (!existing) {
        byTitle.set(key, a)
      } else {
        // Merge topic tags from duplicate coverage.
        existing.topics = Array.from(new Set([...existing.topics, ...a.topics]))
      }
    }

    return Array.from(byTitle.values())
      .filter((a) => a.publishedAt !== new Date(0).toISOString())
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
      .slice(0, 60)
  } finally {
    clearTimeout(timeout)
  }
}
