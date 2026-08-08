/**
 * Server-side AI turn driver.
 *
 * The host can drop AI opponents into an online room; they are ordinary seats
 * in the authoritative match, and their flips go through exactly the same
 * validation path as a human's. Nothing here knows about sockets.
 *
 * ── Where the real brain lives ──────────────────────────────────────────────
 * The intended implementation of the AI is `src/ai/opponent.ts`, which
 * implements the `AiOpponent` interface from `src/contracts.ts`. That module is
 * owned by another part of the project and is deliberately NOT imported here:
 * the server must boot and play a full game with no browser-side code present.
 *
 * Instead this file declares `AiBrain` — a narrow, structurally compatible
 * subset of `AiOpponent` (observe / forget / chooseFlip / reset) — plus a
 * modest built-in fallback policy. Inject the real one at boot:
 *
 *   import { createAiOpponent } from "../src/ai/opponent.ts";
 *   setAiFactory((playerId, level) => createAiOpponent(playerId, level));
 *
 * An `AiOpponent` satisfies `AiBrain` structurally, so no adapter is needed.
 */

import type { AiLevel } from "../shared/editions.ts";
import type { Card, MatchState } from "../shared/game.ts";

// ── The narrow interface the runner drives ──────────────────────────────────

/** Structural subset of `AiOpponent` (src/contracts.ts). */
export interface AiBrain {
  /** Called for every reveal the AI can see, so it can build its memory. */
  observe(index: number, symbol: number): void;
  /** Called when cards leave the board for good (a matched pair). */
  forget(indices: readonly number[]): void;
  /** Resolves with a card index after a deliberate, human-looking delay. */
  chooseFlip(state: MatchState, signal: AbortSignal): Promise<number>;
  reset(): void;
}

export type AiFactory = (playerId: string, level: AiLevel) => AiBrain;

let injectedFactory: AiFactory | null = null;

/**
 * Injects the real AI brain. Pass `null` to fall back to the built-in policy.
 * Call once at boot, before any room is created.
 */
export function setAiFactory(factory: AiFactory | null): void {
  injectedFactory = factory;
}

export function getAiFactory(): AiFactory | null {
  return injectedFactory;
}

/** Builds a brain: the injected one if present, otherwise the fallback. */
export function createBrain(playerId: string, level: AiLevel): AiBrain {
  if (injectedFactory) {
    try {
      const brain = injectedFactory(playerId, level);
      if (isBrain(brain)) return brain;
    } catch {
      // A broken injection must never stop a paying customer's game.
    }
  }
  return createFallbackBrain(level);
}

function isBrain(v: unknown): v is AiBrain {
  if (!v || typeof v !== "object") return false;
  const b = v as Partial<AiBrain>;
  return (
    typeof b.observe === "function" &&
    typeof b.forget === "function" &&
    typeof b.chooseFlip === "function" &&
    typeof b.reset === "function"
  );
}

// ── Runner ──────────────────────────────────────────────────────────────────

