/**
 * Module boundaries.
 *
 * Each subsystem (engine, environment, board, netcode, AI, UI) is written
 * against these interfaces and nothing else, so any one of them can be
 * rewritten — or swapped for a customer-specific version — without touching
 * the others. `main.ts` is the only file that knows all of them exist.
 */

import type * as THREE from "three";
import type { EnvironmentSpec } from "../shared/environments.ts";
import type { AiLevel, EditionSpec } from "../shared/editions.ts";
import type { Card, GameSettings, MatchResult, MatchState, Player } from "../shared/game.ts";
import type { EmoteId, LeaderboardEntry, RoomView } from "../shared/protocol.ts";

// ── Engine ──────────────────────────────────────────────────────────────────

export type XrMode = "vr" | "ar" | "none";

export interface PointerState {
  /** Which input source: 0/1 are controllers or hands, -1 is the mouse. */
  id: number;
  /** World-space ray used for picking. */
  ray: THREE.Ray;
  /** True on the frame the trigger/pinch went down. */
  pressed: boolean;
  /** True while held. */
  held: boolean;
  /** True on the frame it was released. */
  released: boolean;
  /** Hand tracking rather than a controller. */
  isHand: boolean;
}

export interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Everything that should move with a recentre lives under here. */
  world: THREE.Group;
  clock: THREE.Clock;
  mode: XrMode;

  /** Registers a per-frame callback. Returns an unsubscribe function. */
  onFrame(fn: (dt: number, now: number) => void): () => void;
  /** Active pointers this frame — 0 (flat screen idle), 1 or 2. */
  pointers(): PointerState[];
  /** Short controller rumble; silently ignored on hands. */
  haptic(pointerId: number, intensity: number, ms: number): void;

  requestSession(mode: "vr" | "ar"): Promise<void>;
  endSession(): Promise<void>;
  /** Fires on session start/end with the new mode. */
  onModeChange(fn: (mode: XrMode) => void): () => void;
  /** Re-anchors the world so the board sits in front of where the user looks. */
  recentre(): void;

  dispose(): void;
}

// ── Environment ─────────────────────────────────────────────────────────────

export interface EnvironmentController {
  /** Swaps the active environment, cross-fading over ~600ms. */
  apply(spec: EnvironmentSpec): Promise<void>;
  current(): EnvironmentSpec | null;
  /** Per-frame animation for procedural scenes. */
  update(dt: number, now: number): void;
  dispose(): void;
}

// ── Board ───────────────────────────────────────────────────────────────────

export interface BoardEvents {
  /** A card was pointed at and selected. */
  onCardActivated(index: number): void;
  /** Hover changed, for audio and haptics. */
  onCardHovered(index: number | null): void;
}

export interface BoardController {
  group: THREE.Group;
  /** Builds (or rebuilds) the board for a new match. */
  build(settings: GameSettings, cards: readonly Card[]): void;
  /** Turns one card face-up, revealing `symbol`. */
  reveal(index: number, symbol: number): void;
  /** Turns cards face-down again. */
  hide(indices: readonly number[]): void;
  /** Match flourish in the given seat colour. */
  markMatched(indices: readonly number[], seat: number): void;
  /** Miss shake. */
  markMissed(indices: readonly number[]): void;
  /** Dims cards that are not currently actionable. */
  setInteractive(on: boolean): void;
  /** Ghost highlight showing where an AI is about to flip. */
  showIntent(index: number | null, seat: number): void;
  update(dt: number, now: number, pointers: readonly PointerState[]): void;
  /** Scales/positions the board to suit passthrough vs a large virtual room. */
  setPlacement(mode: "table" | "room"): void;
  dispose(): void;
}

// ── Netcode ─────────────────────────────────────────────────────────────────

export type NetStatus = "offline" | "connecting" | "online" | "reconnecting" | "failed";

export interface NetEvents {
  onStatus(status: NetStatus): void;
  onRoom(room: RoomView): void;
  onRevealed(index: number, symbol: number, byPlayerId: string): void;
  onMatched(indices: [number, number], byPlayerId: string, seat: number, streak: number): void;
  onMissed(indices: [number, number], byPlayerId: string, hideAt: number): void;
  onHidden(indices: number[]): void;
  onTurn(playerId: string, seat: number, deadline: number): void;
  onGameOver(result: MatchResult): void;
  onLeaderboard(entries: LeaderboardEntry[]): void;
  onEmote(playerId: string, emote: EmoteId): void;
  onError(code: string, message: string): void;
}

export interface NetClient {
  status(): NetStatus;
  /** Round-trip time in ms, for the connection pip. */
  latency(): number;
  selfId(): string | null;
  connect(name: string): Promise<void>;
  createRoom(settings: GameSettings, maxPlayers: number): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  updateSettings(patch: Partial<GameSettings>): void;
  addAi(level: AiLevel): void;
  removeAi(playerId: string): void;
  startGame(): void;
  flip(index: number): void;
  emote(emote: EmoteId): void;
  requestLeaderboard(scope: "room" | "global" | "today"): void;
  disconnect(): void;
}

// ── AI ──────────────────────────────────────────────────────────────────────

export interface AiOpponent {
  readonly playerId: string;
  readonly level: AiLevel;
  /** Called for every reveal the AI can see, so it can build its memory. */
  observe(index: number, symbol: number): void;
  /** Called when cards leave the board. */
  forget(indices: readonly number[]): void;
  /**
   * Decides the next flip. Resolves with a card index after a deliberate,
   * human-looking delay so the AI never feels like a script.
   */
  chooseFlip(state: MatchState, signal: AbortSignal): Promise<number>;
  reset(): void;
}

// ── Assistant ───────────────────────────────────────────────────────────────

export interface AssistantAnswer {
  text: string;
  /** Optional follow-up chips shown under the answer. */
  suggestions?: string[];
  /** Highlights a UI region while the answer is on screen. */
  highlight?: string;
  source: "offline" | "model";
}

export interface Assistant {
  /** Answers a free-form question. Never rejects — falls back offline. */
  ask(question: string, ctx: AssistantContext): Promise<AssistantAnswer>;
  /** The scripted first-run tour. */
  tour(): readonly { title: string; body: string; highlight?: string }[];
  /** Suggested questions for the current screen. */
  suggestionsFor(screen: string): readonly string[];
}

export interface AssistantContext {
  edition: EditionSpec;
  screen: string;
  inGame: boolean;
  settings: GameSettings;
  players: readonly Player[];
}
