/**
 * Room registry and the authoritative match loop.
 *
 * The server owns the deck. Card symbols are stripped out of every frame until
 * the card is legitimately face-up (`toCardView`), so a modified headset cannot
 * read the board out of a network trace. Every rule decision comes from
 * `shared/game.ts` — `applyFlip`, `resolveMiss`, `advanceTurn`, `summarise` —
 * so the client and the server can never disagree about who scored.
 *
 * Nothing in here knows about HTTP or `ws`: the transport hands in a
 * `Connection` and gets structured `ServerMessage`s back, which keeps the match
 * loop testable and the socket handling in one place (`index.ts`).
 */

import { randomBytes } from "node:crypto";
import type { AiLevel } from "../shared/editions.ts";
import type { GameSettings, MatchState, Phase, Player } from "../shared/game.ts";
import {
  BOARD_PRESETS,
  DEFAULT_SETTINGS,
  GAME_MODES,
  advanceTurn,
  applyFlip,
  createDeck,
  createMatch,
  createPlayer,
  isComplete,
  isValidRoomCode,
  makeRoomCode,
  normaliseRoomCode,
  randomSeed,
  resolveMiss,
  summarise,
} from "../shared/game.ts";
import type {
  CardView,
  ClientMessage,
  EmoteId,
  ErrorCode,
  LeaderboardScope,
  PlayerView,
  RoomView,
  ServerMessage,
} from "../shared/protocol.ts";
import { EMOTES, PROTOCOL_VERSION } from "../shared/protocol.ts";
import type { Leaderboard } from "./leaderboard.ts";
import type { AiRunner } from "./ai-runner.ts";
import { createAiRunner } from "./ai-runner.ts";

// ── Tunables ────────────────────────────────────────────────────────────────

/** A room dies this long after its last activity. */
export const ROOM_IDLE_MS = 30 * 60 * 1000;

/** A dropped player keeps their seat this long before it is released. */
export const SEAT_HOLD_MS = 90 * 1000;

/** Hard ceiling on seats: `seatColors` and `Player.seat` are both 0-7. */
export const MAX_SEATS = 8;

/** Seconds of countdown between "start" and the first flip being legal. */
const COUNTDOWN_SECONDS = 3;

/** How often the sweeper runs. */
const SWEEP_INTERVAL_MS = 30 * 1000;

/** Emotes are fun until someone holds the button down. */
const EMOTE_MIN_GAP_MS = 600;

const MAX_NAME_LENGTH = 20;

// ── Logging ─────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLogLevel(): LogLevel {
  const raw = String(process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error" ? raw : "info";
}

const MIN_LEVEL = LEVEL_ORDER[resolveLogLevel()];
const LOG_JSON = process.env.LOG_JSON === "1" || process.env.LOG_JSON === "true";

