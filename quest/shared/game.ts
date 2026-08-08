/**
 * Pure game rules — no Three.js, no DOM, no sockets.
 *
 * The same functions run in the browser (solo and AI games) and on the
 * multiplayer server (authoritative games), which is the only way to guarantee
 * a client and the server never disagree about who scored.
 */

// ── Deterministic RNG ───────────────────────────────────────────────────────
// Seeded so a replay, a rejoining player and the server all rebuild an
// identical board from a single integer.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

// ── Board shape ─────────────────────────────────────────────────────────────

export interface BoardPreset {
  pairs: number;
  cols: number;
  rows: number;
  label: string;
}

/**
 * Selectable card counts. Every layout is wider than it is tall because a
 * seated player's comfortable horizontal field of view is far larger than the
 * vertical one — tall boards force neck strain.
 */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  { pairs: 6, cols: 4, rows: 3, label: "12 cards" },
  { pairs: 8, cols: 4, rows: 4, label: "16 cards" },
  { pairs: 10, cols: 5, rows: 4, label: "20 cards" },
  { pairs: 12, cols: 6, rows: 4, label: "24 cards" },
  { pairs: 15, cols: 6, rows: 5, label: "30 cards" },
  { pairs: 18, cols: 6, rows: 6, label: "36 cards" },
  { pairs: 21, cols: 7, rows: 6, label: "42 cards" },
  { pairs: 24, cols: 8, rows: 6, label: "48 cards" },
];

export function presetForPairs(pairs: number): BoardPreset {
  return (
    BOARD_PRESETS.find((p) => p.pairs === pairs) ?? BOARD_PRESETS[BOARD_PRESETS.length - 1]
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

export type GameMode = "classic" | "timeattack" | "sudden";

export interface GameSettings {
  pairs: number;
  mode: GameMode;
  /** Environment id from the environment catalogue. */
  environmentId: string;
  /** Symbol set id from `SYMBOL_SETS`. */
  symbolSetId: string;
  /** Seconds a player has to complete their turn, 0 = untimed. */
  turnSeconds: number;
  /** Milliseconds a mismatched pair stays face-up before flipping back. */
  peekMs: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  pairs: 10,
  mode: "classic",
  environmentId: "neon-vault",
  symbolSetId: "glyphs",
  turnSeconds: 0,
  peekMs: 1100,
};

export const GAME_MODES: readonly { id: GameMode; name: string; blurb: string }[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "Match a pair, take another turn. Most pairs wins.",
  },
  {
    id: "timeattack",
    name: "Time Attack",
    blurb: "Everyone plays at once against the clock. Fastest board wins.",
  },
  {
    id: "sudden",
    name: "Sudden Death",
    blurb: "One miss and you are out. Last player standing takes it.",
  },
];

// ── Cards ───────────────────────────────────────────────────────────────────

export interface Card {
  /** Position in the deck; also the wire identifier for a flip. */
  index: number;
  /** Which pair this card belongs to. Withheld from clients until revealed. */
  symbol: number;
  faceUp: boolean;
  matched: boolean;
  /** Seat index of whoever matched it, for scoreboard colouring. */
  matchedBy: number | null;
}

/** Builds the shuffled board. Same seed and pair count ⇒ same board. */
export function createDeck(seed: number, pairs: number): Card[] {
  const symbols: number[] = [];
  for (let s = 0; s < pairs; s++) symbols.push(s, s);

  // Fisher–Yates with the seeded generator.
  const rnd = mulberry32(seed);
  for (let i = symbols.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
  }

  return symbols.map((symbol, index) => ({
    index,
    symbol,
    faceUp: false,
    matched: false,
    matchedBy: null,
  }));
}

// ── Players ─────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  /** 0-7, drives seat colour and board-side placement. */
  seat: number;
  score: number;
  /** Consecutive matches — drives the streak flourish and bonus. */
  streak: number;
  isAi: boolean;
  aiLevel?: "easy" | "medium" | "expert";
  connected: boolean;
  /** Sudden-death elimination. */
  out: boolean;
}

