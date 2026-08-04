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
  // Never serve API data from the browser/PWA cache — always fetch fresh so the
  // 1-minute polling actually reflects the latest news & prices.
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
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
  return getJson<NewsResponse>(`/api/news?${p.toString()}`).then((r) => {
    // The same story can arrive from several feeds (country × topic overlap).
    // Dedupe by id here so every list renders unique keys and no card shows
    // twice — React's duplicate-key warning was causing glitchy lists.
    const seen = new Set<string>();
    const items = (r.items || []).filter((it) => {
      if (!it?.id || seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
    return { ...r, items, count: items.length };
  });
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
export interface PodiumEntry { pos: number | null; name: string; flag: string | null; }
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
  podium?: PodiumEntry[]; // Formula 1 race results (no home/away)
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

// Apple Pay spending sync -----------------------------------------------------
export interface WalletTxDTO { id: string; at: number; amount: number; merchant: string; card: string; currency: string }
export function pullWalletTxs(key: string): Promise<{ configured: boolean; txs: WalletTxDTO[] }> {
  return getJson(`/api/money-pull?key=${encodeURIComponent(key)}`);
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
  items: { name: string; portion?: string; quantity?: number; unit?: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[];
  total: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  confidence: string;
  note: string;
}

export interface ReceiptExtract {
  vendor: string;
  date: string;
  currency: string;
  total: number;
  vatAmount: number;
  vatRate: number;
  category: string;
  description: string;
  confidence: string;
}
export function analyzeReceipt(image: string, mediaType = "image/jpeg"): Promise<AiResult<ReceiptExtract>> {
  return postJson(`/api/ai-vision`, { task: "receipt", image, mediaType, code: getAiCode() });
}

// Extract invoice details from an email's text (HTML invoices with no PDF).
export function aiReceiptFromText(text: string): Promise<AiResult<ReceiptExtract>> {
  return postJson(`/api/ai-text`, { task: "receipt-text", text, code: getAiCode() });
}

// ── Gmail invoice import ─────────────────────────────────────────────────────
// The device holds a private random key; the server keeps the Google tokens
// under it (same model as the Apple Health sync key).

const GMAIL_KEY = "vrent.gmailkey.v1";
export function gmailKey(): string {
  let k = localStorage.getItem(GMAIL_KEY);
  if (!k) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(GMAIL_KEY, k);
  }
  return k;
}

export interface GmailAtt { id: string; filename: string; mime: string; size: number }
export interface GmailEmail { account: string; id: string; from: string; subject: string; date: string; snippet: string; atts: GmailAtt[] }

export function gmailStatus(): Promise<{ configured: boolean; accounts: string[] }> {
  return getJson(`/api/gmail-status?key=${gmailKey()}`);
}
export function gmailConnectUrl(): string {
  return `/api/gmail-auth-start?key=${gmailKey()}`;
}
export function gmailScan(days = 90): Promise<{ ok: boolean; configured?: boolean; accounts: string[]; emails: GmailEmail[]; error?: string }> {
  return getJson(`/api/gmail-scan?key=${gmailKey()}&days=${days}`);
}
export function gmailFetch(account: string, id: string, attId?: string): Promise<{ ok: boolean; kind?: "file" | "text"; data?: string; text?: string; error?: string }> {
  return postJson(`/api/gmail-fetch`, { key: gmailKey(), account, id, attId });
}
export function gmailDisconnect(email: string): Promise<{ ok: boolean; accounts: string[] }> {
  return postJson(`/api/gmail-disconnect`, { key: gmailKey(), email });
}

/** Send a base64 JPEG (no data-URL prefix) for identification or food analysis.
 * `hints` (the user's frequent foods) bias food recognition toward their diet. */
export function analyzeImage<T = Identified>(task: "identify" | "food", image: string, mediaType = "image/jpeg", hints?: string[]): Promise<AiResult<T>> {
  return postJson<AiResult<T>>(`/api/ai-vision`, { task, image, mediaType, hints, code: getAiCode() });
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

// Daily coaching from today's numbers + fasting state (fast model, tiny cost).
export function aiCoach(context: unknown): Promise<AiResult<{ headline: string; advice: string; nextMeal: string }>> {
  return postJson(`/api/ai-text`, { task: "coach", context, code: getAiCode() });
}

// Re-estimate nutrition after the user corrects a food's name and/or amount
// (amount = quantity + unit, e.g. 2 "piece", 1 "cup", 200 "g").
export interface NutritionItem { name: string; quantity: number; unit: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }
export function aiNutrition(items: { name: string; quantity: number; unit: string }[]): Promise<AiResult<{ items: NutritionItem[] }>> {
  return postJson(`/api/ai-text`, { task: "nutrition", items, code: getAiCode() });
}

// Look up a manually-typed food from brand/restaurant/packaged-product data
// (uses the strong model + web search on the server). Returns one or more items.
export interface FoodLookup { items: NutritionItem[]; source: string; note: string }
export function aiFoodLookup(desc: string): Promise<AiResult<FoodLookup>> {
  return postJson(`/api/ai-text`, { task: "food-lookup", desc, code: getAiCode() });
}

// Estimate the effective Swiss income-tax % for a specific Gemeinde (strong
// model + web search finds the current Steuerfuss).
export function aiTaxLookup(p: { canton: string; gemeinde: string; status: string; incomeMonthly: number }): Promise<AiResult<{ taxPct: number; note: string; source: string }>> {
  return postJson(`/api/ai-text`, { task: "tax-lookup", ...p, code: getAiCode() });
}

// In-app assistant: a natural-language request + a snapshot of app state returns
// a spoken reply plus actions the client executes (navigate, log, add event).
export interface AssistantAction { type: string; [k: string]: any }
export interface AssistantResult { reply: string; actions: AssistantAction[] }
export function aiAssistant(message: string, context: unknown): Promise<AiResult<AssistantResult>> {
  return postJson(`/api/ai-text`, { task: "assistant", message, context, code: getAiCode() });
}

// Multi-turn chat about a scanned photo. `image` (base64, no prefix) is only
// needed on the first message; the server keeps it in context via the history.
export interface ChatTurn { role: "user" | "assistant"; text: string }
export function aiChat(image: string | null, mediaType: string, messages: ChatTurn[]): Promise<{ ok: boolean; reply?: string; error?: string; needCode?: boolean; configured?: boolean }> {
  return postJson(`/api/ai-chat`, { image: image || undefined, mediaType, messages, code: getAiCode() });
}
