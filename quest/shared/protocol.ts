/**
 * Wire protocol between the headset and the realtime server.
 *
 * The server is authoritative. It owns the deck and never sends a card's
 * symbol until that card has legitimately been turned over, so a modified
 * client cannot read the board out of a network trace — which matters as soon
 * as a leaderboard has a prize attached to it.
 */

import type { GameSettings, MatchResult, Phase } from "./game.ts";
import type { AiLevel } from "./editions.ts";

export const PROTOCOL_VERSION = 1;

/** Public view of a player — no secrets, safe to broadcast. */
export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  score: number;
  streak: number;
  isAi: boolean;
  aiLevel?: AiLevel;
  connected: boolean;
  out: boolean;
  isHost: boolean;
}

/** Public view of a card. `symbol` is null until the card is face-up. */
export interface CardView {
  index: number;
  symbol: number | null;
  faceUp: boolean;
  matched: boolean;
  matchedBy: number | null;
}

export interface RoomView {
  code: string;
  hostId: string;
  phase: Phase;
  settings: GameSettings;
  players: PlayerView[];
  cards: CardView[];
  turn: number;
  turnDeadline: number;
  startedAt: number;
  maxPlayers: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  pairs: number;
  mode: string;
  accuracy: number;
  /** Epoch ms. */
  at: number;
}

export type LeaderboardScope = "room" | "global" | "today";

// ── Client → Server ─────────────────────────────────────────────────────────

export type ClientMessage =
  | { t: "hello"; name: string; edition: string; protocol: number; resumeToken?: string }
  | { t: "createRoom"; settings: GameSettings; maxPlayers: number }
  | { t: "joinRoom"; code: string }
  | { t: "leaveRoom" }
  | { t: "updateSettings"; settings: Partial<GameSettings> }
  | { t: "addAi"; level: AiLevel }
  | { t: "removeAi"; playerId: string }
  | { t: "kick"; playerId: string }
  | { t: "startGame" }
  | { t: "flip"; index: number }
  | { t: "emote"; emote: EmoteId }
  | { t: "requestLeaderboard"; scope: LeaderboardScope }
  | { t: "ping"; at: number };

// ── Server → Client ─────────────────────────────────────────────────────────

export type ServerMessage =
  | { t: "welcome"; playerId: string; resumeToken: string; protocol: number; serverVersion: string }
  | { t: "roomState"; room: RoomView }
  | { t: "playerJoined"; player: PlayerView }
  | { t: "playerLeft"; playerId: string; reason: "left" | "kicked" | "dropped" }
  | { t: "settingsChanged"; settings: GameSettings }
  | { t: "countdown"; secondsLeft: number }
  | { t: "gameStarted"; room: RoomView }
  | { t: "revealed"; index: number; symbol: number; by: string }
  | { t: "matched"; indices: [number, number]; symbol: number; by: string; score: number; streak: number }
  | { t: "missed"; indices: [number, number]; by: string; hideAt: number }
  | { t: "hidden"; indices: number[] }
  | { t: "turnChanged"; playerId: string; seat: number; deadline: number }
  | { t: "gameOver"; result: MatchResult }
  | { t: "leaderboard"; scope: LeaderboardScope; entries: LeaderboardEntry[] }
  | { t: "emote"; playerId: string; emote: EmoteId }
  | { t: "error"; code: ErrorCode; message: string }
  | { t: "pong"; at: number; serverTime: number };

export type ErrorCode =
  | "bad-protocol"
  | "no-such-room"
  | "room-full"
  | "already-started"
  | "not-host"
  | "not-in-room"
  | "rate-limited"
  | "invalid"
  | "server-error";

/** Quick, readable reactions — a full chat box is unusable on a headset. */
export const EMOTES = [
  { id: "wave", label: "Wave", glyph: "◠" },
  { id: "nice", label: "Nice!", glyph: "★" },
  { id: "think", label: "Thinking", glyph: "◌" },
  { id: "laugh", label: "Ha!", glyph: "◡" },
  { id: "gg", label: "Good game", glyph: "◈" },
] as const;

export type EmoteId = (typeof EMOTES)[number]["id"];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/** Parses an untrusted frame. Returns null rather than throwing on garbage. */
export function decode<T extends ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && typeof v.t === "string" ? (v as T) : null;
  } catch {
    return null;
  }
}