export function createPlayer(init: Partial<Player> & { id: string; name: string; seat: number }): Player {
  return {
    score: 0,
    streak: 0,
    isAi: false,
    connected: true,
    out: false,
    ...init,
  };
}

// ── Match state machine ─────────────────────────────────────────────────────

export type Phase = "lobby" | "countdown" | "playing" | "finished";

export interface MatchState {
  phase: Phase;
  seed: number;
  settings: GameSettings;
  cards: Card[];
  players: Player[];
  /** Index into `players` whose turn it is. Ignored in Time Attack. */
  turn: number;
  /** Indices currently face-up and awaiting resolution (length 0-2). */
  selection: number[];
  /** Epoch ms when the game began. */
  startedAt: number;
  /** Epoch ms deadline for the current turn, or 0 when untimed. */
  turnDeadline: number;
  /** Total flips, for the accuracy stat. */
  flips: number;
}

export function createMatch(settings: GameSettings, players: Player[], seed = randomSeed()): MatchState {
  return {
    phase: "countdown",
    seed,
    settings,
    cards: createDeck(seed, settings.pairs),
    players,
    turn: 0,
    selection: [],
    startedAt: 0,
    turnDeadline: 0,
    flips: 0,
  };
}

export type FlipOutcome =
  | { kind: "rejected"; reason: string }
  | { kind: "revealed"; index: number; symbol: number }
  | { kind: "matched"; indices: [number, number]; symbol: number; by: number; streak: number }
  | { kind: "missed"; indices: [number, number]; by: number };

/**
 * Applies one flip and reports what happened. Mutates `state`.
 *
 * On a miss the two cards are left face-up — the caller shows them for
 * `settings.peekMs` and then calls `resolveMiss`, which is what makes the game
 * playable rather than a pure memory dump.
 */
export function applyFlip(state: MatchState, playerIndex: number, index: number): FlipOutcome {
  if (state.phase !== "playing") return { kind: "rejected", reason: "not-playing" };

  const card = state.cards[index];
  if (!card) return { kind: "rejected", reason: "no-such-card" };
  if (card.matched || card.faceUp) return { kind: "rejected", reason: "already-up" };
  if (state.selection.length >= 2) return { kind: "rejected", reason: "resolve-pending" };

  const player = state.players[playerIndex];
  if (!player || player.out) return { kind: "rejected", reason: "not-playing" };

  // Time Attack is a free-for-all; every other mode is strictly turn-based.
  if (state.settings.mode !== "timeattack" && state.turn !== playerIndex) {
    return { kind: "rejected", reason: "not-your-turn" };
  }

  card.faceUp = true;
  state.selection.push(index);
  state.flips++;

  if (state.selection.length < 2) {
    return { kind: "revealed", index, symbol: card.symbol };
  }

  const [a, b] = state.selection as [number, number];
  const cardA = state.cards[a];
  const cardB = state.cards[b];

  if (cardA.symbol === cardB.symbol) {
    cardA.matched = cardB.matched = true;
    cardA.matchedBy = cardB.matchedBy = player.seat;
    state.selection = [];
    player.streak++;
    // A streak bonus rewards genuine recall over lucky first flips.
    player.score += 1 + Math.max(0, player.streak - 1);
    if (isComplete(state)) state.phase = "finished";
    return { kind: "matched", indices: [a, b], symbol: cardA.symbol, by: playerIndex, streak: player.streak };
  }

  player.streak = 0;
  return { kind: "missed", indices: [a, b], by: playerIndex };
}

/**
 * Turns the two peeked cards back over and advances the turn.
 *
 * Returns the resulting phase. In Sudden Death this call can eliminate the last
 * remaining player and end the match, and a caller that assumes the game is
 * still running will hang without ever reporting a result — so the phase is
 * returned rather than left to be re-read from the mutated state, where a
 * caller's earlier `phase === "playing"` guard would have narrowed it.
 */
export function resolveMiss(state: MatchState, playerIndex: number): Phase {
  for (const i of state.selection) {
    const c = state.cards[i];
    if (c && !c.matched) c.faceUp = false;
  }
  state.selection = [];

  if (state.settings.mode === "sudden") {
    const p = state.players[playerIndex];
    if (p) p.out = true;
    const alive = state.players.filter((x) => !x.out);
    if (alive.length <= 1) {
      state.phase = "finished";
      return state.phase;
    }
  }

  if (state.settings.mode !== "timeattack") advanceTurn(state);
  return state.phase;
}

