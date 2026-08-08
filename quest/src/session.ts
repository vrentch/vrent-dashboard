/**
 * Local match orchestration.
 *
 * This is the offline twin of the multiplayer server's room loop: it owns the
 * clock, drives AI turns and enforces the same rules from `shared/game.ts`.
 * Solo and AI games therefore need no network at all, which is what lets the
 * Demo edition run on a headset at a trade stand with the wifi switched off.
 *
 * `main.ts` talks to either this or `NetClient` through the same event shape,
 * so the rest of the app never learns whether a game is local or online.
 */

import type { AiLevel } from "../shared/editions.ts";
import {
  advanceTurn,
  applyFlip,
  createMatch,
  createPlayer,
  isComplete,
  resolveMiss,
  summarise,
  type GameSettings,
  type MatchResult,
  type MatchState,
  type Player,
} from "../shared/game.ts";
import { createAiOpponent } from "./ai/opponent.ts";
import type { AiOpponent } from "./contracts.ts";

export interface LocalSessionEvents {
  onRevealed(index: number, symbol: number, seat: number): void;
  onMatched(indices: [number, number], seat: number, streak: number): void;
  onMissed(indices: [number, number], seat: number): void;
  onHidden(indices: number[]): void;
  onTurn(seat: number, isHuman: boolean, deadline: number): void;
  onGameOver(result: MatchResult): void;
  /** Telegraphs the card an AI is about to take, so the board can hint it. */
  onAiIntent(index: number | null, seat: number): void;
}

export interface LocalSession {
  start(settings: GameSettings, humanName: string, ai: readonly AiLevel[]): MatchState;
  /** A flip initiated by the human player. Ignored when it is not their turn. */
  flip(index: number): void;
  state(): MatchState | null;
  isHumanTurn(): boolean;
  /** Stops timers and aborts any in-flight AI decision. */
  end(): void;
}

const HUMAN_ID = "local-human";

