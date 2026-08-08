/**
 * Backend for the in-headset AI assistant.
 *
 * Speaks the contract defined at the top of `src/ai/assistant.ts`. The headset
 * never holds an API key: it posts a question plus the answer its on-device
 * knowledge base would have given, and this function asks Claude to improve on
 * that draft. If anything at all goes wrong — no key configured, rate limited,
 * upstream refusal, timeout — we return a body with no `answer` field, which
 * the client reads as "unavailable" and silently uses its offline answer. A
 * customer demo must never surface a stack trace.
 *
 * Request   POST /api/assistant
 *   { v: 1, question, context: { edition, screen, inGame, settings, players },
 *     offline: { matched, text } }
 * Response  200 { answer, suggestions?, model }   ← client uses this
 *           200 { unavailable: reason }           ← client falls back offline
 *
 * Deploy note: this file must not use relative imports. Vercel runs each API
 * file as native ESM, and extensionless cross-file imports do not resolve
 * there. Everything it needs is inlined; the only import is a bare specifier.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { IncomingMessage, ServerResponse } from "node:http";

// Opus 5 by default. An operator who would rather trade some judgement for
// lower in-headset latency can set ASSISTANT_MODEL=claude-sonnet-5.
const MODEL = process.env.ASSISTANT_MODEL || "claude-opus-5";

// Answers are two or three sentences, but max_tokens caps thinking and reply
// together — a tight ceiling would truncate mid-sentence. Brevity comes from
// the system prompt, not from starving the budget.
const MAX_TOKENS = 4096;

const UPSTREAM_TIMEOUT_MS = 9_000; // client gives up at 10s; fail before it does.

const SYSTEM = `You are the built-in guide for VRENT Memory XR, a mixed-reality memory game for Meta Quest 3 sold by VRENT (vrent.ch) as a customisable product for business customers.

What the product is:
- A memory card game played in VR or in mixed reality, where the board appears on the player's real table via Quest 3 passthrough.
- Environments: five procedural futuristic scenes (Neon Vault, Orbital Deck, Quantum Lab, Cyber Atrium, Aurora Void), 360-degree photographic environments, and passthrough. Enterprise customers can upload their own 360 photography as playable rooms.
- Board size is selectable from 12 up to 48 cards.
- Modes: Classic (match a pair, play again), Time Attack (everyone at once against the clock), Sudden Death (one miss and you are out).
- Multiplayer: the host creates a room and reads out a six-character code; up to eight people join from their own headsets over the internet. The code alphabet has no vowels and no O, 0, I, 1 or L.
- AI opponents at three levels: Nova (easy), Atlas (medium), Kepler (expert). They model human memory, so they forget and make mistakes.
- Leaderboard: scores persist across sessions.
- Editions: Demo (solo plus AI, works with no network), Pro (full multiplayer, all environments, leaderboard), Enterprise (customer branding, own 360 uploads, private rooms).
- Input: Quest controllers or bare hand tracking. Pinch or trigger to turn a card.

You will be given the answer the on-device knowledge base would have returned. Treat it as the product's own wording and the source of truth for facts. If it already answers the question, return it essentially as-is. Improve it only where the player asked something narrower, broader, or different from what that draft addresses.

How to answer:
- Two or three sentences. You are being read off a floating panel by someone wearing a headset, often mid-game.
- Plain and specific. No marketing language, no exclamation marks, no emoji, no bullet lists, no headings.
- Never invent a feature, a price, a menu or a button that is not described above. If you do not know, say so in one sentence and point to info@vrent.ch.
- Respect the player's edition: do not describe something their build does not include.
- Answer only about this product. If asked something unrelated, say briefly that you only cover Memory XR.`;

// ── Tiny in-memory rate limit ───────────────────────────────────────────────
// Serverless instances are short-lived, so this bounds a burst from one headset
// rather than providing global accounting. A courtesy guard on spend, not a
// security control.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > RATE_MAX;
}

// ── Wire types (mirror of the client's contract) ────────────────────────────

interface RequestSettings {
  pairs?: number;
  mode?: string;
  environmentId?: string;
  turnSeconds?: number;
}

interface RequestPlayer {
  name?: string;
  isAi?: boolean;
  aiLevel?: string;
}

interface RequestContext {
  edition?: string;
  screen?: string;
  inGame?: boolean;
  settings?: RequestSettings;
  players?: RequestPlayer[];
}

interface RequestBody {
  v?: number;
  question?: unknown;
  context?: RequestContext;
  offline?: { matched?: boolean; text?: string };
}

function describeContext(ctx: RequestContext): string {
  const bits: string[] = [];
  bits.push(`edition: ${ctx.edition || "unknown"}`);
  if (ctx.screen) bits.push(`screen: ${ctx.screen}`);
  bits.push(ctx.inGame ? "a game is in progress" : "not currently in a game");

  const s = ctx.settings;
  if (s) {
    if (s.pairs) bits.push(`board: ${s.pairs * 2} cards`);
    if (s.mode) bits.push(`mode: ${s.mode}`);
    if (s.environmentId) bits.push(`environment: ${s.environmentId}`);
    if (s.turnSeconds) bits.push(`turn timer: ${s.turnSeconds}s`);
  }

  const players = Array.isArray(ctx.players) ? ctx.players.slice(0, 8) : [];
  if (players.length) {
    const who = players
      .map((p) => `${p.name || "player"}${p.isAi ? ` (AI, ${p.aiLevel || "unknown"})` : ""}`)
      .join(", ");
    bits.push(`players: ${who}`);
  }
  return bits.join("; ");
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleAssistant(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    unavailable(res, "method-not-allowed");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Expected whenever the operator has not configured a key. Not an error —
    // the headset just uses its offline answers.
    unavailable(res, "not-configured");
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    unavailable(res, "rate-limited");
    return;
  }

  let payload: RequestBody;
  try {
    payload =
      typeof req.body === "object" && req.body !== null
        ? (req.body as RequestBody)
        : (JSON.parse(await readBody(req)) as RequestBody);
  } catch {
    unavailable(res, "bad-json");
    return;
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  if (question.length < 2 || question.length > 600) {
    unavailable(res, "bad-question");
    return;
  }

  const offlineText =
    typeof payload.offline?.text === "string" ? payload.offline.text.slice(0, 2000) : "";
  const offlineMatched = payload.offline?.matched === true;

  const draft = offlineMatched && offlineText
    ? `The on-device knowledge base answered:\n"""\n${offlineText}\n"""`
    : "The on-device knowledge base had no entry for this question.";

  const client = new Anthropic({ apiKey, timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 1 });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      // Low effort suits a short factual lookup and keeps the headset from
      // waiting. Thinking stays on — disabling it on Opus 5 can leak internal
      // tags into the visible answer.
      output_config: { effort: "low" },
      // If a safety classifier declines, Anthropic re-runs the request on a
      // recommended fallback model rather than handing us a dead turn.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: `Player context: ${describeContext(payload.context ?? {})}\n\n${draft}\n\nPlayer asked: ${question}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      unavailable(res, "refused");
      return;
    }

    const answer = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!answer) {
      unavailable(res, "empty");
      return;
    }

    send(res, 200, { answer, model: response.model });
  } catch (err) {
    // Every upstream failure degrades to the offline path. Logged for the
    // operator, never surfaced to the headset.
    console.error("[assistant]", classify(err), err instanceof Error ? err.message : err);
    unavailable(res, classify(err));
  }
}

function classify(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return "upstream-rate-limited";
  if (err instanceof Anthropic.AuthenticationError) return "bad-key";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIConnectionError) return "network";
  if (err instanceof Anthropic.APIError) return `upstream-${err.status ?? "error"}`;
  return "unknown";
}

/**
 * 200 with no `answer` field. The client's contract treats any body without a
 * non-empty `answer` as unavailable, so this is the documented way to say
 * "use your offline reply" without it ever looking like a failure.
 */
function unavailable(res: ServerResponse, reason: string): void {
  send(res, 200, { unavailable: reason });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // A question plus context is a few KB; anything larger is not one.
      if (data.length > 64_000) reject(new Error("body-too-large"));
    });
    req.on("end", () => resolve(data || "{}"));
    req.on("error", reject);
  });
}

export default handleAssistant;