export interface AiRunnerHost {
  /** The live authoritative state. Read only — never mutated by the runner. */
  state(): MatchState;
  /**
   * Submits a flip on the AI's behalf through the room's normal validated
   * path. Returns true if the flip was accepted.
   */
  flip(playerId: string, index: number): boolean;
  log(level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void;
}

export interface AiRunner {
  add(playerId: string, level: AiLevel): void;
  remove(playerId: string): void;
  has(playerId: string): boolean;
  size(): number;
  /** Every reveal on the board, so all brains can build memory. */
  observe(index: number, symbol: number): void;
  /** Cards that left the board (matched). */
  forget(indices: readonly number[]): void;
  /** New match — wipe every brain's memory. */
  reset(): void;
  /** Re-evaluates whose turn it is and schedules a move if it is an AI's. */
  poke(): void;
  dispose(): void;
}

/** A brain that hangs is a hung room; cut it off and pick something sane. */
const CHOOSE_TIMEOUT_MS = 8000;

/** Small gap after a state change before an AI acts, so animations land. */
const REACT_DELAY_MS = 260;

export function createAiRunner(host: AiRunnerHost): AiRunner {
  interface Seat {
    playerId: string;
    level: AiLevel;
    brain: AiBrain;
    lastMoveAt: number;
  }

  const seats = new Map<string, Seat>();
  let pending: { playerId: string; controller: AbortController } | null = null;
  let pokeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function cancelPending(reason: string): void {
    if (!pending) return;
    const { playerId, controller } = pending;
    pending = null;
    try {
      controller.abort(reason);
    } catch {
      /* AbortController.abort never throws in practice; belt and braces. */
    }
    host.log("debug", "ai.cancel", { player: playerId, reason });
  }

  /** Who, if anyone, should the runner move for right now. */
  function actor(state: MatchState): Seat | null {
    if (state.phase !== "playing") return null;
    if (seats.size === 0) return null;

    if (state.settings.mode === "timeattack") {
      // Time Attack is a free-for-all over one shared selection. Only step in
      // between pairs so an AI never hijacks the second half of a human's turn.
      if (state.selection.length !== 0) return null;
      let best: Seat | null = null;
      for (const seat of seats.values()) {
        const p = state.players.find((x) => x.id === seat.playerId);
        if (!p || p.out) continue;
        if (!best || seat.lastMoveAt < best.lastMoveAt) best = seat;
      }
      return best;
    }

    const current = state.players[state.turn];
    if (!current || current.out) return null;
    return seats.get(current.id) ?? null;
  }

  function poke(): void {
    if (disposed) return;
    if (pokeTimer) return;
    pokeTimer = setTimeout(() => {
      pokeTimer = null;
      void evaluate();
    }, REACT_DELAY_MS);
    if (typeof pokeTimer.unref === "function") pokeTimer.unref();
  }

  async function evaluate(): Promise<void> {
    if (disposed) return;
    const state = host.state();
    const seat = actor(state);

    if (!seat) {
      cancelPending("not-ai-turn");
      return;
    }
    if (pending) {
      // Already thinking. If the turn moved to a different AI, restart.
      if (pending.playerId === seat.playerId) return;
      cancelPending("turn-moved");
    }

    const controller = new AbortController();
    pending = { playerId: seat.playerId, controller };

    let index = -1;
    try {
      index = await withTimeout(seat.brain.chooseFlip(state, controller.signal), CHOOSE_TIMEOUT_MS, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        host.log("warn", "ai.choose-failed", {
          player: seat.playerId,
          level: seat.level,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      index = -1;
    }

    if (disposed || controller.signal.aborted) return;
    if (pending?.controller !== controller) return;
    pending = null;

    const now = host.state();
    // The world may have moved on while the brain was thinking.
    if (now.phase !== "playing") return;
    if (!actorStillValid(now, seat.playerId)) {
      poke();
      return;
    }

    if (!playable(now.cards[index])) {
      // Injected brain returned something unusable — fall back rather than
      // stalling the room.
      const fallback = firstPlayable(now.cards);
      if (fallback < 0) return;
      host.log("debug", "ai.fallback-pick", { player: seat.playerId, wanted: index, used: fallback });
      index = fallback;
    }

    seat.lastMoveAt = Date.now();
    const accepted = host.flip(seat.playerId, index);
    if (!accepted) {
      host.log("debug", "ai.flip-rejected", { player: seat.playerId, index });
      poke();
    }
  }

  function actorStillValid(state: MatchState, playerId: string): boolean {
    const seat = seats.get(playerId);
    if (!seat) return false;
    const p = state.players.find((x) => x.id === playerId);
    if (!p || p.out) return false;
    if (state.settings.mode === "timeattack") return state.selection.length < 2;
    return state.players[state.turn]?.id === playerId;
  }

  return {
    add(playerId: string, level: AiLevel): void {
      if (disposed || seats.has(playerId)) return;
      seats.set(playerId, { playerId, level, brain: createBrain(playerId, level), lastMoveAt: 0 });
      host.log("info", "ai.added", { player: playerId, level, injected: injectedFactory !== null });
    },

    remove(playerId: string): void {
      if (!seats.delete(playerId)) return;
      if (pending?.playerId === playerId) cancelPending("removed");
      host.log("info", "ai.removed", { player: playerId });
    },

    has(playerId: string): boolean {
      return seats.has(playerId);
    },

    size(): number {
      return seats.size;
    },

    observe(index: number, symbol: number): void {
      for (const seat of seats.values()) {
        try {
          seat.brain.observe(index, symbol);
        } catch (err) {
          host.log("warn", "ai.observe-failed", { player: seat.playerId, error: describe(err) });
        }
      }
    },

    forget(indices: readonly number[]): void {
      for (const seat of seats.values()) {
        try {
          seat.brain.forget(indices);
        } catch (err) {
          host.log("warn", "ai.forget-failed", { player: seat.playerId, error: describe(err) });
        }
      }
    },

    reset(): void {
      cancelPending("reset");
      for (const seat of seats.values()) {
        seat.lastMoveAt = 0;
        try {
          seat.brain.reset();
        } catch (err) {
          host.log("warn", "ai.reset-failed", { player: seat.playerId, error: describe(err) });
        }
      }
    },

    poke,

    dispose(): void {
      disposed = true;
      cancelPending("dispose");
      if (pokeTimer) {
        clearTimeout(pokeTimer);
        pokeTimer = null;
      }
      seats.clear();
    },
  };
}

// ── Built-in fallback policy ────────────────────────────────────────────────

/**
 * A deliberately modest opponent: it remembers what it has seen, imperfectly,
 * and takes a human-looking pause before moving. It exists so an online room
 * with AI seats is playable even when no brain has been injected — the real
 * personality lives in `src/ai/opponent.ts`.
 */
interface LevelProfile {
  /** Probability a revealed card is committed to memory. */
  recall: number;
  /** How many cards it can hold at once (older ones fade). */
  capacity: number;
  /** Probability it ignores a known pair and explores instead. */
  slip: number;
  /** Thinking time range in ms. */
  thinkMin: number;
  thinkMax: number;
}

const PROFILES: Record<AiLevel, LevelProfile> = {
  easy: { recall: 0.45, capacity: 6, slip: 0.3, thinkMin: 1100, thinkMax: 2000 },
  medium: { recall: 0.75, capacity: 12, slip: 0.12, thinkMin: 800, thinkMax: 1500 },
  expert: { recall: 0.97, capacity: 48, slip: 0.02, thinkMin: 520, thinkMax: 950 },
};

export function createFallbackBrain(level: AiLevel): AiBrain {
  const profile = PROFILES[level] ?? PROFILES.medium;
  /** index → symbol, insertion-ordered so the oldest memory fades first. */
  let memory = new Map<number, number>();

  function remember(index: number, symbol: number): void {
    if (Math.random() > profile.recall) return;
    memory.delete(index);
    memory.set(index, symbol);
    while (memory.size > profile.capacity) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  }

  /** A remembered, still-playable index holding `symbol`, excluding `skip`. */
  function recallIndex(cards: readonly Card[], symbol: number, skip: number): number {
    for (const [index, sym] of memory) {
      if (sym !== symbol || index === skip) continue;
      if (playable(cards[index])) return index;
    }
    return -1;
  }

  return {
    observe(index: number, symbol: number): void {
      remember(index, symbol);
    },

    forget(indices: readonly number[]): void {
      for (const i of indices) memory.delete(i);
    },

    reset(): void {
      memory = new Map();
    },

    async chooseFlip(state: MatchState, signal: AbortSignal): Promise<number> {
      const think = profile.thinkMin + Math.random() * (profile.thinkMax - profile.thinkMin);
      await sleep(think, signal);

      const cards = state.cards;
      // Cards already turned over this turn and still awaiting resolution.
      const open = state.selection.filter((i) => cards[i]?.faceUp && !cards[i].matched);

      // Second card of a turn: try to complete the pair from memory only —
      // never by peeking at `state.cards[i].symbol`, which would be cheating.
      if (open.length === 1) {
        const firstIndex = open[0];
        const known = memory.get(firstIndex);
        if (known !== undefined && Math.random() > profile.slip) {
          const partner = recallIndex(cards, known, firstIndex);
          if (partner >= 0) return partner;
        }
        return randomUnknown(cards, memory);
      }

      // First card: if a full pair is remembered, open it.
      if (Math.random() > profile.slip) {
        const bySymbol = new Map<number, number>();
        for (const [index, sym] of memory) {
          if (!playable(cards[index])) continue;
          const seen = bySymbol.get(sym);
          if (seen !== undefined) return seen;
          bySymbol.set(sym, index);
        }
      }
      return randomUnknown(cards, memory);
    },
  };
}

/** Prefers a card it has never seen — that is how a human explores. */
function randomUnknown(cards: readonly Card[], memory: ReadonlyMap<number, number>): number {
  const unknown: number[] = [];
  const any: number[] = [];
  for (const c of cards) {
    if (!playable(c)) continue;
    any.push(c.index);
    if (!memory.has(c.index)) unknown.push(c.index);
  }
  const pool = unknown.length > 0 ? unknown : any;
  if (pool.length === 0) return -1;
  return pool[Math.floor(Math.random() * pool.length)];
}

function playable(card: Card | undefined): boolean {
  return !!card && !card.matched && !card.faceUp;
}

function firstPlayable(cards: readonly Card[]): number {
  for (const c of cards) if (playable(c)) return c.index;
  return -1;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ai timed out after ${ms}ms`)), ms);
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    function onAbort(): void {
      done(() => reject(new Error("aborted")));
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => done(() => resolve(v)),
      (e) => done(() => reject(e)),
    );
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
