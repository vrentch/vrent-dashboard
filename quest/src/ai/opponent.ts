/**
 * The AI opponents.
 *
 * The goal is a believable opponent, not an unbeatable one. Three levels that
 * feel genuinely different across a two-minute demo:
 *
 *   easy    Keeps about three cards in its head, forgets fast, regularly turns
 *           over something it has already seen, and now and then re-tries a
 *           pair it has already proved wrong. A child beats it.
 *   medium  Holds about eight cards, usually cashes in a pair it knows, and
 *           misses roughly a quarter of the time. An attentive adult.
 *   expert  Holds about twenty with slow decay and plays close to optimally:
 *           with no known pair it opens on an *unseen* card to buy information,
 *           and if that reveals a partner it knows, it takes it. It still fails
 *           about seven percent of the time, because a machine that never slips
 *           stops reading as an opponent and starts reading as a script.
 *
 * All three share one forgetting model (`memory.ts`); the level is the tuning
 * plus a small behaviour profile. Deliberation time is sampled per decision —
 * a constant think-time is the single biggest tell that a seat is a bot.
 *
 * Everything is driven by one seeded generator, so passing a `seed` makes a
 * whole match reproducible for a scripted sales demo.
 *
 * The opponent never reads a face-down card. It takes in reveals through
 * `observe`, and reconciles against the public parts of `MatchState` (which
 * card is face-up, which is matched) so it still behaves correctly if the host
 * misses a call. Symbols are only ever read from cards that are face-up, which
 * is information every player in the room already has.
 */

import type { AiLevel } from "../../shared/editions.ts";
import type { MatchState } from "../../shared/game.ts";
import { mulberry32, presetForPairs, randomSeed } from "../../shared/game.ts";
import type { AiOpponent } from "../contracts.ts";
import type { CardMemory } from "./memory.ts";
import { MEMORY_PROFILES, createCardMemory } from "./memory.ts";

// ── Level profiles ──────────────────────────────────────────────────────────

