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

/**
 * PRICING
 *
 * All figures are CHF, excluding VAT, and every number a customer ever sees
 * comes from this one block — change it here and the app, the showcase page
 * and the sales copy all follow.
 *
 * The model is a content attach-on to a VRENT hardware rental, not standalone
 * software. That is deliberate: the customer is already committing CHF 450 to
 * CHF 6,000 for headsets, so the game is priced as a fraction of that spend
 * and scales with the size of their event rather than sitting on its own
 * price list where it would look expensive next to an app-store title.
 *
 * The per-event tiers mirror the four hardware packages, at a deliberately
 * declining attach rate — roughly 33% of hardware on the smallest package
 * down to 17% on the largest, because a fifty-headset event is already a big
 * commitment and should feel rewarded rather than taxed.
 *
 * Enterprise is a re-skin of a finished product, not ground-up development.
 * The market rate for a bespoke branded VR game starts around CHF 10,000 and
 * runs well past CHF 50,000; pricing the setup at CHF 4,900 undercuts that
 * decisively while still paying for the work, and is the single strongest
 * argument for buying a custom build rather than commissioning one.
 */
export interface PriceTier {
  /** Matches a VRENT hardware package where one applies. */
  id: string;
  label: string;
  detail: string;
  amount: number;
}

export interface EditionPricing {
  /** Short form for a pricing card, e.g. "from CHF 350". */
  headline: string;
  /** null means free or quote-only. */
  amount: number | null;
  currency: "CHF";
  /** e.g. "per event", "one-off". Empty when the headline carries it. */
  unit: string;
  /** One line of honest qualification shown under the headline. */
  note: string;
  /** Per-event tiers, sized to the hardware packages. */
  tiers?: readonly PriceTier[];
  /** Recurring option, where one exists. */
  recurring?: { amount: number; unit: string; note: string };
}

export const VAT_NOTE = "All prices in CHF, excluding VAT.";

export interface EditionSpec {
  id: EditionId;
  /** Shown in the headset and on the store listing. */
  name: string;
  tagline: string;
  /** Android package id — must stay stable forever once published. */
  packageId: string;
  /** Sales-facing one-liners for the vrent.ch showcase page. */
  sellingPoints: readonly string[];
  pricing: EditionPricing;
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
  pricing: {
    headline: "Included",
    amount: 0,
    currency: "CHF",
    unit: "",
    note: "Ships on every VRENT rental. No server, no signup, works with the wifi off.",
  },
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
  pricing: {
    headline: "from CHF 150",
    amount: 150,
    currency: "CHF",
    unit: "per event",
    note: "Priced against the headset package it runs on, so a bigger event pays a smaller share.",
    tiers: [
      { id: "bronze", label: "Bronze", detail: "up to 4 headsets", amount: 150 },
      { id: "silver", label: "Silver", detail: "up to 10 headsets", amount: 350 },
      { id: "gold", label: "Gold", detail: "up to 20 headsets", amount: 590 },
      { id: "platinum", label: "Platinum", detail: "up to 50 headsets", amount: 990 },
    ],
    recurring: {
      amount: 2400,
      unit: "per year",
      note: "Unlimited events. Pays for itself against three Silver events.",
    },
  },
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
  pricing: {
    headline: "from CHF 4,900",
    amount: 4900,
    currency: "CHF",
    unit: "one-off",
    note: "Your branding, your card artwork and three of your own 360 rooms, delivered as your own app.",
    recurring: {
      amount: 1800,
      unit: "per year",
      note: "Hosting, the multiplayer server, updates and support.",
    },
  },
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