/**
 * One line per event, `event key=value` — readable over an operator's shoulder
 * during a live event, greppable afterwards. Set `LOG_JSON=1` for ingestion.
 */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  try {
    if (LOG_JSON) {
      stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`);
      return;
    }
    let line = `${new Date().toISOString().slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event}`;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      line += ` ${k}=${s !== undefined && /[\s"]/.test(s) ? JSON.stringify(s) : s}`;
    }
    stream.write(`${line}\n`);
  } catch {
    /* Logging must never be the thing that takes the server down. */
  }
}

// ── Transport seam ──────────────────────────────────────────────────────────

/** What the registry needs from a socket. Implemented in `index.ts`. */
export interface Connection {
  readonly id: string;
  readonly ip: string;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
  isOpen(): boolean;
}

/** Per-connection state. One session may outlive several connections. */
export interface Session {
  readonly conn: Connection;
  playerId: string | null;
  name: string;
  edition: string;
  roomCode: string | null;
  token: string | null;
  lastEmoteAt: number;
  createdAt: number;
}

// ── Internal model ──────────────────────────────────────────────────────────

interface Member {
  /** Same object identity as the entry in `room.state.players`. */
  player: Player;
  /** Secret. Never leaves the server except in that player's own `welcome`. */
  token: string;
  conn: Connection | null;
  session: Session | null;
  droppedAt: number;
  seatTimer: ReturnType<typeof setTimeout> | null;
  /** Accepted flips, for the accuracy stat in `summarise()`. */
  flips: number;
  joinedAt: number;
}

interface Room {
  code: string;
  hostId: string;
  state: MatchState;
  members: Map<string, Member>;
  maxPlayers: number;
  createdAt: number;
  lastActivity: number;
  /** Who owns the cards currently face-up and awaiting resolution. */
  selectionOwner: string | null;
  peekTimer: ReturnType<typeof setTimeout> | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  /** Kicked players should not be able to walk straight back in. */
  bannedIps: Set<string>;
  ai: AiRunner;
  closed: boolean;
}

export interface RoomStat {
  code: string;
  phase: Phase;
  players: number;
  humans: number;
  ais: number;
  connected: number;
  maxPlayers: number;
  mode: string;
  pairs: number;
  ageSec: number;
  idleSec: number;
}

export interface RegistryStats {
  rooms: number;
  players: number;
  humans: number;
  ais: number;
  connected: number;
  sessions: number;
  byPhase: Record<Phase, number>;
  detail: RoomStat[];
}

export interface RegistryOptions {
  leaderboard: Leaderboard;
  serverVersion: string;
  /** Overridable for tests. */
  now?: () => number;
}

export interface Registry {
  attach(conn: Connection): Session;
  /** Handles one already size-checked, already rate-limited inbound frame. */
  handle(session: Session, raw: string): void;
  detach(session: Session, reason: string): void;
  stats(): RegistryStats;
  /** Expires idle rooms and abandoned seats. Called on a timer. */
  sweep(): void;
  shutdown(): void;
}

// ── Registry ────────────────────────────────────────────────────────────────

export function createRegistry(options: RegistryOptions): Registry {
  const { leaderboard, serverVersion } = options;
  const now = options.now ?? (() => Date.now());

  const rooms = new Map<string, Room>();
  const sessions = new Set<Session>();
  /** resumeToken → where that seat lives. Revoked when the seat is released. */
  const tokens = new Map<string, { code: string; playerId: string }>();

  let sweepTimer: ReturnType<typeof setTimeout> | null = setInterval(() => sweep(), SWEEP_INTERVAL_MS);
  if (sweepTimer && typeof sweepTimer.unref === "function") sweepTimer.unref();

  // ── Sending ───────────────────────────────────────────────────────────────

  function send(conn: Connection | null, msg: ServerMessage): void {
    if (!conn || !conn.isOpen()) return;
    try {
      conn.send(msg);
    } catch (err) {
      log("warn", "send.failed", { conn: conn.id, type: msg.t, error: describe(err) });
    }
  }

  function fail(session: Session, code: ErrorCode, message: string): void {
    send(session.conn, { t: "error", code, message });
  }

  function broadcast(room: Room, msg: ServerMessage, exceptPlayerId?: string): void {
    for (const member of room.members.values()) {
      if (exceptPlayerId && member.player.id === exceptPlayerId) continue;
      send(member.conn, msg);
    }
  }

  function broadcastRoom(room: Room): void {
    broadcast(room, { t: "roomState", room: toRoomView(room) });
  }

  // ── Views (the only path cards take to the wire) ──────────────────────────

  function toCardView(card: { index: number; symbol: number; faceUp: boolean; matched: boolean; matchedBy: number | null }): CardView {
    const visible = card.faceUp || card.matched;
    return {
      index: card.index,
      // The whole anti-cheat story in one line: no symbol until it is earned.
      symbol: visible ? card.symbol : null,
      faceUp: card.faceUp,
      matched: card.matched,
      matchedBy: card.matchedBy,
    };
  }

  function toPlayerView(room: Room, player: Player): PlayerView {
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      score: player.score,
      streak: player.streak,
      isAi: player.isAi,
      aiLevel: player.aiLevel,
      connected: player.connected,
      out: player.out,
      isHost: room.hostId === player.id,
    };
  }

  function toRoomView(room: Room): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      phase: room.state.phase,
      settings: { ...room.state.settings },
      players: room.state.players.map((p) => toPlayerView(room, p)),
      cards: room.state.cards.map(toCardView),
      turn: room.state.turn,
      turnDeadline: room.state.turnDeadline,
      startedAt: room.state.startedAt,
      maxPlayers: room.maxPlayers,
    };
  }

  // ── Room lifecycle ────────────────────────────────────────────────────────

  function freshCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      const code = makeRoomCode();
      if (!rooms.has(code)) return code;
    }
    // 28^6 codes; getting here means something is very wrong. Fail loudly
    // rather than silently reusing a live code.
    throw new Error("could not allocate a free room code");
  }

  function createRoom(settings: GameSettings, maxPlayers: number): Room {
    const code = freshCode();
    const state = createMatch(settings, [], randomSeed());
    state.phase = "lobby";

    let roomRef: Room | null = null;
    const ai = createAiRunner({
      state: () => (roomRef ? roomRef.state : state),
      flip: (playerId, index) => (roomRef ? aiFlip(roomRef, playerId, index) : false),
      log: (level, event, fields) => log(level, event, { room: code, ...fields }),
    });

    const room: Room = {
      code,
      hostId: "",
      state,
      members: new Map(),
      maxPlayers,
      createdAt: now(),
      lastActivity: now(),
      selectionOwner: null,
      peekTimer: null,
      turnTimer: null,
      countdownTimer: null,
      bannedIps: new Set(),
      ai,
      closed: false,
    };
    roomRef = room;
    rooms.set(code, room);
    return room;
  }

  function clearRoomTimers(room: Room): void {
    for (const key of ["peekTimer", "turnTimer", "countdownTimer"] as const) {
      const timer = room[key];
      if (timer) {
        clearTimeout(timer);
        room[key] = null;
      }
    }
  }

  function closeRoom(room: Room, reason: string): void {
    if (room.closed) return;
    room.closed = true;
    clearRoomTimers(room);
    room.ai.dispose();

    for (const member of room.members.values()) {
      if (member.seatTimer) clearTimeout(member.seatTimer);
      tokens.delete(member.token);
      if (member.session) {
        member.session.roomCode = null;
        if (reason === "expired") {
          send(member.conn, {
            t: "error",
            code: "no-such-room",
            message: "Room closed after 30 minutes of inactivity.",
          });
        }
      }
    }
    room.members.clear();
    rooms.delete(room.code);
    log("info", "room.closed", { room: room.code, reason });
  }

  function touch(room: Room): void {
    room.lastActivity = now();
  }

  // ── Membership ────────────────────────────────────────────────────────────

  function freeSeat(room: Room): number {
    const taken = new Set(room.state.players.map((p) => p.seat));
    for (let seat = 0; seat < MAX_SEATS; seat++) if (!taken.has(seat)) return seat;
    return -1;
  }

  function seatCount(room: Room): number {
    return room.state.players.length;
  }

  function roomIsFull(room: Room): boolean {
    return seatCount(room) >= Math.min(room.maxPlayers, MAX_SEATS);
  }

  function addMember(
    room: Room,
    init: { id: string; name: string; isAi: boolean; aiLevel?: AiLevel; session: Session | null },
  ): Member | null {
    const seat = freeSeat(room);
    if (seat < 0) return null;

    const player = createPlayer({
      id: init.id,
      name: init.name,
      seat,
      isAi: init.isAi,
      aiLevel: init.aiLevel,
      connected: true,
    });
    room.state.players.push(player);

    const member: Member = {
      player,
      token: newToken(),
      conn: init.session ? init.session.conn : null,
      session: init.session,
      droppedAt: 0,
      seatTimer: null,
      flips: 0,
      joinedAt: now(),
    };
    room.members.set(player.id, member);
    if (!init.isAi) tokens.set(member.token, { code: room.code, playerId: player.id });
    if (room.hostId === "" && !init.isAi) room.hostId = player.id;
    return member;
  }

  /**
   * Removes a seat entirely and keeps the turn pointer honest — splicing the
   * players array shifts every index after it, including `state.turn`.
   */
  function removeMember(room: Room, playerId: string, reason: "left" | "kicked" | "dropped"): void {
    const member = room.members.get(playerId);
    if (!member) return;

    if (member.seatTimer) {
      clearTimeout(member.seatTimer);
      member.seatTimer = null;
    }
    tokens.delete(member.token);
    room.members.delete(playerId);
    if (room.ai.has(playerId)) room.ai.remove(playerId);
    if (member.session) {
      member.session.roomCode = null;
      member.session.token = null;
    }

    const state = room.state;
    const index = state.players.findIndex((p) => p.id === playerId);
    let turnMoved = false;

    if (index >= 0) {
      // Anything this player was mid-way through has to be cleaned up first.
      if (room.selectionOwner === playerId && state.selection.length > 0) {
        const hidden = hideSelection(room);
        if (hidden.length > 0) broadcast(room, { t: "hidden", indices: hidden });
      }

      state.players.splice(index, 1);
      const remaining = state.players.length;
      if (remaining === 0) {
        state.turn = 0;
      } else if (state.turn > index) {
        state.turn -= 1;
      } else if (state.turn === index) {
        // The player whose turn it was just vanished — hand it to whoever is
        // next in seat order (advanceTurn skips anyone who cannot act).
        state.turn = (index - 1 + remaining) % remaining;
        advanceTurn(state);
        turnMoved = true;
      }
    }

    broadcast(room, { t: "playerLeft", playerId, reason });
    log("info", "player.left", { room: room.code, player: playerId, reason, seats: state.players.length });

    if (room.members.size === 0) {
      closeRoom(room, "empty");
      return;
    }
    if (room.hostId === playerId) promoteHost(room);
    if (room.closed) return; // promoteHost closes a room with no humans left

    if (state.phase === "playing" || state.phase === "countdown") {
      if (!hasActivePlayer(state)) {
        finishMatch(room, "no-players");
        return;
      }
      if (state.players.length === 1 && state.phase === "playing") {
        // A one-player race is over; call it and show the result.
        finishMatch(room, "last-player");
        return;
      }
      if (turnMoved) announceTurn(room);
      armTurnTimer(room);
    }

    broadcastRoom(room);
    touch(room);
  }

  function promoteHost(room: Room): void {
    const next =
      room.state.players.find((p) => !p.isAi && p.connected) ?? room.state.players.find((p) => !p.isAi);
    if (!next) {
      // Only AI seats left — nobody to run the room.
      closeRoom(room, "no-host");
      return;
    }
    room.hostId = next.id;
    log("info", "room.host-changed", { room: room.code, host: next.id });
  }

  /** Marks a seat as dropped and starts the 90 s hold. */
  function markDropped(room: Room, member: Member): void {
    member.conn = null;
    member.session = null;
    member.droppedAt = now();
    member.player.connected = false;

    if (member.seatTimer) clearTimeout(member.seatTimer);
    member.seatTimer = setTimeout(() => releaseSeat(room, member), SEAT_HOLD_MS);
    if (typeof member.seatTimer.unref === "function") member.seatTimer.unref();

    log("info", "player.dropped", {
      room: room.code,
      player: member.player.id,
      name: member.player.name,
      holdSec: SEAT_HOLD_MS / 1000,
    });

    const state = room.state;
    // `advanceTurn` already skips disconnected players, but if it was their
    // turn right now the room would sit there waiting for a sleeping headset.
    if (state.phase === "playing" && state.players[state.turn]?.id === member.player.id) {
      if (room.selectionOwner === member.player.id && state.selection.length > 0) {
        const hidden = hideSelection(room);
        if (hidden.length > 0) broadcast(room, { t: "hidden", indices: hidden });
      }
      if (hasActivePlayer(state)) {
        advanceTurn(state);
        announceTurn(room);
        armTurnTimer(room);
      } else {
        finishMatch(room, "all-dropped");
        return;
      }
    }

    broadcastRoom(room);
  }

  function releaseSeat(room: Room, member: Member): void {
    if (room.closed || !room.members.has(member.player.id)) return;
    member.seatTimer = null;
    if (member.player.connected) return;

    const phase = room.state.phase;
    if (phase === "playing" || phase === "countdown") {
      // Mid-match the roster is load-bearing: removing a seat would rewrite
      // every turn index and corrupt the final scoreboard. Keep the entry
      // (advanceTurn already skips it) and just retire the resume token, so
      // the seat can no longer be reclaimed.
      tokens.delete(member.token);
      log("info", "seat.retired", { room: room.code, player: member.player.id, phase });
      broadcastRoom(room);
      return;
    }
    log("info", "seat.released", { room: room.code, player: member.player.id, phase });
    removeMember(room, member.player.id, "dropped");
  }

  // ── Match loop ────────────────────────────────────────────────────────────

  function hasActivePlayer(state: MatchState): boolean {
    return state.players.some((p) => !p.out && (p.connected || p.isAi));
  }

  function firstActiveIndex(state: MatchState): number {
    return state.players.findIndex((p) => !p.out && (p.connected || p.isAi));
  }

  function resetTurnDeadline(state: MatchState): void {
    // Time Attack is a free-for-all, so a per-turn deadline is meaningless
    // there — leaving one set would draw a countdown ring nobody is racing.
    const timed = state.settings.turnSeconds > 0 && state.settings.mode !== "timeattack";
    state.turnDeadline = timed ? now() + state.settings.turnSeconds * 1000 : 0;
  }

  /** Turns any pending selection back over. Returns the indices hidden. */
  function hideSelection(room: Room): number[] {
    const hidden: number[] = [];
    for (const i of room.state.selection) {
      const card = room.state.cards[i];
      if (card && !card.matched) {
        card.faceUp = false;
        hidden.push(i);
      }
    }
    room.state.selection = [];
    room.selectionOwner = null;
    return hidden;
  }

  function announceTurn(room: Room): void {
    const state = room.state;
    if (state.settings.mode === "timeattack") return; // free-for-all, no turns
    const player = state.players[state.turn];
    if (!player) return;
    broadcast(room, { t: "turnChanged", playerId: player.id, seat: player.seat, deadline: state.turnDeadline });
  }

  function armTurnTimer(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    const state = room.state;
    if (state.phase !== "playing") return;
    if (state.settings.turnSeconds <= 0) return;
    if (state.settings.mode === "timeattack") return;

    const player = state.players[state.turn];
    if (!player) return;
    const playerId = player.id;
    const delay = Math.max(250, state.turnDeadline - now());

    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      onTurnTimeout(room, playerId);
    }, delay);
    if (typeof room.turnTimer.unref === "function") room.turnTimer.unref();
  }

  function onTurnTimeout(room: Room, playerId: string): void {
    const state = room.state;
    if (room.closed || state.phase !== "playing") return;
    if (state.players[state.turn]?.id !== playerId) return;
    // A miss is mid-flight; its own timer owns the turn hand-off.
    if (room.peekTimer) return;

    log("info", "turn.timeout", { room: room.code, player: playerId });

    const hidden = hideSelection(room);
    if (hidden.length > 0) broadcast(room, { t: "hidden", indices: hidden });

    if (!hasActivePlayer(state)) {
      finishMatch(room, "no-players");
      return;
    }
    advanceTurn(state);
    announceTurn(room);
    armTurnTimer(room);
    broadcastRoom(room);
    room.ai.poke();
    touch(room);
  }

  function startCountdown(room: Room): void {
    let left = COUNTDOWN_SECONDS;
    const tick = (): void => {
      if (room.closed || room.state.phase !== "countdown") return;
      if (left <= 0) {
        room.countdownTimer = null;
        beginPlay(room);
        return;
      }
      broadcast(room, { t: "countdown", secondsLeft: left });
      left -= 1;
      room.countdownTimer = setTimeout(tick, 1000);
      if (typeof room.countdownTimer.unref === "function") room.countdownTimer.unref();
    };
    tick();
  }

  function beginPlay(room: Room): void {
    const state = room.state;
    const first = firstActiveIndex(state);
    if (first < 0) {
      state.phase = "lobby";
      broadcastRoom(room);
      log("warn", "match.start-aborted", { room: room.code, reason: "no-active-players" });
      return;
    }

    state.phase = "playing";
    state.startedAt = now();
    state.turn = first;
    state.selection = [];
    room.selectionOwner = null;
    resetTurnDeadline(state);

    broadcast(room, { t: "gameStarted", room: toRoomView(room) });
    announceTurn(room);
    armTurnTimer(room);
    room.ai.reset();
    room.ai.poke();
    touch(room);

    log("info", "match.started", {
      room: room.code,
      mode: state.settings.mode,
      pairs: state.settings.pairs,
      players: state.players.length,
      seed: state.seed,
    });
  }

  /**
   * The single flip path. Humans and AI both come through here, so the same
   * validation, the same timers and the same broadcasts apply to both.
   */
  function doFlip(room: Room, member: Member, index: number): { ok: true } | { ok: false; code: ErrorCode; message: string } {
    const state = room.state;
    if (state.phase !== "playing") {
      return { ok: false, code: state.phase === "lobby" ? "invalid" : "already-started", message: "The match is not running." };
    }
    if (!Number.isInteger(index) || index < 0 || index >= state.cards.length) {
      return { ok: false, code: "invalid", message: "No such card." };
    }
    if (member.player.out) {
      return { ok: false, code: "invalid", message: "You are out of this match." };
    }
    // A flip landing between `missed` and `hidden` would resolve against the
    // wrong pair; the peek timer owns the board until it fires.
    if (room.peekTimer) {
      return { ok: false, code: "invalid", message: "Wait for the last pair to turn back over." };
    }

    const playerIndex = state.players.indexOf(member.player);
    if (playerIndex < 0) return { ok: false, code: "not-in-room", message: "You are not seated in this room." };

    const outcome = applyFlip(state, playerIndex, index);

    if (outcome.kind === "rejected") {
      const code: ErrorCode = outcome.reason === "no-such-card" ? "invalid" : "invalid";
      return { ok: false, code, message: rejectionMessage(outcome.reason) };
    }

    member.flips++;
    touch(room);

    // Every accepted flip turns exactly one card face-up, so every accepted
    // flip gets a `revealed`. This matters for the *second* card of a pair:
    // neither `missed` nor `NetEvents.onMatched` carries a symbol, so without
    // this the headset would have nothing to draw on the card it just turned.
    const flipped = state.cards[index];
    broadcast(room, { t: "revealed", index, symbol: flipped.symbol, by: member.player.id });
    room.ai.observe(index, flipped.symbol);

    if (outcome.kind === "revealed") {
      room.selectionOwner = member.player.id;
      room.ai.poke();
      return { ok: true };
    }

    if (outcome.kind === "matched") {
      room.selectionOwner = null;
      broadcast(room, {
        t: "matched",
        indices: outcome.indices,
        symbol: outcome.symbol,
        by: member.player.id,
        score: member.player.score,
        streak: outcome.streak,
      });
      room.ai.forget(outcome.indices);

      // `applyFlip` sets the phase to "finished" the moment the last pair
      // lands; `isComplete` is the same condition, asked of the board itself.
      if (isComplete(state)) {
        finishMatch(room, "complete");
        return { ok: true };
      }
      // Classic rules: a match buys another turn — but the clock restarts.
      resetTurnDeadline(state);
      announceTurn(room);
      armTurnTimer(room);
      broadcastRoom(room);
      room.ai.poke();
      return { ok: true };
    }

    // Miss: show the pair for `peekMs`, then hide it and move on — measured by
    // the server's clock, never by a client telling us time has passed.
    const peekMs = clamp(state.settings.peekMs, 300, 5000);
    const hideAt = now() + peekMs;
    broadcast(room, { t: "missed", indices: outcome.indices, by: member.player.id, hideAt });

    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    const ownerId = member.player.id;
    room.peekTimer = setTimeout(() => {
      room.peekTimer = null;
      resolvePeek(room, ownerId, outcome.indices);
    }, peekMs);
    if (typeof room.peekTimer.unref === "function") room.peekTimer.unref();
    return { ok: true };
  }

  function resolvePeek(room: Room, playerId: string, indices: readonly number[]): void {
    if (room.closed || room.state.phase !== "playing") return;
    const state = room.state;
    // Re-resolve the index: a seat may have gone away during the peek.
    const playerIndex = state.players.findIndex((p) => p.id === playerId);

    resolveMiss(state, playerIndex);
    room.selectionOwner = null;
    broadcast(room, { t: "hidden", indices: [...indices] });

    if (state.phase === "finished") {
      finishMatch(room, "sudden-death");
      return;
    }
    if (!hasActivePlayer(state)) {
      finishMatch(room, "no-players");
      return;
    }

    // `resolveMiss` already advanced the turn for every mode but Time Attack.
    announceTurn(room);
    armTurnTimer(room);
    broadcastRoom(room);
    room.ai.poke();
    touch(room);
  }

  function aiFlip(room: Room, playerId: string, index: number): boolean {
    const member = room.members.get(playerId);
    if (!member) return false;
    const result = doFlip(room, member, index);
    if (!result.ok) {
      log("debug", "ai.flip-invalid", { room: room.code, player: playerId, index, reason: result.message });
    }
    return result.ok;
  }

  function pairsByPlayer(room: Room): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of room.state.players) {
      out[p.id] = room.state.cards.filter((c) => c.matched && c.matchedBy === p.seat).length / 2;
    }
    return out;
  }

  function finishMatch(room: Room, reason: string): void {
    const state = room.state;
    clearRoomTimers(room);
    state.phase = "finished";
    state.turnDeadline = 0;
    room.selectionOwner = null;

    const flipsByPlayer: Record<string, number> = {};
    for (const [id, member] of room.members) flipsByPlayer[id] = member.flips;

    const result = summarise(state, flipsByPlayer);
    broadcast(room, { t: "gameOver", result });
    broadcastRoom(room);

    try {
      leaderboard.recordMatch({ roomCode: room.code, result, pairsByPlayer: pairsByPlayer(room) });
      broadcast(room, { t: "leaderboard", scope: "room", entries: leaderboard.top("room", room.code, 50) });
    } catch (err) {
      log("error", "leaderboard.record-failed", { room: room.code, error: describe(err) });
    }

    const winner = result.results[0];
    log("info", "match.finished", {
      room: room.code,
      reason,
      durationSec: Math.round(result.durationMs / 1000),
      winner: winner ? winner.name : "-",
      score: winner ? winner.score : 0,
    });
    touch(room);
  }

  // ── Message handling ──────────────────────────────────────────────────────

  function roomOf(session: Session): Room | null {
    if (!session.roomCode) return null;
    return rooms.get(session.roomCode) ?? null;
  }

  function memberOf(session: Session): { room: Room; member: Member } | null {
    const room = roomOf(session);
    if (!room || !session.playerId) return null;
    const member = room.members.get(session.playerId);
    if (!member) return null;
    return { room, member };
  }

  function requireHost(session: Session): { room: Room; member: Member } | null {
    const found = memberOf(session);
    if (!found) {
      fail(session, "not-in-room", "You are not in a room.");
      return null;
    }
    if (found.room.hostId !== found.member.player.id) {
      fail(session, "not-host", "Only the host can do that.");
      return null;
    }
    return found;
  }

  function leaveCurrentRoom(session: Session, reason: "left" | "kicked" | "dropped"): void {
    const found = memberOf(session);
    session.roomCode = null;
    session.token = null;
    if (!found) return;
    removeMember(found.room, found.member.player.id, reason);
  }

  function handleHello(session: Session, msg: Extract<ClientMessage, { t: "hello" }>): void {
    if (msg.protocol !== PROTOCOL_VERSION) {
      log("warn", "hello.bad-protocol", { conn: session.conn.id, got: msg.protocol, want: PROTOCOL_VERSION });
      fail(session, "bad-protocol", `This server speaks protocol ${PROTOCOL_VERSION}; the app sent ${msg.protocol}. Update the headset app.`);
      session.conn.close(4400, "protocol");
      return;
    }

    session.name = cleanName(msg.name);
    session.edition = typeof msg.edition === "string" ? msg.edition.slice(0, 24) : "unknown";

    // ── Reconnect ──
    const claim = typeof msg.resumeToken === "string" ? tokens.get(msg.resumeToken) : undefined;
    if (claim) {
      const room = rooms.get(claim.code);
      const member = room?.members.get(claim.playerId);
      if (room && member && !room.closed) {
        // A second live connection for one seat: the newest wins.
        if (member.conn && member.conn.isOpen() && member.conn.id !== session.conn.id) {
          send(member.conn, { t: "error", code: "invalid", message: "This seat was claimed by another connection." });
          member.conn.close(4001, "replaced");
        }
        if (member.session && member.session !== session) member.session.roomCode = null;
        if (member.seatTimer) {
          clearTimeout(member.seatTimer);
          member.seatTimer = null;
        }

        member.conn = session.conn;
        member.session = session;
        member.droppedAt = 0;
        member.player.connected = true;
        if (session.name) member.player.name = session.name;

        session.playerId = member.player.id;
        session.roomCode = room.code;
        session.token = member.token;

        send(session.conn, {
          t: "welcome",
          playerId: member.player.id,
          resumeToken: member.token,
          protocol: PROTOCOL_VERSION,
          serverVersion,
        });
        send(session.conn, { t: "roomState", room: toRoomView(room) });
        broadcastRoom(room);
        touch(room);
        log("info", "player.resumed", {
          room: room.code,
          player: member.player.id,
          name: member.player.name,
          phase: room.state.phase,
        });
        room.ai.poke();
        return;
      }
      log("debug", "hello.stale-token", { conn: session.conn.id });
    }

    // ── Fresh player ──
    session.playerId = newId("p");
    session.roomCode = null;
    session.token = null;
    send(session.conn, {
      t: "welcome",
      playerId: session.playerId,
      // A player with no seat has nothing to resume yet; the real token is
      // issued the moment they occupy one.
      resumeToken: "",
      protocol: PROTOCOL_VERSION,
      serverVersion,
    });
    log("info", "player.hello", {
      conn: session.conn.id,
      player: session.playerId,
      name: session.name,
      edition: session.edition,
      ip: session.conn.ip,
    });
  }

  function sendWelcomeWithToken(session: Session, member: Member): void {
    session.token = member.token;
    send(session.conn, {
      t: "welcome",
      playerId: member.player.id,
      resumeToken: member.token,
      protocol: PROTOCOL_VERSION,
      serverVersion,
    });
  }

  function handleCreateRoom(session: Session, msg: Extract<ClientMessage, { t: "createRoom" }>): void {
    if (session.roomCode) leaveCurrentRoom(session, "left");

    const settings = sanitiseSettings(msg.settings, DEFAULT_SETTINGS);
    const maxPlayers = clamp(Math.round(Number(msg.maxPlayers) || 1), 1, MAX_SEATS);

    let room: Room;
    try {
      room = createRoom(settings, maxPlayers);
    } catch (err) {
      log("error", "room.create-failed", { error: describe(err) });
      fail(session, "server-error", "Could not create a room. Try again.");
      return;
    }

    const member = addMember(room, {
      id: session.playerId ?? newId("p"),
      name: session.name,
      isAi: false,
      session,
    });
    if (!member) {
      closeRoom(room, "create-failed");
      fail(session, "server-error", "Could not seat you in the new room.");
      return;
    }

    session.playerId = member.player.id;
    session.roomCode = room.code;
    sendWelcomeWithToken(session, member);
    send(session.conn, { t: "roomState", room: toRoomView(room) });
    log("info", "room.created", {
      room: room.code,
      host: member.player.id,
      name: member.player.name,
      mode: settings.mode,
      pairs: settings.pairs,
      maxPlayers,
    });
  }

  function handleJoinRoom(session: Session, msg: Extract<ClientMessage, { t: "joinRoom" }>): void {
    const raw = typeof msg.code === "string" ? msg.code : "";
    if (!isValidRoomCode(raw)) {
      fail(session, "no-such-room", "That is not a valid room code.");
      return;
    }
    const code = normaliseRoomCode(raw);
    const room = rooms.get(code);
    if (!room || room.closed) {
      fail(session, "no-such-room", `No room with code ${code}.`);
      return;
    }
    if (session.roomCode === code && session.playerId && room.members.has(session.playerId)) {
      send(session.conn, { t: "roomState", room: toRoomView(room) });
      return;
    }
    if (room.bannedIps.has(session.conn.ip)) {
      fail(session, "not-in-room", "The host removed you from this room.");
      return;
    }
    if (room.state.phase !== "lobby") {
      fail(session, "already-started", "That match has already started.");
      return;
    }
    if (roomIsFull(room)) {
      fail(session, "room-full", "That room is full.");
      return;
    }

    if (session.roomCode) leaveCurrentRoom(session, "left");

    const member = addMember(room, {
      id: session.playerId ?? newId("p"),
      name: session.name,
      isAi: false,
      session,
    });
    if (!member) {
      fail(session, "room-full", "That room is full.");
      return;
    }

    session.playerId = member.player.id;
    session.roomCode = room.code;
    sendWelcomeWithToken(session, member);
    send(session.conn, { t: "roomState", room: toRoomView(room) });
    broadcast(room, { t: "playerJoined", player: toPlayerView(room, member.player) }, member.player.id);
    broadcastRoom(room);
    touch(room);
    log("info", "player.joined", {
      room: room.code,
      player: member.player.id,
      name: member.player.name,
      seat: member.player.seat,
      seats: room.state.players.length,
    });
  }

  function handleUpdateSettings(session: Session, msg: Extract<ClientMessage, { t: "updateSettings" }>): void {
    const found = requireHost(session);
    if (!found) return;
    const { room } = found;
    if (room.state.phase !== "lobby") {
      fail(session, "already-started", "Settings are locked once the match starts.");
      return;
    }

    const before = room.state.settings;
    const next = sanitiseSettings({ ...before, ...(msg.settings ?? {}) }, before);
    room.state.settings = next;

    if (next.pairs !== before.pairs) {
      // A different board size means a different deck.
      room.state.seed = randomSeed();
      room.state.cards = createDeck(room.state.seed, next.pairs);
      room.state.selection = [];
      room.selectionOwner = null;
    }

    broadcast(room, { t: "settingsChanged", settings: { ...next } });
    broadcastRoom(room);
    touch(room);
    log("debug", "room.settings", { room: room.code, mode: next.mode, pairs: next.pairs, turnSeconds: next.turnSeconds });
  }

  function handleAddAi(session: Session, msg: Extract<ClientMessage, { t: "addAi" }>): void {
    const found = requireHost(session);
    if (!found) return;
    const { room } = found;
    if (room.state.phase !== "lobby") {
      fail(session, "already-started", "Add AI opponents before the match starts.");
      return;
    }
    if (roomIsFull(room)) {
      fail(session, "room-full", "No free seats for another opponent.");
      return;
    }
    const level: AiLevel = msg.level === "easy" || msg.level === "medium" || msg.level === "expert" ? msg.level : "medium";

    const member = addMember(room, {
      id: newId("ai"),
      name: aiName(room, level),
      isAi: true,
      aiLevel: level,
      session: null,
    });
    if (!member) {
      fail(session, "room-full", "No free seats for another opponent.");
      return;
    }

    room.ai.add(member.player.id, level);
    broadcast(room, { t: "playerJoined", player: toPlayerView(room, member.player) });
    broadcastRoom(room);
    touch(room);
  }

  function handleRemoveAi(session: Session, msg: Extract<ClientMessage, { t: "removeAi" }>): void {
    const found = requireHost(session);
    if (!found) return;
    const { room } = found;
    const target = room.members.get(String(msg.playerId ?? ""));
    if (!target || !target.player.isAi) {
      fail(session, "invalid", "No such AI opponent.");
      return;
    }
    if (room.state.phase !== "lobby") {
      fail(session, "already-started", "AI opponents cannot leave mid-match.");
      return;
    }
    removeMember(room, target.player.id, "kicked");
    touch(room);
  }

  function handleKick(session: Session, msg: Extract<ClientMessage, { t: "kick" }>): void {
    const found = requireHost(session);
    if (!found) return;
    const { room } = found;
    const targetId = String(msg.playerId ?? "");
    if (targetId === room.hostId) {
      fail(session, "invalid", "The host cannot kick themselves.");
      return;
    }
    const target = room.members.get(targetId);
    if (!target) {
      fail(session, "invalid", "No such player.");
      return;
    }

    const conn = target.conn;
    if (conn) {
      // The client clears its cached room code on `not-in-room`, so it will not
      // bounce straight back in on its next reconnect.
      room.bannedIps.add(conn.ip);
      send(conn, { t: "error", code: "not-in-room", message: "The host removed you from the room." });
    }
    log("info", "player.kicked", { room: room.code, player: targetId, by: room.hostId });
    removeMember(room, targetId, "kicked");
    touch(room);
  }

  function handleStartGame(session: Session): void {
    const found = requireHost(session);
    if (!found) return;
    const { room } = found;
    if (room.state.phase === "countdown" || room.state.phase === "playing") {
      fail(session, "already-started", "The match is already running.");
      return;
    }
    const seated = room.state.players;
    if (seated.length === 0 || !seated.some((p) => !p.isAi && p.connected)) {
      fail(session, "invalid", "Nobody is here to play.");
      return;
    }

    clearRoomTimers(room);
    for (const p of seated) {
      p.score = 0;
      p.streak = 0;
      p.out = false;
    }
    for (const member of room.members.values()) member.flips = 0;

    const settings = room.state.settings;
    const seed = randomSeed();
    const next = createMatch(settings, seated, seed);
    room.state = next;
    room.selectionOwner = null;

    broadcastRoom(room);
    startCountdown(room);
    touch(room);
  }

  function handleFlip(session: Session, msg: Extract<ClientMessage, { t: "flip" }>): void {
    const found = memberOf(session);
    if (!found) {
      fail(session, "not-in-room", "You are not in a room.");
      return;
    }
    const result = doFlip(found.room, found.member, Math.trunc(Number(msg.index)));
    if (!result.ok) {
      fail(session, result.code, result.message);
      log("debug", "flip.rejected", {
        room: found.room.code,
        player: found.member.player.id,
        index: msg.index,
        reason: result.message,
      });
    }
  }

  function handleEmote(session: Session, msg: Extract<ClientMessage, { t: "emote" }>): void {
    const found = memberOf(session);
    if (!found) {
      fail(session, "not-in-room", "You are not in a room.");
      return;
    }
    if (!isEmoteId(msg.emote)) {
      fail(session, "invalid", "Unknown emote.");
      return;
    }
    const at = now();
    if (at - session.lastEmoteAt < EMOTE_MIN_GAP_MS) {
      fail(session, "rate-limited", "Easy on the emotes.");
      return;
    }
    session.lastEmoteAt = at;
    broadcast(found.room, { t: "emote", playerId: found.member.player.id, emote: msg.emote });
    touch(found.room);
  }

  function handleLeaderboard(session: Session, msg: Extract<ClientMessage, { t: "requestLeaderboard" }>): void {
    const scope: LeaderboardScope =
      msg.scope === "room" || msg.scope === "today" || msg.scope === "global" ? msg.scope : "global";
    let entries: ReturnType<Leaderboard["top"]> = [];
    try {
      entries = leaderboard.top(scope, session.roomCode, 100);
    } catch (err) {
      log("error", "leaderboard.read-failed", { scope, error: describe(err) });
    }
    send(session.conn, { t: "leaderboard", scope, entries });
  }

  // ── Public surface ────────────────────────────────────────────────────────

  function sweep(): void {
    const at = now();
    for (const room of [...rooms.values()]) {
      if (room.closed) continue;
      if (at - room.lastActivity > ROOM_IDLE_MS) {
        log("info", "room.expired", { room: room.code, idleMin: Math.round((at - room.lastActivity) / 60000) });
        closeRoom(room, "expired");
        continue;
      }
      if (room.members.size === 0) {
        closeRoom(room, "empty");
        continue;
      }
      // Belt and braces: a seat whose hold timer somehow never fired.
      for (const member of [...room.members.values()]) {
        if (!member.player.connected && member.droppedAt > 0 && at - member.droppedAt > SEAT_HOLD_MS * 2) {
          releaseSeat(room, member);
        }
      }
    }
  }

  return {
    attach(conn: Connection): Session {
      const session: Session = {
        conn,
        playerId: null,
        name: "Player",
        edition: "unknown",
        roomCode: null,
        token: null,
        lastEmoteAt: 0,
        createdAt: now(),
      };
      sessions.add(session);
      return session;
    },

    handle(session: Session, raw: string): void {
      let msg: ClientMessage | null = null;
      try {
        const parsed: unknown = JSON.parse(raw);
        msg = parsed && typeof parsed === "object" && typeof (parsed as ClientMessage).t === "string"
          ? (parsed as ClientMessage)
          : null;
      } catch {
        msg = null;
      }
      if (!msg) {
        fail(session, "invalid", "Malformed frame.");
        return;
      }

      try {
        // Ping needs no handshake — it is how a client measures a dead link.
        if (msg.t === "ping") {
          const at = typeof msg.at === "number" && Number.isFinite(msg.at) ? msg.at : 0;
          send(session.conn, { t: "pong", at, serverTime: now() });
          return;
        }
        if (msg.t === "hello") {
          handleHello(session, msg);
          return;
        }
        if (!session.playerId) {
          fail(session, "invalid", "Say hello first.");
          return;
        }

        switch (msg.t) {
          case "createRoom":
            handleCreateRoom(session, msg);
            break;
          case "joinRoom":
            handleJoinRoom(session, msg);
            break;
          case "leaveRoom":
            leaveCurrentRoom(session, "left");
            break;
          case "updateSettings":
            handleUpdateSettings(session, msg);
            break;
          case "addAi":
            handleAddAi(session, msg);
            break;
          case "removeAi":
            handleRemoveAi(session, msg);
            break;
          case "kick":
            handleKick(session, msg);
            break;
          case "startGame":
            handleStartGame(session);
            break;
          case "flip":
            handleFlip(session, msg);
            break;
          case "emote":
            handleEmote(session, msg);
            break;
          case "requestLeaderboard":
            handleLeaderboard(session, msg);
            break;
          default:
            fail(session, "invalid", `Unknown message type "${String((msg as { t: string }).t)}".`);
        }
      } catch (err) {
        // One bad frame must never take the process — or the room — down.
        log("error", "handler.threw", {
          type: msg.t,
          player: session.playerId,
          room: session.roomCode,
          error: describe(err),
          stack: err instanceof Error ? err.stack?.split("\n")[1]?.trim() : undefined,
        });
        fail(session, "server-error", "Something went wrong handling that. The room is still running.");
      }
    },

    detach(session: Session, reason: string): void {
      sessions.delete(session);
      const found = memberOf(session);
      if (!found) return;
      const { room, member } = found;
      if (member.session !== session) return; // superseded by a newer connection
      log("debug", "conn.detach", { conn: session.conn.id, player: session.playerId, room: room.code, reason });

      // Every drop holds the seat, including the host alone in a lobby: a
      // headset that naps between "here's the code" and the first guest
      // arriving must find its room still standing when it wakes. The 90s
      // timer tears down the room if nobody comes back.
      markDropped(room, member);
    },

    stats(): RegistryStats {
      const at = now();
      const byPhase: Record<Phase, number> = { lobby: 0, countdown: 0, playing: 0, finished: 0 };
      const detail: RoomStat[] = [];
      let players = 0;
      let humans = 0;
      let ais = 0;
      let connected = 0;

      for (const room of rooms.values()) {
        byPhase[room.state.phase] += 1;
        const roomHumans = room.state.players.filter((p) => !p.isAi).length;
        const roomAis = room.state.players.length - roomHumans;
        const roomConnected = room.state.players.filter((p) => p.connected && !p.isAi).length;
        players += room.state.players.length;
        humans += roomHumans;
        ais += roomAis;
        connected += roomConnected;
        detail.push({
          code: room.code,
          phase: room.state.phase,
          players: room.state.players.length,
          humans: roomHumans,
          ais: roomAis,
          connected: roomConnected,
          maxPlayers: room.maxPlayers,
          mode: room.state.settings.mode,
          pairs: room.state.settings.pairs,
          ageSec: Math.round((at - room.createdAt) / 1000),
          idleSec: Math.round((at - room.lastActivity) / 1000),
        });
      }

      return { rooms: rooms.size, players, humans, ais, connected, sessions: sessions.size, byPhase, detail };
    },

    sweep,

    shutdown(): void {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
      for (const room of [...rooms.values()]) closeRoom(room, "shutdown");
      sessions.clear();
      tokens.clear();
    },
  };
}

