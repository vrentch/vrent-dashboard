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
  region: string;
  flag: string;
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

export type SignalTone = "pos" | "neg" | "neutral";
export interface SignalReason {
  text: string;
  tone: SignalTone;
}
export interface Signal {
  symbol: string;
  score: number; // -100..100
  label: string; // Strong Sell … Strong Buy
  tone: SignalTone;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  momentumPct: number;
  reasons: SignalReason[];
}

export function fetchSignals(symbols: string[]): Promise<{ signals: Signal[] }> {
  const p = new URLSearchParams({ symbols: symbols.join(",") });
  return getJson(`/api/signals?${p.toString()}`);
}

// ── Sports ───────────────────────────────────────────────────────────────────

export interface GameSide {
  name: string;
  abbrev: string;
  logo: string | null;
  score: string;
  winner: boolean;
}
export interface Game {
  id: string;
  date: string | null;
  state: "pre" | "in" | "post";
  detail: string;
  clock: string;
  home: GameSide | null;
  away: GameSide | null;
  note?: string;
  tournament?: string;
  round?: string;
}
export interface ScoresResponse {
  league: string;
  season: string;
  games: Game[];
}

export interface TableEntry {
  rank: string;
  name: string;
  abbrev: string;
  logo: string | null;
  played: string;
  win: string;
  draw: string;
  loss: string;
  gd: string;
  pts: string;
  pct: string;
  form: string;
}
export interface StandingsResponse {
  league: string;
  hasDraws: boolean;
  groups: { name: string; entries: TableEntry[] }[];
}

export function fetchScores(sport: string, league: string): Promise<ScoresResponse> {
  const p = new URLSearchParams({ sport, league });
  return getJson<ScoresResponse>(`/api/sports-scores?${p.toString()}`);
}

export function fetchStandings(sport: string, league: string): Promise<StandingsResponse> {
  const p = new URLSearchParams({ sport, league });
  return getJson<StandingsResponse>(`/api/sports-standings?${p.toString()}`);
}

// ── AI (vision + text) ───────────────────────────────────────────────────────

export interface AiResult<T = any> {
  ok: boolean;
  data?: T;
  model?: string;
  error?: string;
  configured?: boolean;
  needCode?: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return data as T;
}

export function fetchAiStatus(): Promise<{ configured: boolean; model: string | null; locked: boolean }> {
  return getJson(`/api/ai-status`);
}

// Apple Health background sync ------------------------------------------------
export interface SyncDayDTO {
  date: string;
  steps?: number;
  weightKg?: number;
  sleepH?: number;
  waterMl?: number;
  activeKcal?: number;
}
export function fetchHealthStatus(): Promise<{ configured: boolean }> {
  return getJson(`/api/health-status`);
}
export function pullHealth(key: string): Promise<{ configured: boolean; days: SyncDayDTO[] }> {
  return getJson(`/api/health-pull?key=${encodeURIComponent(key)}`);
}

// Daily briefing --------------------------------------------------------------
export interface BriefingNewsItem { title: string; source: string; link: string; section: string; why: string; }
export interface BriefingMarket { symbol: string; name: string; price: number | null; changePercent: number | null; }
export interface BriefingHealth { headline: string; advice: string; focus: string[]; }
export interface BriefingResult {
  ok: boolean;
  configured?: boolean;
  needCode?: boolean;
  slot?: string;
  news?: { items: BriefingNewsItem[]; note?: string };
  market?: BriefingMarket[] | null;
  health?: BriefingHealth | null;
}
export function fetchBriefing(slot: string, health: unknown): Promise<BriefingResult> {
  return postJson(`/api/briefing`, { slot, health, code: getAiCode() });
}

// Shared AI access code (stored once per device). Attached to every AI request.
const AI_CODE_KEY = "vrent.aicode.v1";
export function getAiCode(): string {
  try { return localStorage.getItem(AI_CODE_KEY) || ""; } catch { return ""; }
}
export function setAiCode(code: string) {
  try { localStorage.setItem(AI_CODE_KEY, code); } catch { /* ignore */ }
}
export function clearAiCode() {
  try { localStorage.removeItem(AI_CODE_KEY); } catch { /* ignore */ }
}

/** Verify an access code with the server (spends no credit). */
export function aiUnlock(code: string): Promise<{ ok: boolean; configured?: boolean }> {
  return postJson(`/api/ai-unlock`, { code });
}

