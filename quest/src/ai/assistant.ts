/**
 * The in-headset assistant.
 *
 * Two tiers. The offline tier (`knowledge.ts`) answers on the headset with no
 * network at all and is the one that has to be good — it is what runs at a
 * trade show. The live tier calls a hosted model for anything the knowledge
 * base does not cover, and only when the edition allows it.
 *
 * Any failure on the live path — offline, DNS, 500, timeout, malformed body,
 * empty answer — falls back to the offline answer silently. A customer must
 * never see a stack trace, an error code or an apology from this thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINT CONTRACT
 *
 * The client POSTs to `VITE_ASSISTANT_URL`, or `/api/assistant` if that is not
 * set. The endpoint is not implemented in this repository yet; this block is
 * the specification for whoever writes it.
 *
 * Request  POST <endpoint>
 *          Content-Type: application/json
 *
 *   {
 *     "v": 1,
 *     "question": "how do I turn on passthrough",   // trimmed, <= 500 chars
 *     "context": {
 *       "edition": "pro",                            // demo | pro | enterprise
 *       "screen": "lobby",
 *       "inGame": false,
 *       "settings": { "pairs": 10, "mode": "classic",
 *                     "environmentId": "neon-vault", "turnSeconds": 0 },
 *       "players": [ { "name": "Ana", "isAi": false },
 *                    { "name": "Expert", "isAi": true, "aiLevel": "expert" } ]
 *     },
 *     "offline": {            // what the on-device base would have replied
 *       "matched": true,      // false means the base had nothing
 *       "text": "Open Environment and choose Your Room. ..."
 *     }
 *   }
 *
 * Response 200 application/json
 *
 *   {
 *     "answer": "Open Environment and choose Your Room...",  // required
 *     "suggestions": ["What environments are there?"],       // optional, <= 3
 *     "highlight": "environment-picker",                     // optional
 *     "model": "claude-sonnet-5"                             // optional, logs only
 *   }
 *
 * Anything else — any non-2xx, any body without a non-empty string `answer`,
 * anything slower than 6 seconds — is treated as unavailable and the client
 * uses its offline answer instead. The endpoint should therefore fail fast and
 * never retry internally.
 *
 * SERVER NOTES
 *
 * The intended backend is the Anthropic API with model id `claude-sonnet-5`,
 * which is quick enough to answer inside a headset without the player feeling
 * they are waiting.
 *
 *   - THE API KEY LIVES ONLY ON THE SERVER (`ANTHROPIC_API_KEY` in the server
 *     environment). It must never appear in this bundle, in a `VITE_` variable,
 *     or in any request this file makes. The client sends a question; it never
 *     sends credentials.
 *   - Set `thinking: { type: "disabled" }` explicitly. Claude Sonnet 5 runs
 *     adaptive thinking when the field is omitted, which costs latency this
 *     use case cannot spend, and `output_config: { effort: "low" }` is right
 *     for short product answers.
 *   - Do not send `temperature`, `top_p` or `top_k`. Claude Sonnet 5 rejects
 *     non-default sampling parameters with a 400; steer tone in the prompt.
 *   - `max_tokens` around 400. Answers longer than a short paragraph are
 *     unreadable on a floating panel.
 *   - Put the product brief and the house voice in the system prompt with
 *     `cache_control: { type: "ephemeral" }`. It is identical on every request,
 *     so it caches; the minimum cacheable prefix on Sonnet 5 is 1024 tokens.
 *   - Ground the model in `offline.text` and tell it to say it does not know
 *     rather than invent a feature. An invented setting is worse than no answer
 *     when a customer is standing next to the headset.
 *
 * Sketch (Node, `@anthropic-ai/sdk` — a server dependency, not a client one):
 *
 *   const msg = await anthropic.messages.create({
 *     model: "claude-sonnet-5",
 *     max_tokens: 400,
 *     thinking: { type: "disabled" },
 *     output_config: { effort: "low" },
 *     system: [{ type: "text", text: PRODUCT_BRIEF,
 *                cache_control: { type: "ephemeral" } }],
 *     messages: [{ role: "user", content: buildPrompt(body) }],
 *   });
 *   res.json({ answer: textOf(msg), model: "claude-sonnet-5" });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AiLevel, EditionId } from "../../shared/editions.ts";
import type { GameMode } from "../../shared/game.ts";
import type { Assistant, AssistantAnswer, AssistantContext } from "../contracts.ts";
import { TOUR_STEPS, answerOffline, suggestionsForScreen } from "./knowledge.ts";

// ── Wire types ──────────────────────────────────────────────────────────────

export const ASSISTANT_PROTOCOL = 1;
export const DEFAULT_ASSISTANT_ENDPOINT = "/api/assistant";
export const DEFAULT_ASSISTANT_TIMEOUT_MS = 6000;

/** The compact summary of the app's state that travels with a question. */
export interface AssistantContextSummary {
  edition: EditionId;
  screen: string;
  inGame: boolean;
  settings: {
    pairs: number;
    mode: GameMode;
    environmentId: string;
    turnSeconds: number;
  };
  players: { name: string; isAi: boolean; aiLevel?: AiLevel }[];
}

export interface AssistantRequestBody {
  v: number;
  question: string;
  context: AssistantContextSummary;
  offline: { matched: boolean; text: string };
}

