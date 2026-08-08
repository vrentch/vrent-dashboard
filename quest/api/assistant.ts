/**
 * Backend for the in-headset AI assistant.
 *
 * The headset never holds an API key. The client posts a question here, this
 * function asks Claude, and the answer goes back as plain text. If anything at
 * all goes wrong — no key configured, rate limited, upstream refusal, timeout —
 * we return `unavailable` and the client silently falls back to its offline
 * knowledge base. A customer demo must never surface a stack trace.
 *
 * Request   POST /api/assistant
 *   { "question": string, "context": { screen, edition, inGame, pairs, mode,
 *                                      environment, players } }
 * Response  200 { "text": string, "source": "model" }
 *           200 { "source": "unavailable", "reason": string }   ← client falls back
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

// Generous enough that adaptive thinking has room — max_tokens caps thinking
// and reply together, and a tight cap here would truncate mid-sentence. The
// reply itself stays short because the system prompt says so, not because the
// ceiling forces it.
const MAX_TOKENS = 4096;

const UPSTREAM_TIMEOUT_MS = 12_000;

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

How to answer:
- Two or three sentences. You are being read off a floating panel by someone wearing a headset, often mid-game.
- Plain and specific. No marketing language, no exclamation marks, no emoji, no bullet lists.
- If you do not know something, say so in one sentence and suggest contacting info@vrent.ch. Never invent a feature, a price, or a menu that does not exist.
- Answer only about this product. If asked something unrelated, say briefly that you only cover Memory XR.`;

// ── Tiny in-memory rate limit ───────────────────────────────────────────────
// Serverless instances are short-lived, so this bounds a burst from one headset
// rather than providing global accounting. It is a courtesy guard on spend, not
// a security control.
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

// ── Types ───────────────────────────────────────────────────────────────────

interface AssistantContext {
  screen?: string;
  edition?: string;
  inGame?: boolean;
  pairs?: number;
  mode?: string;
  environment?: string;
  players?: number;
}

function describeContext(ctx: AssistantContext): string {
  const bits: string[] = [];
  if (ctx.edition) bits.push(`edition: ${ctx.edition}`);
  if (ctx.screen) bits.push(`current screen: ${ctx.screen}`);
  bits.push(ctx.inGame ? "a game is in progress" : "not currently in a game");
  if (ctx.pairs) bits.push(`board: ${ctx.pairs * 2} cards`);
  if (ctx.mode) bits.push(`mode: ${ctx.mode}`);
  if (ctx.environment) bits.push(`environment: ${ctx.environment}`);
  if (typeof ctx.players === "number") bits.push(`players: ${ctx.players}`);
  return bits.join(", ");
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handleAssistant(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { source: "unavailable", reason: "method-not-allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Expected whenever the operator has not configured a key. The headset
    // treats this as "use the offline answers" — not as an error.
    send(res, 200, { source: "unavailable", reason: "not-configured" });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    send(res, 200, { source: "unavailable", reason: "rate-limited" });
    return;
  }

  let payload: { question?: unknown; context?: AssistantContext };
  try {
    payload = typeof req.body === "object" && req.body !== null
      ? (req.body as typeof payload)
      : JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { source: "unavailable", reason: "bad-json" });
    return;
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  if (question.length < 2 || question.length > 600) {
    send(res, 400, { source: "unavailable", reason: "bad-question" });
    return;
  }

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
          content: `Player context: ${describeContext(payload.context ?? {})}\n\nQuestion: ${question}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      send(res, 200, { source: "unavailable", reason: "refused" });
      return;
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) {
      send(res, 200, { source: "unavailable", reason: "empty" });
      return;
    }

    send(res, 200, { text, source: "model" });
  } catch (err) {
    // Every upstream failure degrades to the offline path. We log for the
    // operator but never leak the reason to the headset.
    console.error("[assistant]", classify(err), err instanceof Error ? err.message : err);
    send(res, 200, { source: "unavailable", reason: classify(err) });
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // A question is a few hundred bytes; anything larger is not a question.
      if (data.length > 64_000) reject(new Error("body-too-large"));
    });
    req.on("end", () => resolve(data || "{}"));
    req.on("error", reject);
  });
}

export default handleAssistant;
