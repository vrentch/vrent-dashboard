/**
 * The forgetting model the AI opponents share.
 *
 * A perfect-recall bot is trivial to write and no fun at all to play: it clears
 * a 24-pair board without a single mistake and every visitor walks away from
 * the demo. So the opponents do not store the board — they store *traces*, and
 * every trace fades.
 *
 * Three ideas, all of them borrowed from how people actually play:
 *
 *   Decay        A trace loses strength with every card anyone turns over.
 *                Interference, not wall-clock time, is what erases a memory in
 *                this game, so the clock ticks once per observation.
 *
 *   Reinforcement Seeing a card again pushes its trace back towards certain.
 *                The second look is always worth more than the first.
 *
 *   Confusion    A half-remembered card is not simply forgotten. Very often it
 *                is remembered in the wrong place — one tile left, or the row
 *                below. That single behaviour is what makes an opponent read as
 *                a person rather than a dice roll, so it is modelled directly.
 *
 * Recall is probabilistic against trace strength, which means the same board
 * played twice produces different mistakes — unless the caller supplies a seed,
 * in which case everything here is reproducible for a scripted demo.
 *
 * No DOM, no timers, no game rules. This file is pure state plus a random
 * number generator, so it can be unit tested and replayed.
 */

import type { AiLevel } from "../../shared/editions.ts";

// ── Tuning ──────────────────────────────────────────────────────────────────

export interface MemoryTuning {
  /** Roughly how many cards stay comfortably recallable at once. */
  capacity: number;
  /** Share of a trace's strength lost per intervening observation, 0-1. */
  decay: number;
  /** How much a fresh look restores, 0-1. Higher means a sharper first glance. */
  reinforce: number;
  /** Chance a half-remembered card is placed on a neighbouring tile instead. */
  confusion: number;
  /** Below this strength a card is "I have seen that somewhere" and no more. */
  floor: number;
  /** Extra decay applied to traces ranked past `capacity`. Models crowding. */
  crowding: number;
  /** Attention multiplier applied to the recall roll. 1 is neutral. */
  focus: number;
}

/**
 * Per-level calibration. These numbers are the difficulty dial — they were
 * tuned by playing, not derived, and they are the first thing to touch if a
 * level feels wrong on a customer's board size.
 */
export const MEMORY_PROFILES: Record<AiLevel, MemoryTuning> = {
  easy: {
    capacity: 3,
    decay: 0.22,
    reinforce: 0.7,
    confusion: 0.4,
    floor: 0.06,
    crowding: 0.35,
    focus: 0.95,
  },
  medium: {
    capacity: 8,
    decay: 0.085,
    reinforce: 0.9,
    confusion: 0.2,
    floor: 0.05,
    crowding: 0.2,
    focus: 1,
  },
  expert: {
    capacity: 20,
    decay: 0.012,
    reinforce: 0.98,
    confusion: 0.05,
    floor: 0.04,
    crowding: 0.28,
    focus: 1.15,
  },
};

// ── Traces ──────────────────────────────────────────────────────────────────

export interface MemoryTrace {
  index: number;
  /** The symbol this card showed when it was last seen. */
  symbol: number;
  /** 0-1. Drives the recall roll. */
  strength: number;
  /** Observation clock value at the last sighting. */
  seenAt: number;
  /** How many times this card has been observed. */
  looks: number;
}

/** What the opponent believes, which is not always what is true. */
export interface Recollection {
  /** Where the AI thinks the card is. Wrong when `confused` is set. */
  index: number;
  /** The symbol it is reaching for. */
  symbol: number;
  /** Trace strength at the moment of the roll, 0-1. */
  strength: number;
  /** The position was misremembered as a neighbouring tile. */
  confused: boolean;
}

/** Restricts recall to cards that are still legally playable. */
export type CardFilter = (index: number) => boolean;

export interface CardMemory {
  readonly tuning: Readonly<MemoryTuning>;

  /** Board geometry, used to pick a plausible neighbour when confused. */
  setLayout(cols: number, rows: number): void;

  /** Takes in one reveal. Advances the observation clock by one step. */
  observe(index: number, symbol: number): void;

  /** Drops traces entirely — for cards that have left the board. */
  forget(indices: readonly number[]): void;

  /** Ages every trace without adding one. Rarely needed; `observe` ages too. */
  age(steps?: number): void;

  /** All traces, strongest first. */
  traces(): readonly MemoryTrace[];

  /** Cards currently strong enough to have a real chance of being recalled. */
  retained(): number;

  /** Every card ever observed and not since removed. */
  seen(): readonly number[];

  /** Seen, then faded past the floor. The "I know I have seen that" pile. */
  faded(): readonly number[];

  /** Rolls recall for one specific card. */
  recall(index: number): Recollection | null;

  /** Rolls recall for the other half of `symbol`, ignoring `exclude`. */
  recallPartner(symbol: number, exclude: number, allowed?: CardFilter): Recollection | null;

  /**
   * Rolls recall for a complete pair, strongest candidate first. `attempts`
   * caps how many candidate pairs it will reach for before giving up, which is
   * what stops a strong memory from being an infallible one.
   */
  recallPair(attempts?: number, allowed?: CardFilter): [Recollection, Recollection] | null;

  /** Wipes everything. */
  reset(): void;
}