export interface AiProfile {
  level: AiLevel;
  /** Name shown on the seat chip and in the lobby picker. */
  name: string;
  /** One line of player-facing copy. The assistant quotes this verbatim. */
  blurb: string;
  /** Deliberation window in milliseconds, sampled per decision. */
  thinkMs: readonly [number, number];
  /** Chance it walks away from a pair it actually remembers, 0-1. */
  slip: number;
  /** Chance it reaches for a card it has seen and since forgotten, 0-1. */
  revisit: number;
  /** Chance it opens on an unseen card when it has nothing better, 0-1. */
  explore: number;
  /** How many remembered pairs it will reach for before giving up on the turn. */
  pairAttempts: number;
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  easy: {
    level: "easy",
    name: "Easy",
    blurb: "Forgets quickly and turns over the same card twice. A good first game.",
    thinkMs: [1400, 2600],
    slip: 0.45,
    revisit: 0.4,
    explore: 0.35,
    pairAttempts: 1,
  },
  medium: {
    level: "medium",
    name: "Medium",
    blurb: "Remembers most of what it has seen and takes a pair when it has one.",
    thinkMs: [1000, 2000],
    slip: 0.22,
    revisit: 0.15,
    explore: 0.75,
    pairAttempts: 3,
  },
  expert: {
    level: "expert",
    name: "Expert",
    blurb: "Near-perfect recall and opens on fresh cards to learn the board.",
    thinkMs: [600, 1400],
    slip: 0.07,
    revisit: 0,
    explore: 1,
    pairAttempts: 3,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("Aborted", "AbortError");
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/** Resolves after `ms`, or rejects the moment the caller abandons the turn. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type Tempo = "confident" | "considered" | "hesitant";

interface Decision {
  index: number;
  tempo: Tempo;
  /** Set when the AI has already decided what its second card will be. */
  plan?: { first: number; second: number };
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Builds one opponent. Pass a `seed` to make its play reproducible; omit it and
 * every match is different.
 *
 * `chooseFlip` rejects with an `AbortError` if the signal fires mid-think, and
 * rejects if the board has no legal card left — it will never resolve with an
 * index that is matched or already face-up.
 */
export function createAiOpponent(playerId: string, level: AiLevel, seed?: number): AiOpponent {
  const profile = AI_PROFILES[level] ?? AI_PROFILES.medium;
  const baseSeed = seed ?? randomSeed();

  let rnd = mulberry32(baseSeed);
  let memory: CardMemory = createCardMemory(MEMORY_PROFILES[profile.level], () => rnd());

  /** Reveals already taken in, so a repeated sync does not re-age the memory. */
  let ingested = new Map<number, number>();
  let plan: { first: number; second: number } | null = null;
  let decisions = 0;

  function ingest(index: number, symbol: number): void {
    if (ingested.get(index) === symbol) return;
    ingested.set(index, symbol);
    memory.observe(index, symbol);
  }

  /**
   * Reconciles with the board. Matched cards leave memory, face-down cards
   * become re-observable, and any face-up card the host did not report is
   * picked up here. Face-down symbols are never touched.
   */
  function sync(state: MatchState): void {
    const preset = presetForPairs(state.settings.pairs);
    memory.setLayout(preset.cols, preset.rows);

    const gone: number[] = [];
    for (const card of state.cards) {
      if (card.matched) {
        gone.push(card.index);
        ingested.delete(card.index);
      } else if (!card.faceUp) {
        ingested.delete(card.index);
      } else {
        ingest(card.index, card.symbol);
      }
    }
    if (gone.length > 0) memory.forget(gone);
  }

  /** Samples a deliberation time inside this level's advertised window. */
  function thinkTime(tempo: Tempo): number {
    const [lo, hi] = profile.thinkMs;
    // Bias within the range rather than outside it: quick when it is sure,
    // slower when it is stalling, anywhere at all when it is just looking.
    const t =
      tempo === "confident"
        ? rnd() * 0.55
        : tempo === "hesitant"
          ? 0.45 + rnd() * 0.55
          : rnd();
    const jitter = 1 + (rnd() - 0.5) * 0.08;
    const first = decisions === 0 ? 220 : 0;
    const ms = (lo + t * (hi - lo)) * jitter + first;
    return Math.round(Math.min(hi + 260, Math.max(lo * 0.9, ms)));
  }

  function pick(from: readonly number[]): number {
    return from[Math.floor(rnd() * from.length)];
  }

  /**
   * The no-known-pair move. Expert always buys information with a fresh card;
   * medium usually does; easy mostly wanders, and often lands on something it
   * has already been shown and lost.
   */
  function explore(legal: readonly number[], exclude: number): number {
    const options = legal.filter((i) => i !== exclude);
    if (options.length === 0) return legal[0];

    const known = new Set(memory.seen());
    const unseen = options.filter((i) => !known.has(i));
    const faded = memory.faded().filter((i) => options.includes(i));

    if (profile.revisit > 0 && faded.length > 0 && rnd() < profile.revisit) {
      return pick(faded);
    }
    if (unseen.length > 0 && rnd() < profile.explore) {
      return pick(unseen);
    }
    if (unseen.length === 0 && profile.level === "expert") {
      // Board fully seen: go for whatever the trace is weakest on. Refreshing
      // the shakiest card is the highest-value look left.
      const weakest = memory
        .traces()
        .filter((t) => options.includes(t.index))
        .sort((a, b) => a.strength - b.strength)[0];
      if (weakest) return weakest.index;
    }
    return pick(options);
  }

  function decide(state: MatchState, legal: readonly number[]): Decision {
    const legalSet = new Set(legal);
    const allowed = (i: number): boolean => legalSet.has(i);
    const open = state.selection.length === 1 ? state.selection[0] : -1;

    // ── Second card of the turn ──────────────────────────────────────────
    if (open >= 0) {
      const card = state.cards[open];

      // Committed to a pair on the first flip: follow through. A player who has
      // decided on two cards does not talk themselves out of it halfway.
      if (plan && plan.first === open && allowed(plan.second)) {
        return { index: plan.second, tempo: "confident" };
      }

      if (card) {
        const partner = memory.recallPartner(card.symbol, open, allowed);
        if (partner && allowed(partner.index) && rnd() >= profile.slip) {
          return { index: partner.index, tempo: partner.confused ? "considered" : "confident" };
        }
      }
      return { index: explore(legal, open), tempo: "hesitant" };
    }

    // ── First card of the turn ───────────────────────────────────────────
    plan = null;

    // The classic blunder: two cards it was shown and has since lost. It reads
    // as "did we not just do those?" from the other side of the table.
    if (profile.revisit > 0 && rnd() < profile.revisit) {
      const faded = memory.faded().filter(allowed);
      if (faded.length >= 2) {
        const a = pick(faded);
        const rest = faded.filter((i) => i !== a);
        const b = pick(rest);
        return { index: a, tempo: "hesitant", plan: { first: a, second: b } };
      }
    }

    const pair = memory.recallPair(profile.pairAttempts, allowed);
    if (pair && rnd() >= profile.slip) {
      const [a, b] = pair;
      if (allowed(a.index) && allowed(b.index) && a.index !== b.index) {
        return {
          index: a.index,
          tempo: a.confused || b.confused ? "considered" : "confident",
          plan: { first: a.index, second: b.index },
        };
      }
    }

    return { index: explore(legal, -1), tempo: "considered" };
  }

  return {
    playerId,
    level: profile.level,

    observe(index: number, symbol: number): void {
      ingest(index, symbol);
    },

    forget(indices: readonly number[]): void {
      // Deliberately does not wipe traces. This fires both when a pair is
      // claimed and, in some hosts, when a missed pair turns back over — and
      // nobody forgets a card just because it flipped face-down. Cards that
      // have genuinely left the board are dropped in `sync`, from the state
      // itself, which cannot be got wrong.
      for (const i of indices) ingested.delete(i);
    },

    async chooseFlip(state: MatchState, signal: AbortSignal): Promise<number> {
      if (signal.aborted) throw abortError();

      sync(state);
      const legal = state.cards.filter((c) => !c.matched && !c.faceUp).map((c) => c.index);
      if (legal.length === 0) throw new Error(`${playerId}: no legal card to flip`);

      const decision = decide(state, legal);
      plan = decision.plan ?? plan;
      const delay = thinkTime(decision.tempo);
      decisions++;

      await wait(delay, signal);

      // Time Attack lets everyone flip at once, so the board can move while the
      // AI is thinking. Re-check before committing rather than sending an
      // illegal flip the server would reject.
      const chosen = state.cards[decision.index];
      if (chosen && !chosen.matched && !chosen.faceUp) return decision.index;

      const stillLegal = state.cards.filter((c) => !c.matched && !c.faceUp).map((c) => c.index);
      if (stillLegal.length === 0) throw new Error(`${playerId}: no legal card to flip`);
      plan = null;
      return pick(stillLegal);
    },

    reset(): void {
      rnd = mulberry32(baseSeed);
      memory = createCardMemory(MEMORY_PROFILES[profile.level], () => rnd());
      ingested = new Map();
      plan = null;
      decisions = 0;
    },
  };
}