export function advanceTurn(state: MatchState): void {
  const n = state.players.length;
  if (n === 0) return;
  for (let step = 1; step <= n; step++) {
    const next = (state.turn + step) % n;
    const p = state.players[next];
    // Skip eliminated players, and players who dropped mid-game so the room
    // does not stall on someone whose headset went to sleep.
    if (p && !p.out && (p.connected || p.isAi)) {
      state.turn = next;
      break;
    }
  }
  state.turnDeadline =
    state.settings.turnSeconds > 0 ? Date.now() + state.settings.turnSeconds * 1000 : 0;
}

export function isComplete(state: MatchState): boolean {
  return state.cards.every((c) => c.matched);
}

export function remainingPairs(state: MatchState): number {
  return state.cards.filter((c) => !c.matched).length / 2;
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface PlayerResult {
  playerId: string;
  name: string;
  seat: number;
  score: number;
  isAi: boolean;
  rank: number;
  /** Matches ÷ flips, 0-1. The stat that actually shows skill. */
  accuracy: number;
  /** Eliminated in Sudden Death. Always false in the other modes. */
  out: boolean;
}

export interface MatchResult {
  results: PlayerResult[];
  durationMs: number;
  pairs: number;
  mode: GameMode;
  environmentId: string;
}

export function summarise(state: MatchState, flipsByPlayer: Record<string, number> = {}): MatchResult {
  // Sudden Death is won by surviving, not by scoring: being eliminated puts a
  // player below every survivor whatever their score. Without this an eliminated
  // player ties for first against a survivor on the same score, which is the
  // opposite of what the mode promises.
  const suddenDeath = state.settings.mode === "sudden";
  const ranked = [...state.players].sort((a, b) => {
    if (suddenDeath && a.out !== b.out) return a.out ? 1 : -1;
    return b.score - a.score;
  });

  let rank = 0;
  let lastKey = "";

  const results: PlayerResult[] = ranked.map((p, i) => {
    // Players who are level on every ranking term share a rank; the next rank
    // then skips past them.
    const key = suddenDeath ? `${p.out ? 1 : 0}:${p.score}` : `${p.score}`;
    if (key !== lastKey) {
      rank = i + 1;
      lastKey = key;
    }
    // One "attempt" is a two-card turn, so accuracy is pairs found ÷ attempts.
    const attempts = (flipsByPlayer[p.id] ?? 0) / 2;
    return {
      playerId: p.id,
      name: p.name,
      seat: p.seat,
      score: p.score,
      isAi: p.isAi,
      rank,
      accuracy: attempts > 0 ? Math.min(1, countMatches(state, p.seat) / attempts) : 0,
      out: p.out,
    };
  });

  return {
    results,
    durationMs: state.startedAt > 0 ? Date.now() - state.startedAt : 0,
    pairs: state.settings.pairs,
    mode: state.settings.mode,
    environmentId: state.settings.environmentId,
  };
}

function countMatches(state: MatchState, seat: number): number {
  return state.cards.filter((c) => c.matched && c.matchedBy === seat).length / 2;
}

// ── Room codes ──────────────────────────────────────────────────────────────

/**
 * Six characters, no vowels (so no code ever spells something unfortunate in
 * front of a client) and no 0/O/1/I/L confusion — these get read aloud across
 * a room and typed on a floating keyboard.
 */
export const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";

export function makeRoomCode(rnd: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  return out;
}

export function normaliseRoomCode(input: string): string {
  // The alphabet deliberately contains no O/0/I/1/L, so a character from any of
  // those confusable groups is a typo rather than something to remap. Dropping
  // them keeps the floating keyboard forgiving without inventing a wrong code.
  const upper = input.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === 6) break;
  }
  return out;
}

export function isValidRoomCode(input: string): boolean {
  return normaliseRoomCode(input).length === 6;
}