// ── Implementation ──────────────────────────────────────────────────────────

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function createCardMemory(tuning: MemoryTuning, rnd: () => number): CardMemory {
  const traces = new Map<number, MemoryTrace>();
  let clock = 0;
  let cols = 0;
  let total = 0;

  /** Tiles a confused recall might land on: left, right, above, below. */
  function neighbours(index: number): number[] {
    if (cols <= 0 || total <= 0) {
      // Layout unknown — a linear guess is still better than none.
      return [index - 1, index + 1].filter((i) => i >= 0);
    }
    const col = index % cols;
    const out: number[] = [];
    if (col > 0) out.push(index - 1);
    if (col < cols - 1 && index + 1 < total) out.push(index + 1);
    if (index - cols >= 0) out.push(index - cols);
    if (index + cols < total) out.push(index + cols);
    return out;
  }

  function sorted(): MemoryTrace[] {
    return [...traces.values()].sort((a, b) => b.strength - a.strength || b.seenAt - a.seenAt);
  }

  function age(steps = 1): void {
    if (steps <= 0 || traces.size === 0) return;
    const keep = Math.pow(1 - tuning.decay, steps);
    const crowded = Math.pow(1 - Math.min(0.95, tuning.decay + tuning.crowding), steps);

    // Rank first: everything past capacity decays faster, which is what gives
    // each level a felt ceiling rather than an infinitely long tail.
    const ranked = sorted();
    for (let i = 0; i < ranked.length; i++) {
      const trace = ranked[i];
      trace.strength *= i < tuning.capacity ? keep : crowded;
      // Traces are kept below the floor on purpose: "I have seen that card
      // before but I could not tell you where" is a real and useful state.
      if (trace.strength < 0.002) trace.strength = 0;
    }
  }

  /** Rolls one recall against a trace. */
  function roll(trace: MemoryTrace): Recollection | null {
    const p = clamp01(trace.strength * tuning.focus);
    const r = rnd();
    if (r < p) {
      return { index: trace.index, symbol: trace.symbol, strength: trace.strength, confused: false };
    }
    // The near-miss band. Wider when the trace is weak, which is exactly when
    // people put a card one tile away from where it really is.
    if (r < p + tuning.confusion * (1 - p)) {
      const options = neighbours(trace.index);
      if (options.length > 0) {
        const pick = options[Math.floor(rnd() * options.length)];
        return { index: pick, symbol: trace.symbol, strength: trace.strength, confused: true };
      }
    }
    return null;
  }

  return {
    tuning,

    setLayout(nextCols: number, nextRows: number): void {
      if (nextCols > 0 && nextRows > 0) {
        cols = Math.floor(nextCols);
        total = Math.floor(nextCols) * Math.floor(nextRows);
      }
    },

    observe(index: number, symbol: number): void {
      age(1);
      clock++;
      const existing = traces.get(index);
      if (existing) {
        existing.symbol = symbol;
        // Asymptotic towards certain: each look closes part of the remaining gap.
        existing.strength = clamp01(existing.strength + (1 - existing.strength) * tuning.reinforce);
        existing.seenAt = clock;
        existing.looks++;
        return;
      }
      traces.set(index, {
        index,
        symbol,
        strength: clamp01(tuning.reinforce),
        seenAt: clock,
        looks: 1,
      });
    },

    forget(indices: readonly number[]): void {
      for (const i of indices) traces.delete(i);
    },

    age,

    traces: sorted,

    retained(): number {
      let n = 0;
      for (const t of traces.values()) if (t.strength >= tuning.floor) n++;
      return n;
    },

    seen(): readonly number[] {
      return [...traces.keys()];
    },

    faded(): readonly number[] {
      const out: number[] = [];
      for (const t of traces.values()) if (t.strength < tuning.floor) out.push(t.index);
      return out;
    },

    recall(index: number): Recollection | null {
      const trace = traces.get(index);
      if (!trace || trace.strength < tuning.floor) return null;
      return roll(trace);
    },

    recallPartner(symbol: number, exclude: number, allowed?: CardFilter): Recollection | null {
      let best: MemoryTrace | null = null;
      for (const t of traces.values()) {
        if (t.index === exclude || t.symbol !== symbol) continue;
        if (t.strength < tuning.floor) continue;
        if (allowed && !allowed(t.index)) continue;
        if (!best || t.strength > best.strength) best = t;
      }
      return best ? roll(best) : null;
    },

    recallPair(attempts = 3, allowed?: CardFilter): [Recollection, Recollection] | null {
      // Candidate pairs: two live traces sharing a symbol, best first.
      const bySymbol = new Map<number, MemoryTrace[]>();
      for (const t of traces.values()) {
        if (t.strength < tuning.floor) continue;
        if (allowed && !allowed(t.index)) continue;
        const bucket = bySymbol.get(t.symbol);
        if (bucket) bucket.push(t);
        else bySymbol.set(t.symbol, [t]);
      }

      const candidates: [MemoryTrace, MemoryTrace][] = [];
      for (const bucket of bySymbol.values()) {
        if (bucket.length < 2) continue;
        bucket.sort((a, b) => b.strength - a.strength);
        candidates.push([bucket[0], bucket[1]]);
      }
      if (candidates.length === 0) return null;

      candidates.sort((a, b) => b[0].strength + b[1].strength - (a[0].strength + a[1].strength));

      // Reach for the pairs it feels surest about, and only a few of them. A
      // player with six pairs in their head does not get six free rolls.
      const tries = Math.max(1, Math.min(attempts, candidates.length));
      for (let i = 0; i < tries; i++) {
        const [a, b] = candidates[i];
        const first = roll(a);
        if (!first) continue;
        const second = roll(b);
        if (!second) continue;
        if (first.index === second.index) continue; // confusion collapsed the pair
        return [first, second];
      }
      return null;
    },

    reset(): void {
      traces.clear();
      clock = 0;
    },
  };
}