export interface AssistantResponseBody {
  answer: string;
  suggestions?: string[];
  highlight?: string;
  model?: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface AssistantOptions {
  /** Overrides `VITE_ASSISTANT_URL` and the `/api/assistant` default. */
  endpoint?: string;
  /** Abandon the live call after this long. Default 6000ms. */
  timeoutMs?: number;
  /** Injected for tests and for hosts with a custom transport. */
  fetch?: typeof fetch;
  /** Hard-disables the live path regardless of edition. For kiosk builds. */
  offlineOnly?: boolean;
  /** Diagnostics only. Never rendered — the player sees the offline answer. */
  onLiveError?: (error: unknown) => void;
}

const MAX_QUESTION_CHARS = 500;
const MAX_ANSWER_CHARS = 4000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function envEndpoint(): string | undefined {
  try {
    const env = import.meta.env as unknown as Record<string, string | undefined> | undefined;
    const raw = env?.VITE_ASSISTANT_URL;
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  } catch {
    // Not running under Vite (a test runner, or a server-side render).
    return undefined;
  }
}

export function resolveEndpoint(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  return envEndpoint() ?? DEFAULT_ASSISTANT_ENDPOINT;
}

function summarise(ctx: AssistantContext): AssistantContextSummary {
  return {
    edition: ctx.edition.id,
    screen: ctx.screen,
    inGame: ctx.inGame,
    settings: {
      pairs: ctx.settings.pairs,
      mode: ctx.settings.mode,
      environmentId: ctx.settings.environmentId,
      turnSeconds: ctx.settings.turnSeconds,
    },
    // Names only, capped. There is no reason to ship a whole scoreboard to a
    // language model, and every reason not to ship more than we have to.
    players: ctx.players.slice(0, 8).map((p) => {
      const view: { name: string; isAi: boolean; aiLevel?: AiLevel } = { name: p.name, isAi: p.isAi };
      if (p.aiLevel) view.aiLevel = p.aiLevel;
      return view;
    }),
  };
}

/** Trims runs of blank lines the model may emit; leaves the wording alone. */
function tidy(text: string): string {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function readResponse(payload: unknown): AssistantResponseBody | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Partial<AssistantResponseBody>;
  if (typeof body.answer !== "string") return null;

  const answer = tidy(body.answer).slice(0, MAX_ANSWER_CHARS);
  if (answer.length === 0) return null;

  const out: AssistantResponseBody = { answer };
  if (Array.isArray(body.suggestions)) {
    const suggestions = body.suggestions
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 80))
      .slice(0, 3);
    if (suggestions.length > 0) out.suggestions = suggestions;
  }
  if (typeof body.highlight === "string" && body.highlight.trim().length > 0) {
    out.highlight = body.highlight.trim();
  }
  return out;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createAssistant(opts: AssistantOptions = {}): Assistant {
  const endpoint = resolveEndpoint(opts.endpoint);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASSISTANT_TIMEOUT_MS;
  const doFetch = opts.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);

  function liveAvailable(ctx: AssistantContext): boolean {
    if (opts.offlineOnly) return false;
    if (!ctx.edition.features.assistantLiveModel) return false;
    if (!doFetch) return false;
    return endpoint.length > 0;
  }

  async function askLive(
    question: string,
    ctx: AssistantContext,
    offline: { matched: boolean; text: string },
  ): Promise<AssistantResponseBody | null> {
    if (!doFetch) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body: AssistantRequestBody = {
        v: ASSISTANT_PROTOCOL,
        question,
        context: summarise(ctx),
        offline,
      };
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        // No cookies, no credentials. The endpoint holds the API key; this
        // request carries nothing that identifies a player.
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) return null;
      return readResponse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ask(question: string, ctx: AssistantContext): Promise<AssistantAnswer> {
      const asked = (question ?? "").trim().slice(0, MAX_QUESTION_CHARS);

      // The offline answer is computed first, always. It is the reply when the
      // live path is off, and the safety net when it fails.
      let offline: ReturnType<typeof answerOffline>;
      try {
        offline = answerOffline(asked, ctx);
      } catch {
        offline = {
          text: "I could not put that answer together. Try one of the questions below.",
          suggestions: [...suggestionsForScreen(ctx.screen)],
          matched: false,
        };
      }

      const fallback: AssistantAnswer = { text: offline.text, source: "offline" };
      if (offline.suggestions.length > 0) fallback.suggestions = offline.suggestions;
      if (offline.highlight) fallback.highlight = offline.highlight;

      if (asked.length === 0 || !liveAvailable(ctx)) return fallback;

      try {
        const live = await askLive(asked, ctx, { matched: offline.matched, text: offline.text });
        if (!live) return fallback;

        const answer: AssistantAnswer = { text: live.answer, source: "model" };
        // Keep the offline follow-ups when the model does not supply its own,
        // so the chips under the answer never blink out mid-conversation.
        const suggestions = live.suggestions ?? offline.suggestions;
        if (suggestions.length > 0) answer.suggestions = suggestions;
        const highlight = live.highlight ?? offline.highlight;
        if (highlight) answer.highlight = highlight;
        return answer;
      } catch (error) {
        opts.onLiveError?.(error);
        return fallback;
      }
    },

    tour() {
      return TOUR_STEPS;
    },

    suggestionsFor(screen: string) {
      return suggestionsForScreen(screen);
    },
  };
}