export interface Identified {
  title: string;
  category: string;
  summary: string;
  details: { label: string; value: string }[];
  detectedText: string;
  searchQuery: string;
}

export interface FoodEstimate {
  items: { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[];
  total: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  confidence: string;
  note: string;
}

/** Send a base64 JPEG (no data-URL prefix) for identification or food analysis. */
export function analyzeImage<T = Identified>(task: "identify" | "food", image: string, mediaType = "image/jpeg"): Promise<AiResult<T>> {
  return postJson<AiResult<T>>(`/api/ai-vision`, { task, image, mediaType, code: getAiCode() });
}

export function aiTranslate(text: string, target: string): Promise<AiResult<{ translation: string; sourceLang: string }>> {
  return postJson(`/api/ai-text`, { task: "translate", text, target, code: getAiCode() });
}

export function aiExplain(topic: string): Promise<AiResult<{ explanation: string; keyPoints: string[] }>> {
  return postJson(`/api/ai-text`, { task: "explain", topic, code: getAiCode() });
}

export interface HealthPlan {
  headline: string;
  summary: string;
  targets: { calories: number; protein_g: number; carbs_g: number; fat_g: number; steps: number };
  today: string;
  workouts: { day: string; focus: string; detail: string }[];
  nutrition: string[];
}

export function aiPlan(profile: unknown, recent: unknown): Promise<AiResult<HealthPlan>> {
  return postJson(`/api/ai-text`, { task: "plan", profile, recent, code: getAiCode() });
}

// Re-estimate nutrition after the user corrects a food's name and/or grams.
export interface NutritionItem { name: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }
export function aiNutrition(items: { name: string; grams: number }[]): Promise<AiResult<{ items: NutritionItem[] }>> {
  return postJson(`/api/ai-text`, { task: "nutrition", items, code: getAiCode() });
}

// ── AI Studio (Instagram content generator) ──────────────────────────────────

export interface StudioPhoto {
  data: string; // base64, no data-URL prefix
  mediaType: string;
}
export interface StudioBrandInfo {
  name: string;
  handle: string;
  tagline: string;
  about: string;
  primary: string;
  secondary: string;
  language: string;
}
export interface StudioQuestion {
  id: string;
  question: string;
  options: { key: string; label: string }[];
}
export interface StudioAnswer {
  question: string;
  answer: string;
}
export interface StudioLayout {
  template: "clean" | "bold" | "frame";
  headline: string;
  subline: string;
  cta: string;
  textPosition: "top" | "center" | "bottom";
  accentColor: string;
  textColor: string;
  logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  photoIndex: number;
}
export interface StudioScene {
  text: string;
  photoIndex: number;
  seconds: number;
}
export interface StudioPackage {
  category: string;
  concept: string;
  post: { caption: string; hashtags: string[]; altText: string; layout: StudioLayout };
  story: { layout: StudioLayout; sticker: string };
  reel: { hook: string; caption: string; audio: string; cover: StudioLayout; scenes: StudioScene[] };
  tips: string[];
  alternatives: string[];
}

export function aiStudioQuestions(
  photos: StudioPhoto[],
  prompt: string,
  brand: StudioBrandInfo,
  formats: string[]
): Promise<AiResult<{ questions: StudioQuestion[] }>> {
  return postJson(`/api/ai-studio`, { task: "questions", photos, prompt, brand, formats, code: getAiCode() });
}

export function aiStudioGenerate(
  photos: StudioPhoto[],
  prompt: string,
  brand: StudioBrandInfo,
  formats: string[],
  answers: StudioAnswer[],
  revision?: string
): Promise<AiResult<StudioPackage>> {
  return postJson(`/api/ai-studio`, { task: "generate", photos, prompt, brand, formats, answers, revision, code: getAiCode() });
}

// Multi-turn chat about a scanned photo. `image` (base64, no prefix) is only
// needed on the first message; the server keeps it in context via the history.
export interface ChatTurn { role: "user" | "assistant"; text: string }
export function aiChat(image: string | null, mediaType: string, messages: ChatTurn[]): Promise<{ ok: boolean; reply?: string; error?: string; needCode?: boolean; configured?: boolean }> {
  return postJson(`/api/ai-chat`, { image: image || undefined, mediaType, messages, code: getAiCode() });
}
