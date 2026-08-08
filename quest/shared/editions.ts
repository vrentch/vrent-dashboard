/**
 * The three shipping editions.
 *
 * One codebase, three APKs. The edition is fixed at build time via
 * `VITE_EDITION` and gates features at runtime, so a Demo build physically
 * cannot unlock Pro behaviour by fiddling with local storage.
 *
 *   npm run build:demo | build:pro | build:enterprise
 */

export type EditionId = "demo" | "pro" | "enterprise";

export type AiLevel = "easy" | "medium" | "expert";

export interface EditionFeatures {
  /** Online multiplayer with room codes. */
  onlineMultiplayer: boolean;
  /** Maximum humans in one room (including the host). */
  maxPlayers: number;
  /** AI opponents can be added to a game. */
  aiOpponents: boolean;
  /** Which AI difficulties are selectable. */
  aiLevels: readonly AiLevel[];
  /** Passthrough / mixed-reality mode. */
  mixedReality: boolean;
  /** Environment ids the edition may use, or "all". */
  environments: readonly string[] | "all";
  /** Operator can load their own 360 panoramas at runtime. */
  custom360: boolean;
  /** Highest pair count offered in the board-size picker. */
  maxPairs: number;
  /** Scores post to the shared server leaderboard. */
  globalLeaderboard: boolean;
  /** AI assistant may call a hosted language model for free-form answers. */
  assistantLiveModel: boolean;
  /** Operator can restyle the app (logo, palette) from settings. */
  whiteLabel: boolean;
  /** Corner watermark shown in-headset. */
  watermark: boolean;
  /** Session auto-returns to the lobby after this many seconds (0 = never). */
  sessionLimitSec: number;
}

export interface EditionSpec {
  id: EditionId;
  /** Shown in the headset and on the store listing. */
  name: string;
  tagline: string;
  /** Android package id — must stay stable forever once published. */
  packageId: string;
  /** Sales-facing one-liners for the vrent.ch showcase page. */
  sellingPoints: readonly string[];
  features: EditionFeatures;
}

const DEMO: EditionSpec = {
  id: "demo",
  name: "VRENT Memory XR — Demo",
  tagline: "Play against the machine in 60 seconds.",
  packageId: "ch.vrent.memoryxr.demo",
  sellingPoints: [
    "Runs standalone — no server, no signup, no wifi needed",
    "Three AI opponents so a single visitor always has a game",
    "Three showcase environments plus passthrough",
  ],
  features: {
    onlineMultiplayer: false,
    maxPlayers: 1,
    aiOpponents: true,
    aiLevels: ["easy", "medium", "expert"],
    mixedReality: true,
    environments: ["passthrough", "neon-vault", "orbital-deck", "quantum-lab"],
    custom360: false,
    maxPairs: 12,
    globalLeaderboard: false,
    assistantLiveModel: false,
    whiteLabel: false,
    watermark: true,
    // A trade-show kiosk must free itself up for the next visitor.
    sessionLimitSec: 600,
  },
};

const PRO: EditionSpec = {
  id: "pro",
  name: "VRENT Memory XR",
  tagline: "Up to eight players, one room code.",
  packageId: "ch.vrent.memoryxr",
  sellingPoints: [
    "Eight players in one room, joining with a six-character code",
    "Every environment, plus full passthrough mixed reality",
    "Persistent leaderboard across sessions and headsets",
  ],
  features: {
    onlineMultiplayer: true,
    maxPlayers: 8,
    aiOpponents: true,
    aiLevels: ["easy", "medium", "expert"],
    mixedReality: true,
    environments: "all",
    custom360: false,
    maxPairs: 24,
    globalLeaderboard: true,
    assistantLiveModel: true,
    whiteLabel: false,
    watermark: false,
    sessionLimitSec: 0,
  },
};

const ENTERPRISE: EditionSpec = {
  id: "enterprise",
  name: "Memory XR",
  tagline: "Your brand, your rooms, your game.",
  // Rebuilt per customer with their own reverse-DNS id; this is the template.
  packageId: "ch.vrent.memoryxr.enterprise",
  sellingPoints: [
    "Your logo, palette and card artwork throughout",
    "Upload your own 360 photography as playable environments",
    "Private room codes and an exportable leaderboard",
  ],
  features: {
    onlineMultiplayer: true,
    maxPlayers: 8,
    aiOpponents: true,
    aiLevels: ["easy", "medium", "expert"],
    mixedReality: true,
    environments: "all",
    custom360: true,
    maxPairs: 24,
    globalLeaderboard: true,
    assistantLiveModel: true,
    whiteLabel: true,
    watermark: false,
    sessionLimitSec: 0,
  },
};

export const EDITIONS: Record<EditionId, EditionSpec> = {
  demo: DEMO,
  pro: PRO,
  enterprise: ENTERPRISE,
};

export function isEditionId(v: unknown): v is EditionId {
  return v === "demo" || v === "pro" || v === "enterprise";
}

/**
 * The edition this bundle was built as. Defaults to `pro` for `npm run dev`
 * so the full feature set is reachable while developing.
 */
export function resolveEdition(raw?: string | undefined): EditionSpec {
  return EDITIONS[isEditionId(raw) ? raw : "pro"];
}

export function allowsEnvironment(spec: EditionSpec, envId: string): boolean {
  const envs = spec.features.environments;
  return envs === "all" || envs.includes(envId);
}