// ── Validation helpers ──────────────────────────────────────────────────────

const VALID_PAIRS = new Set(BOARD_PRESETS.map((p) => p.pairs));
const VALID_MODES = new Set(GAME_MODES.map((m) => m.id as string));
const EMOTE_IDS = new Set(EMOTES.map((e) => e.id as string));

function isEmoteId(v: unknown): v is EmoteId {
  return typeof v === "string" && EMOTE_IDS.has(v);
}

/** Everything a client can put in `GameSettings`, clamped to something sane. */
function sanitiseSettings(raw: Partial<GameSettings> | undefined, base: GameSettings): GameSettings {
  const input = raw ?? {};
  const pairsRaw = Math.round(Number(input.pairs));
  const pairs = VALID_PAIRS.has(pairsRaw) ? pairsRaw : base.pairs;
  const mode = typeof input.mode === "string" && VALID_MODES.has(input.mode) ? input.mode : base.mode;

  return {
    pairs,
    mode,
    environmentId: safeId(input.environmentId, base.environmentId),
    symbolSetId: safeId(input.symbolSetId, base.symbolSetId),
    turnSeconds: clamp(Math.round(Number(input.turnSeconds ?? base.turnSeconds)) || 0, 0, 300),
    peekMs: clamp(Math.round(Number(input.peekMs ?? base.peekMs)) || base.peekMs, 300, 5000),
  };
}

