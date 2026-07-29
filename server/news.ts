import { COUNTRIES, TOPICS, type Country, type Topic } from "../shared/catalog";
import { fetchFeed, type FeedItem } from "./rss";

const GN = "https://news.google.com/rss";

function ceid(c: Country) {
  return { hl: `${c.lang}-${c.code}`, gl: c.code, ceid: `${c.code}:${c.lang}` };
}

function qs(params: Record<string, string>) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Build the Google News RSS URL for a country + topic combination. */
function feedUrl(country: Country, topic: Topic, extraQuery?: string): string {
  const loc = ceid(country);
  const extra = (extraQuery || "").trim();
  if (topic.key === "top" && !topic.query && !extra) {
    return `${GN}?${qs(loc)}`;
  }
  if (topic.section && !extra) {
    return `${GN}/headlines/section/topic/${topic.section}?${qs(loc)}`;
  }
  const q = [topic.query, extra].filter(Boolean).join(" ");
  if (!q) return `${GN}?${qs(loc)}`;
  return `${GN}/search?${qs({ q, ...loc })}`;
}

export interface NewsParams {
  countries: string[];
  topics: string[];
  query?: string; // free-text keyword layered on top
}

export interface NewsItem extends FeedItem {
  countryCode: string;
  topicKey: string;
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

export async function getNews(params: NewsParams) {
  const countries = params.countries
    .map((code) => COUNTRIES.find((c) => c.code === code))
    .filter((c): c is Country => !!c);
  const topics = params.topics
    .map((key) => TOPICS.find((t) => t.key === key))
    .filter((t): t is Topic => !!t);

  const cs = countries.length ? countries : [COUNTRIES[0]];
  const ts = topics.length ? topics : [TOPICS[0]];

  const combos: { country: Country; topic: Topic }[] = [];
  for (const c of cs) for (const t of ts) combos.push({ country: c, topic: t });

  // Fetch each combo individually so every item keeps its country/topic tags.
  const results = await Promise.allSettled(
    combos.map(({ country, topic }) =>
      fetchFeed(feedUrl(country, topic, params.query), `${country.name} · ${topic.label}`)
    )
  );

  const tagged: NewsItem[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    const { country, topic } = combos[i];
    if (r.status === "fulfilled") {
      for (const it of r.value) {
        tagged.push({ ...it, countryCode: country.code, topicKey: topic.key });
      }
    } else {
      errors.push(`${country.name}/${topic.label}: ${String(r.reason).slice(0, 100)}`);
    }
  });

  const merged = dedupe(tagged);
  merged.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  return { items: merged.slice(0, 150), errors, count: merged.length };
}