export function createLocalSession(events: LocalSessionEvents): LocalSession {
  let match: MatchState | null = null;
  let brains = new Map<string, AiOpponent>();
  let flipsByPlayer: Record<string, number> = {};

  // Everything async is tracked so `end()` can leave nothing running — a timer
  // that fires after the player has quit to the lobby would flip a card on a
  // board that no longer exists.
  let missTimer: ReturnType<typeof setTimeout> | null = null;
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  let aiAbort: AbortController | null = null;

  function clearTimers(): void {
    if (missTimer) clearTimeout(missTimer);
    if (turnTimer) clearTimeout(turnTimer);
    missTimer = turnTimer = null;
    aiAbort?.abort();
    aiAbort = null;
  }

  function currentPlayer(): Player | null {
    return match ? (match.players[match.turn] ?? null) : null;
  }

  function isHumanTurn(): boolean {
    const p = currentPlayer();
    return !!p && !p.isAi;
  }

  /** Every AI sees every reveal, exactly as a human at the table would. */
  function broadcastObserve(index: number, symbol: number): void {
    for (const brain of brains.values()) brain.observe(index, symbol);
  }

  function finish(): void {
    if (!match) return;
    clearTimers();
    match.phase = "finished";
    events.onGameOver(summarise(match, flipsByPlayer));
  }

  function beginTurn(): void {
    if (!match || match.phase !== "playing") return;

    const player = currentPlayer();
    if (!player) return;

    if (match.settings.turnSeconds > 0) {
      match.turnDeadline = Date.now() + match.settings.turnSeconds * 1000;
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = setTimeout(() => {
        // Out of time mid-turn: put back whatever is showing and move on.
        if (!match || match.phase !== "playing") return;
        if (match.selection.length > 0) {
          const shown = [...match.selection];
          resolveMiss(match, match.turn);
          events.onHidden(shown);
        } else {
          advanceTurn(match);
        }
        beginTurn();
      }, match.settings.turnSeconds * 1000);
    } else {
      match.turnDeadline = 0;
    }

    events.onTurn(player.seat, !player.isAi, match.turnDeadline);
    if (player.isAi) void runAiTurn(player);
  }

  /**
   * Plays one AI turn: two deliberate flips, with the same miss-peek pause a
   * human gets so watching an AI play is legible rather than instantaneous.
   */
  async function runAiTurn(player: Player): Promise<void> {
    const brain = brains.get(player.id);
    if (!brain || !match) return;

    aiAbort?.abort();
    const abort = new AbortController();
    aiAbort = abort;

    try {
      for (let pick = 0; pick < 2; pick++) {
        if (abort.signal.aborted || !match || match.phase !== "playing") return;
        if (match.turn !== match.players.indexOf(player)) return;

        const index = await brain.chooseFlip(match, abort.signal);
        if (abort.signal.aborted || !match) return;

        events.onAiIntent(index, player.seat);
        // A beat between "I've decided" and the card turning; without it the
        // hint and the flip read as one event and the AI looks instant.
        await sleep(260, abort.signal);
        if (abort.signal.aborted || !match) return;
        events.onAiIntent(null, player.seat);

        const handled = commitFlip(match.players.indexOf(player), index);
        if (!handled) return;

        // The turn is over as soon as the pair resolves: a match re-armed the
        // turn from inside `commitFlip` (starting a fresh decision cycle that
        // aborted this one), and a miss is waiting on the peek timer. Either
        // way this loop must not pick again.
        if (match.selection.length !== 1) return;
      }
    } catch {
      // An aborted decision is the normal path when a game ends mid-think.
    }
  }

  /**
   * Shared flip path for humans and AI. Returns false when the flip was
   * rejected, so the AI loop can stop rather than spin.
   */
  function commitFlip(playerIndex: number, index: number): boolean {
    if (!match) return false;
    const player = match.players[playerIndex];
    if (!player) return false;

    const outcome = applyFlip(match, playerIndex, index);

    switch (outcome.kind) {
      case "rejected":
        return false;

      case "revealed":
        flipsByPlayer[player.id] = (flipsByPlayer[player.id] ?? 0) + 1;
        broadcastObserve(outcome.index, outcome.symbol);
        events.onRevealed(outcome.index, outcome.symbol, player.seat);
        return true;

      case "matched": {
        flipsByPlayer[player.id] = (flipsByPlayer[player.id] ?? 0) + 1;
        const [a, b] = outcome.indices;
        broadcastObserve(a, outcome.symbol);
        // Reveal the second card before the match flourish, or the pair
        // appears to resolve from a single flip.
        events.onRevealed(b, outcome.symbol, player.seat);
        events.onMatched(outcome.indices, player.seat, outcome.streak);
        for (const brain of brains.values()) brain.forget(outcome.indices);

        if (isComplete(match)) {
          finish();
          return true;
        }
        // Classic memory: a match keeps the turn. Re-arm the timer and, for an
        // AI, start a fresh decision cycle.
        beginTurn();
        return true;
      }

      case "missed": {
        flipsByPlayer[player.id] = (flipsByPlayer[player.id] ?? 0) + 1;
        const [a, b] = outcome.indices;
        const symB = match.cards[b].symbol;
        broadcastObserve(a, match.cards[a].symbol);
        broadcastObserve(b, symB);
        events.onRevealed(b, symB, player.seat);
        events.onMissed(outcome.indices, player.seat);

        const hidden = [...outcome.indices];
        if (missTimer) clearTimeout(missTimer);
        missTimer = setTimeout(() => {
          if (!match || match.phase !== "playing") return;
          resolveMiss(match, playerIndex);
          events.onHidden(hidden);
          if (match.phase === "finished") {
            finish();
            return;
          }
          beginTurn();
        }, match.settings.peekMs);
        return true;
      }
    }
  }

  return {
    start(settings, humanName, ai) {
      clearTimers();
      brains = new Map();
      flipsByPlayer = {};

      const players: Player[] = [
        createPlayer({ id: HUMAN_ID, name: humanName || "You", seat: 0 }),
      ];

      ai.forEach((level, i) => {
        const id = `ai-${i}`;
        players.push(
          createPlayer({
            id,
            name: aiName(level, i),
            seat: i + 1,
            isAi: true,
            aiLevel: level,
          }),
        );
        brains.set(id, createAiOpponent(id, level));
      });

      match = createMatch(settings, players);
      match.phase = "playing";
      match.startedAt = Date.now();
      match.turn = 0;
      beginTurn();
      return match;
    },

    flip(index) {
      if (!match || match.phase !== "playing") return;
      if (!isHumanTurn()) return;
      // Refuse while a miss is still on screen, otherwise a fast player can
      // queue a third card into a turn that has not resolved.
      if (match.selection.length >= 2) return;
      commitFlip(match.turn, index);
    },

    state: () => match,
    isHumanTurn,

    end() {
      clearTimers();
      for (const brain of brains.values()) brain.reset();
      match = null;
    },
  };
}

function aiName(level: AiLevel, i: number): string {
  const names: Record<AiLevel, string> = {
    easy: "Nova",
    medium: "Atlas",
    expert: "Kepler",
  };
  return i === 0 ? names[level] : `${names[level]} ${i + 1}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