/**
 * Environment and symbol-set ids are open-ended (Enterprise customers upload
 * their own), so validate shape rather than membership.
 */
function safeId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || !/^[\w.:-]+$/.test(trimmed)) return fallback;
  return trimmed;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function cleanName(raw: unknown): string {
  const stripped = String(raw ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  return (stripped || "Player").slice(0, MAX_NAME_LENGTH);
}

const AI_NAMES: Record<AiLevel, readonly string[]> = {
  easy: ["Bit", "Pixel", "Echo"],
  medium: ["Vector", "Cipher", "Prism"],
  expert: ["Oracle", "Nyx", "Halcyon"],
};

function aiName(room: { state: MatchState }, level: AiLevel): string {
  const pool = AI_NAMES[level] ?? AI_NAMES.medium;
  const taken = new Set(room.state.players.map((p) => p.name));
  for (const name of pool) if (!taken.has(name)) return name;
  for (let n = 2; n < 20; n++) {
    const name = `${pool[0]} ${n}`;
    if (!taken.has(name)) return name;
  }
  return pool[0];
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case "not-your-turn":
      return "It is not your turn.";
    case "already-up":
      return "That card is already face-up.";
    case "no-such-card":
      return "No such card.";
    case "resolve-pending":
      return "Wait for the current pair to resolve.";
    case "not-playing":
      return "You cannot flip right now.";
    default:
      return "Flip rejected.";
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

let idCounter = 0;

function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(3, "0")}${Math.floor(Math.random() * 0xfffff).toString(36)}`;
}

function newToken(): string {
  // Not a credential for anything but reclaiming one seat in one room, but it
  // still has to be unguessable by the player sitting next to you.
  return randomBytes(24).toString("base64url");
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
