/**
 * The in-headset screens, and the façade `main.ts` talks to.
 *
 * The contract is deliberately one-way. `main.ts` pushes a screen and its props
 * in; the UI pushes intents back out through `onAction`. Nothing in this file
 * mutates game state, opens a socket or decides whether an action is legal — it
 * draws what it is given and reports what the player asked for. That is what
 * makes the whole surface swappable for a customer-specific build.
 *
 * Edition gating is data-driven: a control asks `lock(f => f.someFeature, why)`
 * and the answer is derived by walking `EDITIONS` for the cheapest edition that
 * turns the feature on. Add a feature to `shared/editions.ts` and the padlocks,
 * the badge wording and the upgrade sheet all follow automatically.
 */

import * as THREE from "three";
import { brand, palette, rgba, text as ink, tokens } from "../../shared/brand.ts";
import { EDITIONS, allowsEnvironment } from "../../shared/editions.ts";
import type { AiLevel, EditionFeatures, EditionSpec } from "../../shared/editions.ts";
import { ENVIRONMENTS } from "../../shared/environments.ts";
import type { EnvironmentSpec } from "../../shared/environments.ts";
import {
  BOARD_PRESETS,
  CODE_ALPHABET,
  GAME_MODES,
  isValidRoomCode,
  normaliseRoomCode,
  presetForPairs,
} from "../../shared/game.ts";
import type { GameMode, GameSettings, MatchResult } from "../../shared/game.ts";
import type { LeaderboardEntry, LeaderboardScope, PlayerView } from "../../shared/protocol.ts";
import type { AssistantAnswer, Engine, NetStatus, PointerState } from "../contracts.ts";
import type { Gfx, Rect } from "./panel.ts";
import {
  BACKDROP_ID,
  Panel,
  READ_DISTANCE,
  colsIn,
  cutBottom,
  cutLeft,
  cutRight,
  cutTop,
  gridIn,
  inset,
  rowsIn,
  theme,
} from "./panel.ts";
import type { IconName, LockInfo, SheetOptions, Tone } from "./widgets.ts";
import {
  CONTROL,
  avatar,
  button,
  chip,
  clamp,
  codeDisplay,
  codeSlots,
  connectionPip,
  divider,
  emptyState,
  formatAgo,
  formatDuration,
  header,
  icon,
  iconButton,
  initialsOf,
  keypad,
  listRow,
  lockBadge,
  notice,
  pager,
  seatColor,
  sectionLabel,
  segmented,
  sheet,
  slider,
  statTile,
  stepper,
  tag,
  toggle,
} from "./widgets.ts";
import { createHud } from "./hud.ts";
import type { Hud, HudAction } from "./hud.ts";
import { createToastLayer } from "./toast.ts";
import type { ToastLayer } from "./toast.ts";

// ── Screens and their props ─────────────────────────────────────────────────

export type ScreenId =
  | "home"
  | "host"
  | "join"
  | "environments"
  | "board"
  | "players"
  | "leaderboard"
  | "settings"
  | "assistant"
  | "results";

export interface HomeProps {
  playerName: string;
  settings: GameSettings;
  status: NetStatus;
  latencyMs: number;
  /** Shows "Resume match" instead of "Play solo". */
  canResume?: boolean;
}

export interface HostProps {
  code: string;
  players: readonly PlayerView[];
  maxPlayers: number;
  settings: GameSettings;
  /** The local user is the host and may start / kick / add AI. */
  isHost: boolean;
  status: NetStatus;
  /** Host pressed start and the countdown is running. */
  starting?: boolean;
  selfId?: string | null;
}

export type JoinStatus = "idle" | "checking" | "invalid" | "joined";

export interface JoinProps {
  /** Authoritative value. The UI mirrors it optimistically while typing. */
  code: string;
  status: JoinStatus;
  message?: string;
}

export interface EnvironmentsProps {
  selectedId: string;
  /** Enterprise runtime uploads, appended to the catalogue. */
  customs?: readonly EnvironmentSpec[];
}

export interface BoardProps {
  settings: GameSettings;
}

export interface PlayersProps {
  players: readonly PlayerView[];
  selfId: string | null;
  isHost: boolean;
  maxPlayers: number;
  /** Level shown in the "add opponent" control. */
  aiLevel: AiLevel;
}

export interface LeaderboardProps {
  scope: LeaderboardScope;
  entries: readonly LeaderboardEntry[];
  loading?: boolean;
}

export type UiToggleKey = "sound" | "haptics" | "comfortVignette" | "hints" | "showRays";

export interface SettingsProps {
  settings: GameSettings;
  toggles: Readonly<Record<UiToggleKey, boolean>>;
  placement: "table" | "room";
  symbolSets: readonly { id: string; name: string }[];
  version: string;
}

export interface AssistantTourStep {
  index: number;
  total: number;
  title: string;
  body: string;
}

export interface AssistantProps {
  question?: string;
  answer?: AssistantAnswer | null;
  busy?: boolean;
  suggestions: readonly string[];
  tour?: AssistantTourStep | null;
}

export interface ResultsProps {
  result: MatchResult;
  /** Seat colours and AI flags come from the room, not the result rows. */
  players: readonly PlayerView[];
  posted?: boolean;
}

export interface ScreenProps {
  home: HomeProps;
  host: HostProps;
  join: JoinProps;
  environments: EnvironmentsProps;
  board: BoardProps;
  players: PlayersProps;
  leaderboard: LeaderboardProps;
  settings: SettingsProps;
  assistant: AssistantProps;
  results: ResultsProps;
}

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * Everything the UI can ask for. Exhaustive by construction: `main.ts` switches
 * on `type` and TypeScript flags any case it forgot.
 */
export type UiAction =
  // Navigation
  | { type: "navigate"; screen: ScreenId }
  | { type: "back" }
  | { type: "closeMenu" }
  // Home
  | { type: "playSolo" }
  | { type: "resumeMatch" }
  | { type: "hostRoom" }
  | { type: "joinRoomIntent" }
  // Host / lobby
  | { type: "startGame" }
  | { type: "cancelRoom" }
  | { type: "setMaxPlayers"; maxPlayers: number }
  // Join
  | { type: "codeChanged"; code: string }
  | { type: "submitCode"; code: string }
  // Environments
  | { type: "selectEnvironment"; environmentId: string }
  | { type: "uploadPanorama" }
  // Board size and mode
  | { type: "setPairs"; pairs: number }
  | { type: "setMode"; mode: GameMode }
  // Players and AI
  | { type: "addAi"; level: AiLevel }
  | { type: "setAiLevel"; level: AiLevel }
  | { type: "removeAi"; playerId: string }
  | { type: "kickPlayer"; playerId: string }
  | { type: "setPlayerName"; name: string }
  // Leaderboard
  | { type: "setLeaderboardScope"; scope: LeaderboardScope }
  | { type: "refreshLeaderboard" }
  | { type: "postScore" }
  // Settings
  | { type: "setTurnSeconds"; seconds: number }
  | { type: "setPeekMs"; ms: number }
  | { type: "setSymbolSet"; symbolSetId: string }
  | { type: "setPlacement"; placement: "table" | "room" }
  | { type: "setToggle"; key: UiToggleKey; value: boolean }
  | { type: "recentre" }
  | { type: "exitXr" }
  | { type: "openWhiteLabel" }
  // Assistant
  | { type: "askAssistant"; question: string }
  | { type: "startTour" }
  | { type: "tourStep"; delta: number }
  | { type: "endTour" }
  // Results
  | { type: "playAgain" }
  | { type: "changeSetup" }
  | { type: "returnHome" }
  // In-game (forwarded from the HUD)
  | { type: "sendEmote"; emote: import("../../shared/protocol.ts").EmoteId }
  | { type: "openMenu" }
  // Sales surface
  | { type: "showUpgrade"; requires: string; reason: string };

// ── Façade ──────────────────────────────────────────────────────────────────

export interface UiDeps {
  edition: EditionSpec;
  /** Defaults to `engine.world` so a recentre carries the menu with it. */
  parent?: THREE.Object3D;
  anchor?: { y?: number; distance?: number; tilt?: number };
}

export interface Ui {
  readonly hud: Hud;
  readonly toasts: ToastLayer;
  readonly panel: Panel;
  show<K extends ScreenId>(screen: K, props: ScreenProps[K]): void;
  hide(): void;
  visible(): boolean;
  current(): ScreenId | null;
  update(dt: number, pointers: readonly PointerState[]): void;
  onAction(cb: (a: UiAction) => void): () => void;
  /** Draws an attention ring around a control id — used by the assistant. */
  setHighlight(id: string | null): void;
  /** Thumbstick / D-pad navigation for players not using a ray. */
  focusStep(delta: number): void;
  activateFocused(): void;
  dispose(): void;
}

const MENU_W = 1.0;
const MENU_H = 0.625;

const NAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NAME_MAX = 14;

export function createUi(engine: Engine, deps: UiDeps): Ui {
  const edition = deps.edition;
  const features = edition.features;
  const parent = deps.parent ?? engine.world;

  // ── Panel ───────────────────────────────────────────────────────────────

  const distance = deps.anchor?.distance ?? READ_DISTANCE;
  const panel = new Panel({
    width: MENU_W,
    height: MENU_H,
    // Bending to the reading distance keeps the far corners the same distance
    // from the eye as the centre — no soft edges, no head-turn parallax.
    curveRadius: distance,
    name: "vr-menu",
    renderOrder: 20,
    anisotropy: engine.renderer.capabilities.getMaxAnisotropy(),
    onHoverChange: (id, pointerId) => {
      if (id) engine.haptic(pointerId, 0.14, 12);
    },
    onPress: (_id, pointerId) => engine.haptic(pointerId, 0.5, 22),
  });
  panel.setPose(0, deps.anchor?.y ?? 1.32, -distance, deps.anchor?.tilt ?? -0.09);
  panel.setWatermark(features.watermark ? brand.name : null);
  parent.add(panel.group);
  panel.setVisible(false, false);

  const hud = createHud(engine, { parent, watermarkText: brand.name });
  const toasts = createToastLayer(engine);

  // ── State ───────────────────────────────────────────────────────────────

  const store: { [K in ScreenId]?: ScreenProps[K] } = {};
  let screen: ScreenId | null = null;
  const listeners = new Set<(a: UiAction) => void>();
  const emit = (a: UiAction) => listeners.forEach((l) => l(a));

  /** Local, optimistic mirror of the join code so typing feels instant. */
  let codeDraft = "";
  let lastCodeEmitted = "";
  let shakeT = 0;
  let lastJoinStatus: JoinStatus = "idle";

  let nameDraft: string | null = null;
  let envPage = 0;
  let lbPage = 0;
  let sheetSpec: (SheetOptions & { onPrimary?: () => void }) | null = null;

  const unhookHud = hud.onAction((a: HudAction) => emit(a));

  // ── Edition gating ──────────────────────────────────────────────────────

  const EDITION_LABEL: Record<string, string> = { demo: "Demo", pro: "Pro", enterprise: "Enterprise" };

  /**
   * Returns lock metadata when the current edition lacks the feature, naming
   * the cheapest edition that has it. Undefined means "available, draw it live".
   */
  function lock(pred: (f: EditionFeatures) => boolean, reason: string): LockInfo | undefined {
    if (pred(features)) return undefined;
    for (const id of ["pro", "enterprise"] as const) {
      if (pred(EDITIONS[id].features)) {
        return { requires: EDITION_LABEL[id], reason };
      }
    }
    return { requires: EDITION_LABEL.enterprise, reason };
  }

  function showLock(info: LockInfo, title: string): void {
    const target = Object.values(EDITIONS).find((e) => EDITION_LABEL[e.id] === info.requires);
    sheetSpec = {
      id: "lock",
      title: `${title} is in ${info.requires}`,
      body: info.reason,
      bullets: target?.sellingPoints ?? [],
      footnote: `${brand.website} · ${brand.contactEmail}`,
      primary: { id: "ok", label: "Got it" },
      tone: "warn",
    };
    emit({ type: "showUpgrade", requires: info.requires, reason: info.reason });
    panel.markDirty();
  }

  /** Runs `then` unless the control is locked, in which case it explains why. */
  function gate(clicked: boolean, locked: LockInfo | undefined, title: string, then: () => void): void {
    if (!clicked) return;
    if (locked) showLock(locked, title);
    else then();
  }

  // ── Navigation helpers ──────────────────────────────────────────────────

  function go(next: ScreenId): void {
    emit({ type: "navigate", screen: next });
  }

  // ── Screen switch ───────────────────────────────────────────────────────

  function render(g: Gfx): void {
    switch (screen) {
      case "home":
        renderHome(g);
        break;
      case "host":
        renderHost(g);
        break;
      case "join":
        renderJoin(g);
        break;
      case "environments":
        renderEnvironments(g);
        break;
      case "board":
        renderBoard(g);
        break;
      case "players":
        renderPlayers(g);
        break;
      case "leaderboard":
        renderLeaderboard(g);
        break;
      case "settings":
        renderSettings(g);
        break;
      case "assistant":
        renderAssistant(g);
        break;
      case "results":
        renderResults(g);
        break;
      default:
        break;
    }

    if (nameDraft !== null) renderNameEditor(g);
    if (sheetSpec) renderSheet(g);
  }

  function renderSheet(g: Gfx): void {
    if (!sheetSpec) return;
    const result = sheet(g, g.area, sheetSpec);
    if (result === "primary") {
      sheetSpec.onPrimary?.();
      sheetSpec = null;
      panel.markDirty();
    } else if (result === "secondary" || g.clicked(BACKDROP_ID)) {
      sheetSpec = null;
      panel.markDirty();
    }
  }

  // ── Home ────────────────────────────────────────────────────────────────

  function renderHome(g: Gfx): void {
    const p = store.home;
    if (!p) return;
    const area = g.area;

    // Brand block.
    brandMark(g, area.x + 4, area.y + 6, 54);
    g.text(edition.name, area.x + 78, area.y + 26, { role: "h1", color: theme.fg });
    g.text(edition.tagline, area.x + 80, area.y + 74, { role: "body", color: theme.fg2 });
    if (edition.id !== "pro") {
      tag(g, area.x + 78 + g.measure(edition.name, { role: "h1" }) + 18, area.y + 26, EDITION_LABEL[edition.id], "reward");
    }

    const [, below] = cutTop(area, 132, 20);
    const [cards, rest] = cutTop(below, 560, 24);
    const cells = gridIn(cards, 2, 2, 20);

    const onlineLock = lock((f) => f.onlineMultiplayer, "Room codes let up to eight headsets play the same board together.");
    const aiLock = lock((f) => f.aiOpponents, "AI opponents mean a single visitor always has a game.");

    gate(
      actionCard(g, cells[0], {
        id: "home:solo",
        title: p.canResume ? "Resume match" : "Play solo",
        body: p.canResume
          ? "Pick up where you left off."
          : `Against ${features.aiLevels.length} AI difficulties, no wifi needed.`,
        icon: "play",
        kind: "primary",
        locked: p.canResume ? undefined : aiLock,
        meta: `${p.settings.pairs} pairs · ${modeName(p.settings.mode)}`,
      }),
      p.canResume ? undefined : aiLock,
      "AI opponents",
      () => emit(p.canResume ? { type: "resumeMatch" } : { type: "playSolo" }),
    );

    gate(
      actionCard(g, cells[1], {
        id: "home:host",
        title: "Host a room",
        body: "Others join with a six-character code you read out.",
        icon: "globe",
        locked: onlineLock,
        meta: `Up to ${features.maxPlayers} player${features.maxPlayers === 1 ? "" : "s"}`,
      }),
      onlineLock,
      "Online multiplayer",
      () => emit({ type: "hostRoom" }),
    );

    gate(
      actionCard(g, cells[2], {
        id: "home:join",
        title: "Join a room",
        body: "Type the host's code on the floating keypad.",
        icon: "forward",
        locked: onlineLock,
      }),
      onlineLock,
      "Online multiplayer",
      () => emit({ type: "joinRoomIntent" }),
    );

    if (
      actionCard(g, cells[3], {
        id: "home:leaderboard",
        title: "Leaderboard",
        body: features.globalLeaderboard
          ? "Best runs across every session and headset."
          : "Best runs from this session.",
        icon: "trophy",
      })
    ) {
      go("leaderboard");
    }

    // Secondary navigation.
    const [chips, footer] = cutTop(rest, 74, 18);
    const chipCells = colsIn(chips, 5, 12);
    const quick: { id: ScreenId; label: string }[] = [
      { id: "environments", label: "Environment" },
      { id: "board", label: "Board & mode" },
      { id: "players", label: "Players" },
      { id: "settings", label: "Settings" },
      { id: "assistant", label: "Help" },
    ];
    quick.forEach((q, i) => {
      if (chip(g, chipCells[i], { id: `home:nav:${q.id}`, label: q.label })) go(q.id);
    });

    divider(g, footer.x, footer.y - 2, footer.w);
    connectionPip(g, footer.x, footer.y + 32, p.status, p.latencyMs);
    g.text(p.playerName, footer.x + footer.w, footer.y + 32, {
      role: "caption",
      align: "right",
      color: theme.fg2,
    });
    icon(g, "person", footer.x + footer.w - g.measure(p.playerName, { role: "caption" }) - 20, footer.y + 32, 18, theme.fgMuted, 2);
  }

  // ── Host ────────────────────────────────────────────────────────────────

  function renderHost(g: Gfx): void {
    const p = store.host;
    if (!p) return;

    const body = header(g, g.area, {
      title: "Room open",
      backId: "host:back",
      meta: p.starting ? "Starting…" : `${p.players.length} of ${p.maxPlayers} joined`,
      metaColor: p.starting ? palette.accent : theme.fgMuted,
    });
    if (g.clicked("host:back")) emit({ type: "back" });

    // The code. Nothing else on this screen competes with it.
    const [codeRect, afterCode] = cutTop(body, 236, 6);
    codeDisplay(g, codeRect, p.code);
    g.text("Read this out, or have players type it in the app.", codeRect.x + codeRect.w / 2, codeRect.y + codeRect.h + 20, {
      role: "body",
      align: "centre",
      color: theme.fg2,
    });

    const [, afterCaption] = cutTop(afterCode, 44, 14);
    divider(g, afterCaption.x, afterCaption.y - 8, afterCaption.w);

    // Roster.
    const [roster, bottom] = cutTop(afterCaption, 252, 16);
    sectionLabel(g, roster.x, roster.y + 4, "In this room", `${p.players.length}/${p.maxPlayers}`, roster.w);
    const rosterBody: Rect = { x: roster.x, y: roster.y + 26, w: roster.w, h: roster.h - 26 };
    const slots = gridIn(rosterBody, 2, 4, 16, 8);

    for (let i = 0; i < Math.min(8, p.maxPlayers); i++) {
      const cell = slots[i];
      if (!cell) continue;
      const player = p.players[i];
      if (player) {
        if (playerRow(g, cell, { id: `host:p${i}`, player, canKick: p.isHost && player.id !== p.selfId, selfId: p.selfId ?? null })) {
          emit(player.isAi ? { type: "removeAi", playerId: player.id } : { type: "kickPlayer", playerId: player.id });
        }
      } else {
        emptySeat(g, cell, i);
      }
    }

    // Room size, then the action bar.
    const [bar, aboveBar] = cutBottom(bottom, CONTROL.h, 18);
    const [sizeCell] = cutLeft(aboveBar, 420, 20);
    const nextMax = stepper(g, { x: sizeCell.x, y: sizeCell.y, w: sizeCell.w, h: CONTROL.h }, {
      id: "host:maxplayers",
      label: "Room size",
      hint: "Seats held open for humans",
      value: p.maxPlayers,
      min: Math.max(2, p.players.filter((x) => !x.isAi).length),
      max: features.maxPlayers,
      disabled: !p.isHost,
    });
    if (nextMax !== null) emit({ type: "setMaxPlayers", maxPlayers: nextMax });
    const [startBtn, left] = cutRight(bar, 320, 20);
    const aiLock = lock((f) => f.aiOpponents, "AI opponents fill empty seats so a demo never waits for a second person.");
    const full = p.players.length >= p.maxPlayers;

    const [addBtn, levelSeg] = cutRight(left, 240, 12);
    const levels = features.aiLevels.length ? features.aiLevels : (["medium"] as readonly AiLevel[]);
    const chosen = pickedAiLevel(levels);
    const nextLevel = segmented(g, levelSeg, {
      id: "host:ailevel",
      value: chosen,
      compact: true,
      options: levels.map((l) => ({ id: l, label: aiLevelName(l) })),
    });
    if (nextLevel) {
      aiLevelChoice = nextLevel;
      emit({ type: "setAiLevel", level: nextLevel });
    }
    gate(
      button(g, addBtn, {
        id: "host:addai",
        label: "Add opponent",
        icon: "ai",
        locked: aiLock,
        disabled: !p.isHost || full,
      }),
      aiLock,
      "AI opponents",
      () => emit({ type: "addAi", level: chosen }),
    );

    const canStart = p.isHost && p.players.length >= 1 && !p.starting;
    if (
      button(g, startBtn, {
        id: "host:start",
        label: p.starting ? "Starting" : "Start game",
        kind: "primary",
        icon: "play",
        disabled: !canStart,
        busy: p.starting,
      })
    ) {
      emit({ type: "startGame" });
    }

    if (!p.isHost) {
      g.text("The host starts the match.", bar.x, bar.y - 22, { role: "caption", color: theme.fgMuted });
    }
  }

  let aiLevelChoice: AiLevel | null = null;
  function pickedAiLevel(levels: readonly AiLevel[]): AiLevel {
    if (aiLevelChoice && levels.includes(aiLevelChoice)) return aiLevelChoice;
    return levels.includes("medium") ? "medium" : levels[0];
  }

  // ── Join ────────────────────────────────────────────────────────────────

  function renderJoin(g: Gfx): void {
    const p = store.join;
    if (!p) return;

    const value = codeDraft;
    const valid = isValidRoomCode(value);

    const body = header(g, g.area, {
      title: "Join a room",
      backId: "join:back",
      meta: `${value.length} of 6`,
    });
    if (g.clicked("join:back")) emit({ type: "back" });

    const [slots, afterSlots] = cutTop(body, 138, 16);
    codeSlots(g, slots, value, { status: p.status, shake: shakeT });

    // Status line. Always icon + words, so the state survives any colour issue.
    const [status, keys] = cutTop(afterSlots, 66, 18);
    if (p.status === "invalid") {
      notice(g, status, { tone: "danger", text: p.message ?? "No room with that code", detail: "Check with the host and try again." });
    } else if (p.status === "checking") {
      notice(g, status, { tone: "info", text: "Checking that code…" });
    } else if (p.status === "joined") {
      notice(g, status, { tone: "success", text: "Joined", detail: "Taking you to the room." });
    } else {
      g.text(
        "Codes use no vowels and no O, 0, I, 1 or L — if you heard one, it is not on the keypad.",
        status.x,
        status.y + status.h / 2,
        { role: "caption", color: theme.fgMuted, maxWidth: status.w },
      );
    }

    const busy = p.status === "checking" || p.status === "joined";
    const press = keypad(g, keys, {
      id: "join:pad",
      alphabet: CODE_ALPHABET,
      cols: 7,
      disabled: busy,
      extras: [
        { id: "clear", label: "Clear", disabled: busy || value.length === 0 },
        { id: "back", icon: "backspace", disabled: busy || value.length === 0 },
        { id: "join", label: busy ? "Joining…" : "Join room", kind: "primary", wide: 2.4, disabled: !valid || busy },
      ],
    });

    if (press) {
      if (press.kind === "char" && value.length < 6) setCode(value + press.char);
      else if (press.kind === "extra" && press.id === "back") setCode(value.slice(0, -1));
      else if (press.kind === "extra" && press.id === "clear") setCode("");
      else if (press.kind === "extra" && press.id === "join" && valid) emit({ type: "submitCode", code: value });
    }
  }

  function setCode(next: string): void {
    const clean = normaliseRoomCode(next);
    if (clean === codeDraft) return;
    codeDraft = clean;
    lastCodeEmitted = clean;
    emit({ type: "codeChanged", code: clean });
    panel.markDirty();
  }

  // ── Environments ────────────────────────────────────────────────────────

  function renderEnvironments(g: Gfx): void {
    const p = store.environments;
    if (!p) return;

    const catalogue: EnvironmentSpec[] = [...ENVIRONMENTS, ...(p.customs ?? [])];
    const perPage = 6;
    const pages = Math.max(1, Math.ceil((catalogue.length + (features.custom360 ? 1 : 1)) / perPage));
    envPage = clamp(envPage, 0, pages - 1);

    const body = header(g, g.area, {
      title: "Environment",
      subtitle: "Where the board lives. Passthrough keeps your real room visible.",
      backId: "env:back",
    });
    if (g.clicked("env:back")) emit({ type: "back" });

    const [grid, foot] = cutBottom(body, 66, 14);
    const cells = gridIn(grid, 3, 2, 18);

    const start = envPage * perPage;
    for (let i = 0; i < perPage; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const spec = catalogue[start + i];
      if (!spec) {
        // Last tile on the last page offers the upload slot.
        if (start + i === catalogue.length) renderUploadCard(g, cell);
        continue;
      }
      const allowed = allowsEnvironment(edition, spec.id) || (p.customs ?? []).some((c) => c.id === spec.id);
      const locked = allowed
        ? undefined
        : lock(() => false, `"${spec.name}" is one of the environments included with the full catalogue.`);
      const selected = spec.id === p.selectedId;

      if (envCard(g, cell, { id: `env:${spec.id}`, spec, selected, locked })) {
        if (locked) showLock(locked, spec.name);
        else emit({ type: "selectEnvironment", environmentId: spec.id });
      }
    }

    const next = pager(g, foot, {
      id: "env:pager",
      page: envPage,
      pages,
      caption: `${catalogue.length} environments · page ${envPage + 1} of ${pages}`,
    });
    if (next !== null) {
      envPage = next;
      panel.markDirty();
    }
  }

  function renderUploadCard(g: Gfx, r: Rect): void {
    const customLock = lock((f) => f.custom360, "Load your own 360° photography as a playable room — your showroom, your site, your event space.");
    const st = g.state("env:upload");
    g.save();
    g.ctx.setLineDash([9, 9]);
    g.strokeRound(r, tokens.radius.lg, st.hover ? rgba(palette.accent, 0.7) : theme.lineStrong, 2);
    g.ctx.setLineDash([]);
    g.restore();
    icon(g, "upload", r.x + r.w / 2, r.y + r.h / 2 - 34, 42, customLock ? theme.fgMuted : palette.accent, 2.6);
    g.text("Add your own 360°", r.x + r.w / 2, r.y + r.h / 2 + 22, {
      role: "bodyStrong",
      align: "centre",
      color: customLock ? theme.fgMuted : theme.fg,
    });
    if (customLock) lockBadge(g, r.x + r.w / 2 - 46, r.y + r.h / 2 + 60, customLock.requires);
    g.hit({ id: "env:upload", rect: r });
    if (g.clicked("env:upload")) {
      if (customLock) showLock(customLock, "Custom 360° environments");
      else emit({ type: "uploadPanorama" });
    }
  }

  // ── Board size & mode ───────────────────────────────────────────────────

  function renderBoard(g: Gfx): void {
    const p = store.board;
    if (!p) return;

    const body = header(g, g.area, {
      title: "Board & mode",
      subtitle: "Bigger boards are harder to hold in memory, not just longer.",
      backId: "board:back",
    });
    if (g.clicked("board:back")) emit({ type: "back" });

    // Mode.
    const [modeRow, afterMode] = cutTop(body, CONTROL.h, 12);
    const nextMode = segmented(g, modeRow, {
      id: "board:mode",
      value: p.settings.mode,
      options: GAME_MODES.map((m) => ({ id: m.id, label: m.name })),
    });
    if (nextMode) emit({ type: "setMode", mode: nextMode });

    const blurb = GAME_MODES.find((m) => m.id === p.settings.mode)?.blurb ?? "";
    const [blurbRow, afterBlurb] = cutTop(afterMode, 40, 16);
    g.text(blurb, blurbRow.x, blurbRow.y + 16, { role: "caption", color: theme.fgMuted });

    divider(g, afterBlurb.x, afterBlurb.y - 6, afterBlurb.w);
    const [, afterRule] = cutTop(afterBlurb, 12, 8);

    sectionLabel(g, afterRule.x, afterRule.y + 8, "Board size", `Up to ${features.maxPairs} pairs`, afterRule.w);
    const [, gridArea] = cutTop(afterRule, 34, 12);
    const cells = gridIn(gridArea, 4, 2, 16);

    BOARD_PRESETS.forEach((preset, i) => {
      const cell = cells[i];
      if (!cell) return;
      const allowed = preset.pairs <= features.maxPairs;
      const locked = allowed
        ? undefined
        : lock((f) => f.maxPairs >= preset.pairs, `Boards up to ${preset.pairs} pairs need the larger card set.`);
      const selected = preset.pairs === p.settings.pairs;
      if (boardCard(g, cell, { id: `board:${preset.pairs}`, preset, selected, locked })) {
        if (locked) showLock(locked, `${preset.label} boards`);
        else emit({ type: "setPairs", pairs: preset.pairs });
      }
    });
  }

  // ── Players ─────────────────────────────────────────────────────────────

  function renderPlayers(g: Gfx): void {
    const p = store.players;
    if (!p) return;

    const body = header(g, g.area, {
      title: "Players",
      backId: "players:back",
      meta: `${p.players.length} of ${p.maxPlayers}`,
    });
    if (g.clicked("players:back")) emit({ type: "back" });

    const [rosterArea, bottom] = cutTop(body, 372, 18);
    const slots = gridIn(rosterArea, 2, 4, 16, 8);
    for (let i = 0; i < Math.min(8, p.maxPlayers); i++) {
      const cell = slots[i];
      if (!cell) continue;
      const player = p.players[i];
      if (player) {
        if (playerRow(g, cell, { id: `players:p${i}`, player, canKick: p.isHost && player.id !== p.selfId, selfId: p.selfId })) {
          emit(player.isAi ? { type: "removeAi", playerId: player.id } : { type: "kickPlayer", playerId: player.id });
        }
      } else {
        emptySeat(g, cell, i);
      }
    }

    divider(g, bottom.x, bottom.y - 8, bottom.w);

    // Your name.
    const [nameRow, aiArea] = cutTop(bottom, CONTROL.h, 18);
    const me = p.players.find((x) => x.id === p.selfId);
    const [renameBtn, nameLabel] = cutRight(nameRow, 180, 14);
    g.fillRound(nameLabel, CONTROL.radius, theme.card);
    g.strokeRound(nameLabel, CONTROL.radius, theme.line);
    g.text("YOU", nameLabel.x + CONTROL.pad, nameLabel.y + nameLabel.h / 2, {
      role: "label",
      color: theme.fgMuted,
      upper: true,
    });
    g.text(me?.name ?? "Player", nameLabel.x + CONTROL.pad + 74, nameLabel.y + nameLabel.h / 2 + 1, {
      role: "h3",
      color: theme.fg,
      maxWidth: nameLabel.w - 200,
    });
    if (button(g, renameBtn, { id: "players:rename", label: "Change name", kind: "ghost" })) {
      nameDraft = me?.name ?? "";
      panel.markDirty();
    }

    // AI opponents.
    const aiLock = lock((f) => f.aiOpponents, "AI opponents fill empty seats so a single visitor always has a game.");
    const levels = features.aiLevels.length ? features.aiLevels : (["medium"] as readonly AiLevel[]);
    sectionLabel(g, aiArea.x, aiArea.y + 6, "AI opponents", `${p.players.filter((x) => x.isAi).length} in room`, aiArea.w);

    const [row] = cutTop(aiArea, CONTROL.h, 0);
    const controls: Rect = { x: row.x, y: row.y + 30, w: row.w, h: CONTROL.h };
    const [addBtn, levelSeg] = cutRight(controls, 250, 14);
    const nextLevel = segmented(g, levelSeg, {
      id: "players:ailevel",
      value: p.aiLevel,
      options: levels.map((l) => ({ id: l, label: aiLevelName(l) })),
    });
    if (nextLevel) emit({ type: "setAiLevel", level: nextLevel });
    gate(
      button(g, addBtn, {
        id: "players:addai",
        label: "Add opponent",
        icon: "plus",
        kind: "primary",
        locked: aiLock,
        disabled: p.players.length >= p.maxPlayers,
      }),
      aiLock,
      "AI opponents",
      () => emit({ type: "addAi", level: p.aiLevel }),
    );
  }

  // ── Name editor overlay ─────────────────────────────────────────────────

  function renderNameEditor(g: Gfx): void {
    if (nameDraft === null) return;
    g.beginModal();
    g.save();
    g.alpha(0.94);
    g.fillRound(g.bounds, tokens.radius.lg, theme.scrim);
    g.restore();

    const card = inset(g.area, 10);
    g.fillRound(card, tokens.radius.lg, palette.surface);
    g.strokeRound(card, tokens.radius.lg, theme.lineStrong);

    const body = inset(card, 30);
    const [field, rest] = cutTop(body, 92, 16);
    g.text("YOUR NAME", field.x, field.y + 14, { role: "label", color: theme.fgMuted, upper: true });
    const box: Rect = { x: field.x, y: field.y + 30, w: field.w, h: 62 };
    g.fillRound(box, CONTROL.radius, rgba(palette.ink, 0.6));
    g.strokeRound(box, CONTROL.radius, palette.accent, 2);
    g.text(nameDraft || "…", box.x + 20, box.y + box.h / 2 + 1, {
      role: "h2",
      color: nameDraft ? theme.fg : theme.fgMuted,
      maxWidth: box.w - 140,
    });
    g.text(`${nameDraft.length}/${NAME_MAX}`, box.x + box.w - 20, box.y + box.h / 2 + 1, {
      role: "caption",
      align: "right",
      color: theme.fgMuted,
    });

    const press = keypad(g, rest, {
      id: "name:pad",
      alphabet: NAME_ALPHABET,
      cols: 9,
      extras: [
        { id: "space", label: "Space", wide: 1.6 },
        { id: "back", icon: "backspace" },
        { id: "cancel", label: "Cancel" },
        { id: "save", label: "Save name", kind: "primary", wide: 1.8, disabled: nameDraft.trim().length === 0 },
      ],
    });

    if (!press) return;
    if (press.kind === "char") {
      if (nameDraft.length < NAME_MAX) nameDraft += press.char;
    } else if (press.id === "space") {
      if (nameDraft.length < NAME_MAX && nameDraft.length > 0) nameDraft += " ";
    } else if (press.id === "back") {
      nameDraft = nameDraft.slice(0, -1);
    } else if (press.id === "cancel") {
      nameDraft = null;
    } else if (press.id === "save") {
      emit({ type: "setPlayerName", name: titleCase(nameDraft.trim()) });
      nameDraft = null;
    }
    panel.markDirty();
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────

  function renderLeaderboard(g: Gfx): void {
    const p = store.leaderboard;
    if (!p) return;

    const body = header(g, g.area, {
      title: "Leaderboard",
      backId: "lb:back",
    });
    if (g.clicked("lb:back")) emit({ type: "back" });

    const globalLock = lock((f) => f.globalLeaderboard, "Scores sync to a shared board across every session and headset you run.");

    const [scopeRow, afterScope] = cutTop(body, CONTROL.h, 16);
    const [refreshBtn, scopeSeg] = cutRight(scopeRow, CONTROL.h, 14);
    const nextScope = segmented<LeaderboardScope>(g, scopeSeg, {
      id: "lb:scope",
      value: p.scope,
      options: [
        { id: "room", label: "This room" },
        { id: "today", label: "Today", locked: globalLock },
        { id: "global", label: "All time", locked: globalLock },
      ],
    });
    if (nextScope) {
      if ((nextScope === "global" || nextScope === "today") && globalLock) showLock(globalLock, "The shared leaderboard");
      else {
        lbPage = 0;
        emit({ type: "setLeaderboardScope", scope: nextScope });
      }
    }
    if (iconButton(g, refreshBtn, { id: "lb:refresh", icon: "refresh", label: "Refresh" })) {
      emit({ type: "refreshLeaderboard" });
    }

    const perPage = 7;
    const pages = Math.max(1, Math.ceil(p.entries.length / perPage));
    lbPage = clamp(lbPage, 0, pages - 1);

    const [table, foot] = cutBottom(afterScope, 66, 12);

    if (p.entries.length === 0) {
      emptyState(g, table, {
        icon: "trophy",
        title: p.loading ? "Loading scores…" : "No scores yet",
        body: p.loading ? "Fetching the board." : "Finish a match and the first entry will be yours.",
      });
      return;
    }

    // Column header.
    const colX = tableColumns(table);
    g.text("#", colX.rank, table.y + 12, { role: "label", color: theme.fgMuted });
    g.text("PLAYER", colX.name, table.y + 12, { role: "label", color: theme.fgMuted, upper: true });
    g.text("BOARD", colX.board, table.y + 12, { role: "label", color: theme.fgMuted, upper: true, align: "right" });
    g.text("ACC", colX.acc, table.y + 12, { role: "label", color: theme.fgMuted, upper: true, align: "right" });
    g.text("SCORE", colX.score, table.y + 12, { role: "label", color: theme.fgMuted, upper: true, align: "right" });
    g.hairline(table.x, table.y + 30, table.x + table.w, table.y + 30);

    const rowsArea: Rect = { x: table.x, y: table.y + 38, w: table.w, h: table.h - 38 };
    const rows = rowsIn(rowsArea, perPage, 6);
    const slice = p.entries.slice(lbPage * perPage, lbPage * perPage + perPage);
    slice.forEach((entry, i) => leaderboardRow(g, rows[i], entry, colX));

    const next = pager(g, foot, {
      id: "lb:pager",
      page: lbPage,
      pages,
      caption: `${p.entries.length} result${p.entries.length === 1 ? "" : "s"}`,
    });
    if (next !== null) {
      lbPage = next;
      panel.markDirty();
    }
  }

  function tableColumns(r: Rect): { rank: number; name: number; board: number; acc: number; score: number } {
    return {
      rank: r.x + 12,
      name: r.x + 74,
      board: r.x + r.w - 430,
      acc: r.x + r.w - 250,
      score: r.x + r.w - 16,
    };
  }

  function leaderboardRow(
    g: Gfx,
    r: Rect,
    e: LeaderboardEntry,
    col: { rank: number; name: number; board: number; acc: number; score: number },
  ): void {
    const podium = e.rank <= 3;
    const medal = e.rank === 1 ? palette.reward : e.rank === 2 ? ink.secondary : palette.accent;
    g.fillRound(r, CONTROL.radius, podium ? rgba(medal, 0.1) : rgba(palette.ink, 0.34));
    g.strokeRound(r, CONTROL.radius, podium ? rgba(medal, 0.4) : theme.lineFaint);

    if (podium) {
      g.circle(col.rank + 16, r.y + r.h / 2, 20, rgba(medal, 0.2));
      g.ring(col.rank + 16, r.y + r.h / 2, 20, medal, 2);
    }
    g.text(String(e.rank), col.rank + 16, r.y + r.h / 2 + 1, {
      role: "bodyStrong",
      align: "centre",
      color: podium ? medal : theme.fgMuted,
    });

    g.text(e.name, col.name, r.y + r.h * 0.36, { role: "bodyStrong", color: theme.fg, maxWidth: col.board - col.name - 30 });
    g.text(formatAgo(e.at), col.name, r.y + r.h * 0.72, { role: "caption", color: theme.fgMuted });

    g.text(`${e.pairs} pairs`, col.board, r.y + r.h * 0.36, { role: "caption", align: "right", color: theme.fg2 });
    g.text(e.mode, col.board, r.y + r.h * 0.72, { role: "caption", align: "right", color: theme.fgMuted });

    g.text(`${Math.round(e.accuracy * 100)}%`, col.acc, r.y + r.h / 2 + 1, { role: "body", align: "right", color: theme.fg2 });
    g.text(String(e.score), col.score, r.y + r.h / 2 + 1, {
      role: "h3",
      align: "right",
      color: podium ? medal : theme.fg,
    });
  }

  // ── Settings ────────────────────────────────────────────────────────────

  function renderSettings(g: Gfx): void {
    const p = store.settings;
    if (!p) return;

    const body = header(g, g.area, { title: "Settings", backId: "set:back" });
    if (g.clicked("set:back")) emit({ type: "back" });

    const [left, right] = colsIn(body, 2, 34);
    g.hairline(left.x + left.w + 17, left.y, left.x + left.w + 17, left.y + left.h - 70);

    // ── Left column: the match ──
    let y = left.y;
    sectionLabel(g, left.x, y + 8, "Match");
    y += 34;

    const turn = slider(g, { x: left.x, y, w: left.w, h: 112 }, {
      id: "set:turn",
      label: "Turn timer",
      value: p.settings.turnSeconds,
      min: 0,
      max: 60,
      step: 5,
      hint: "0 turns the clock off entirely.",
      format: (v) => (v === 0 ? "Off" : `${v}s`),
    });
    if (turn !== null) emit({ type: "setTurnSeconds", seconds: turn });
    y += 128;

    const peek = slider(g, { x: left.x, y, w: left.w, h: 112 }, {
      id: "set:peek",
      label: "Mismatch peek",
      value: p.settings.peekMs,
      min: 600,
      max: 2400,
      step: 100,
      hint: "How long a wrong pair stays face-up.",
      format: (v) => `${(v / 1000).toFixed(1)}s`,
    });
    if (peek !== null) emit({ type: "setPeekMs", ms: peek });
    y += 132;

    if (p.symbolSets.length > 1) {
      g.text("Card faces", left.x, y + 12, { role: "bodyStrong", color: theme.fg });
      const nextSet = segmented(g, { x: left.x, y: y + 32, w: left.w, h: CONTROL.hSmall }, {
        id: "set:symbols",
        value: p.settings.symbolSetId,
        compact: true,
        options: p.symbolSets.map((s) => ({ id: s.id, label: s.name })),
      });
      if (nextSet) emit({ type: "setSymbolSet", symbolSetId: nextSet });
      y += 32 + CONTROL.hSmall + 18;
    }

    g.text("Board placement", left.x, y + 12, { role: "bodyStrong", color: theme.fg });
    const nextPlacement = segmented<"table" | "room">(g, { x: left.x, y: y + 32, w: left.w, h: CONTROL.hSmall }, {
      id: "set:placement",
      value: p.placement,
      compact: true,
      options: [
        { id: "table", label: "On a table" },
        { id: "room", label: "Room scale" },
      ],
    });
    if (nextPlacement) emit({ type: "setPlacement", placement: nextPlacement });

    // ── Right column: comfort and system ──
    let ry = right.y;
    sectionLabel(g, right.x, ry + 8, "Comfort & system");
    ry += 34;

    const toggles: { key: UiToggleKey; label: string; hint: string; icon: IconName }[] = [
      { key: "sound", label: "Sound", hint: "Flips, matches and turn cues.", icon: "sound" },
      { key: "haptics", label: "Controller haptics", hint: "A tick when a ray meets a control.", icon: "haptics" },
      { key: "comfortVignette", label: "Comfort vignette", hint: "Softens the edges during movement.", icon: "eye" },
      { key: "hints", label: "Show hints", hint: "First-run tips and control labels.", icon: "spark" },
    ];
    for (const t of toggles) {
      if (toggle(g, { x: right.x, y: ry, w: right.w, h: CONTROL.h }, {
        id: `set:${t.key}`,
        label: t.label,
        hint: t.hint,
        icon: t.icon,
        value: p.toggles[t.key],
      })) {
        emit({ type: "setToggle", key: t.key, value: !p.toggles[t.key] });
      }
      ry += CONTROL.h + 10;
    }

    const whiteLabelLock = lock((f) => f.whiteLabel, "Swap the logo, palette and card artwork for your own, from inside the headset.");
    gate(
      listRow(g, { x: right.x, y: ry, w: right.w, h: CONTROL.h }, {
        id: "set:whitelabel",
        title: "Branding",
        subtitle: "Logo, palette and card artwork",
        icon: "layers",
        locked: whiteLabelLock,
        chevron: !whiteLabelLock,
      }),
      whiteLabelLock,
      "Custom branding",
      () => emit({ type: "openWhiteLabel" }),
    );
    ry += CONTROL.h + 16;

    const [footRow] = cutBottom(right, CONTROL.h, 0);
    const [exitBtn, recentreBtn] = cutRight(footRow, 200, 12);
    if (button(g, recentreBtn, { id: "set:recentre", label: "Recentre view", icon: "refresh", kind: "ghost" })) {
      emit({ type: "recentre" });
    }
    if (button(g, exitBtn, { id: "set:exit", label: "Exit", icon: "exit", kind: "danger" })) {
      emit({ type: "exitXr" });
    }

    g.text(`${edition.name} · v${p.version} · ${brand.website}`, body.x, body.y + body.h - 8, {
      role: "caption",
      color: theme.fgMuted,
      baseline: "alphabetic",
    });
  }

  // ── Assistant ───────────────────────────────────────────────────────────

  function renderAssistant(g: Gfx): void {
    const p = store.assistant;
    if (!p) return;

    const body = header(g, g.area, {
      title: p.tour ? "Getting started" : "Assistant",
      backId: "as:back",
      meta: p.tour ? `Step ${p.tour.index + 1} of ${p.tour.total}` : undefined,
    });
    if (g.clicked("as:back")) emit({ type: "back" });

    if (p.tour) {
      renderTour(g, body, p.tour);
      return;
    }

    const [answerArea, rest] = cutTop(body, 452, 20);
    g.fillRound(answerArea, tokens.radius.lg, rgba(palette.ink, 0.4));
    g.strokeRound(answerArea, tokens.radius.lg, theme.line);
    const inner = inset(answerArea, 32);

    if (p.question) {
      icon(g, "person", inner.x + 12, inner.y + 12, 20, theme.fgMuted, 2.2);
      g.text(p.question, inner.x + 36, inner.y + 12, { role: "caption", color: theme.fgMuted, maxWidth: inner.w - 44 });
      g.hairline(inner.x, inner.y + 36, inner.x + inner.w, inner.y + 36);
    }

    const answerTop = inner.y + (p.question ? 56 : 6);
    if (p.busy) {
      g.text("Thinking…", inner.x, answerTop + 20, { role: "h3", color: theme.fg2 });
    } else if (p.answer) {
      // Deliberately no provenance marker. Most answers at a trade show come
      // from the built-in script, and an "offline" badge would make the product
      // look degraded for the exact case it is designed to handle well.
      g.paragraph(p.answer.text, { x: inner.x, y: answerTop, w: inner.w, h: inner.h - (answerTop - inner.y) }, {
        role: "body",
        size: 30,
        color: theme.fg,
        lines: 8,
      });
    } else {
      g.text("Ask me anything about the game.", inner.x, answerTop + 18, { role: "h3", color: theme.fg2 });
      g.paragraph(
        "I can explain the modes, the room codes and every setting — and I answer just as well with no connection at all.",
        { x: inner.x, y: answerTop + 54, w: inner.w, h: 96 },
        { role: "body", color: theme.fgMuted, lines: 2 },
      );
    }

    // Follow-ups the answer itself proposed take priority over the generic
    // per-screen list. Three at most: more turns a prompt into a menu.
    const suggestions = (p.answer?.suggestions?.length ? p.answer.suggestions : p.suggestions).slice(0, 3);
    const [chips, foot] = cutBottom(rest, CONTROL.h, 20);
    if (suggestions.length > 0) {
      sectionLabel(g, chips.x, chips.y + 8, "Try asking");
      const chipRow: Rect = { x: chips.x, y: chips.y + 34, w: chips.w, h: Math.min(CONTROL.h, chips.h - 34) };
      const cells = colsIn(chipRow, suggestions.length, 14);
      suggestions.forEach((s, i) => {
        if (chip(g, cells[i], { id: `as:s${i}`, label: s })) emit({ type: "askAssistant", question: s });
      });
    }

    // The hosted model is only needed for free-form questions, so that is where
    // the edition gate lives — never on an answer.
    const liveLock = lock((f) => f.assistantLiveModel, "Type any question and get an answer written for your exact situation.");
    const [tourBtn, askBtn] = cutRight(foot, 240, 14);
    gate(
      button(g, askBtn, { id: "as:ask", label: "Ask your own question", icon: "spark", locked: liveLock }),
      liveLock,
      "Free-form questions",
      () => emit({ type: "askAssistant", question: "" }),
    );
    if (button(g, tourBtn, { id: "as:tour", label: "Take the tour", kind: "ghost" })) {
      emit({ type: "startTour" });
    }
  }

  function renderTour(g: Gfx, body: Rect, step: AssistantTourStep): void {
    const [card, foot] = cutBottom(body, CONTROL.h, 20);
    g.fillRound(card, tokens.radius.lg, rgba(palette.ink, 0.4));
    g.strokeRound(card, tokens.radius.lg, theme.line);
    const inner = inset(card, 36);
    g.text(step.title, inner.x, inner.y + 24, { role: "h1", color: theme.fg, maxWidth: inner.w });
    g.paragraph(step.body, { x: inner.x, y: inner.y + 70, w: inner.w, h: inner.h - 120 }, {
      role: "body",
      size: 30,
      color: theme.fg2,
      lines: 5,
    });

    // Step dots double as a position readout.
    for (let i = 0; i < step.total; i++) {
      const on = i === step.index;
      const cx = inner.x + 8 + i * 26;
      const cy = inner.y + inner.h - 12;
      if (on) g.fillRound({ x: cx - 12, y: cy - 5, w: 26, h: 10 }, 5, palette.accent);
      else g.circle(cx, cy, 5, theme.lineStrong);
    }

    const [nextBtn, restFoot] = cutRight(foot, 220, 14);
    const [prevBtn, skipArea] = cutLeft(restFoot, 180, 14);
    if (button(g, prevBtn, { id: "as:prev", label: "Back", kind: "ghost", disabled: step.index === 0 })) {
      emit({ type: "tourStep", delta: -1 });
    }
    if (button(g, nextBtn, { id: "as:next", label: step.index === step.total - 1 ? "Finish" : "Next", kind: "primary" })) {
      if (step.index === step.total - 1) emit({ type: "endTour" });
      else emit({ type: "tourStep", delta: 1 });
    }
    if (chip(g, { x: skipArea.x, y: skipArea.y, w: 150, h: skipArea.h }, { id: "as:skip", label: "Skip" })) {
      emit({ type: "endTour" });
    }
  }

  // ── Results ─────────────────────────────────────────────────────────────

  function renderResults(g: Gfx): void {
    const p = store.results;
    if (!p) return;
    const results = p.result.results;
    const winner = results[0];

    const body = header(g, g.area, {
      title: winner ? `${winner.name} wins` : "Match complete",
      subtitle: `${p.result.pairs} pairs · ${modeName(p.result.mode)} · ${formatDuration(p.result.durationMs)}`,
    });

    const [top, bottom] = cutTop(body, 300, 20);
    const [podiumArea, tableArea] = cutLeft(top, 520, 30);
    drawPodium(g, podiumArea, p);

    // Full standings.
    const shown = results.slice(0, 5);
    const rows = rowsIn(tableArea, 5, 8);
    shown.forEach((res, i) => {
      const r = rows[i];
      const view = p.players.find((x) => x.id === res.playerId);
      const col = seatColor(res.seat);
      g.fillRound(r, CONTROL.radius, rgba(palette.ink, 0.34));
      g.strokeRound(r, CONTROL.radius, res.rank === 1 ? rgba(palette.reward, 0.45) : theme.lineFaint);
      g.text(`${res.rank}`, r.x + 22, r.y + r.h / 2 + 1, {
        role: "bodyStrong",
        align: "centre",
        color: res.rank === 1 ? palette.reward : theme.fgMuted,
      });
      avatar(g, r.x + 62, r.y + r.h / 2, 20, {
        seat: res.seat,
        name: res.name,
        isAi: res.isAi,
        connected: view?.connected ?? true,
      });
      g.text(res.name, r.x + 94, r.y + r.h / 2 + 1, { role: "bodyStrong", color: theme.fg, maxWidth: r.w - 300 });
      g.text(`${Math.round(res.accuracy * 100)}% accurate`, r.x + r.w - 110, r.y + r.h / 2 + 1, {
        role: "caption",
        align: "right",
        color: theme.fgMuted,
      });
      g.text(String(res.score), r.x + r.w - 20, r.y + r.h / 2 + 1, { role: "h3", align: "right", color: col });
    });

    // Stats and actions.
    const [stats, actions] = cutTop(bottom, 118, 18);
    const tiles = colsIn(stats, 4, 14);
    statTile(g, tiles[0], { label: "Duration", value: formatDuration(p.result.durationMs) });
    statTile(g, tiles[1], { label: "Board", value: `${p.result.pairs} pairs` });
    statTile(g, tiles[2], { label: "Mode", value: modeName(p.result.mode) });
    statTile(g, tiles[3], {
      label: "Best accuracy",
      value: `${Math.round(Math.max(0, ...results.map((r) => r.accuracy)) * 100)}%`,
      tone: palette.reward,
    });

    const [again, restActions] = cutRight(actions, 280, 14);
    const cells = colsIn(restActions, 3, 14);
    if (button(g, cells[0], { id: "res:home", label: "Home", icon: "home", kind: "ghost" })) emit({ type: "returnHome" });
    if (button(g, cells[1], { id: "res:setup", label: "Change setup", kind: "ghost" })) emit({ type: "changeSetup" });

    const postLock = lock((f) => f.globalLeaderboard, "Publish this result to the shared board so it survives the session.");
    gate(
      button(g, cells[2], {
        id: "res:post",
        label: p.posted ? "Posted" : "Post score",
        icon: "trophy",
        kind: "secondary",
        locked: postLock,
        disabled: p.posted,
      }),
      postLock,
      "The shared leaderboard",
      () => emit({ type: "postScore" }),
    );

    if (button(g, again, { id: "res:again", label: "Play again", icon: "play", kind: "primary" })) {
      emit({ type: "playAgain" });
    }
  }

  function drawPodium(g: Gfx, r: Rect, p: ResultsProps): void {
    const top3 = p.result.results.slice(0, 3);
    if (top3.length === 0) return;
    const order = [1, 0, 2].filter((i) => i < top3.length);
    const cells = colsIn({ x: r.x, y: r.y, w: r.w, h: r.h }, Math.max(3, order.length), 16);
    const maxScore = Math.max(1, ...top3.map((t) => t.score));

    order.forEach((resIndex, slot) => {
      const res = top3[resIndex];
      const cell = cells[slot];
      if (!res || !cell) return;
      const col = seatColor(res.seat);
      const hMax = cell.h - 96;
      const h = Math.max(58, hMax * (res.score / maxScore));
      const bar: Rect = { x: cell.x + 8, y: cell.y + cell.h - 34 - h, w: cell.w - 16, h };

      g.fillRound(bar, [tokens.radius.md, tokens.radius.md, 0, 0], rgba(col, 0.24));
      g.strokeRound(bar, [tokens.radius.md, tokens.radius.md, 0, 0], rgba(col, 0.7));
      g.text(String(res.score), bar.x + bar.w / 2, bar.y + 30, { role: "h2", align: "centre", color: col });
      g.text(`#${res.rank}`, bar.x + bar.w / 2, bar.y + bar.h - 24, {
        role: "label",
        align: "centre",
        color: theme.fgMuted,
        upper: true,
      });
      avatar(g, bar.x + bar.w / 2, bar.y - 34, 26, {
        seat: res.seat,
        name: res.name,
        isAi: res.isAi,
        active: res.rank === 1,
      });
      g.text(res.name, cell.x + cell.w / 2, cell.y + cell.h - 12, {
        role: "caption",
        align: "centre",
        color: theme.fg2,
        maxWidth: cell.w - 8,
      });
    });

    g.hairline(r.x, r.y + r.h - 34, r.x + r.w, r.y + r.h - 34, theme.lineStrong);
  }

  // ── Shared drawing helpers ──────────────────────────────────────────────

  function actionCard(
    g: Gfx,
    r: Rect,
    o: { id: string; title: string; body: string; icon: IconName; kind?: "primary" | "default"; locked?: LockInfo; meta?: string },
  ): boolean {
    const st = g.state(o.id);
    const hover = g.anim(`${o.id}#h`, st.hover ? 1 : 0, tokens.motion.fast);
    const press = g.anim(`${o.id}#p`, st.active ? 1 : 0, 90);
    const focus = g.anim(`${o.id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
    const primary = o.kind === "primary" && !o.locked;

    const box = inset(r, press * 3, press * 2, press * 4, press * 2);
    if (focus > 0.01) {
      g.save();
      g.alpha(focus);
      g.strokeRound(inset(r, -8), tokens.radius.lg + 8, theme.focusRing, 3);
      g.restore();
    }

    g.fillRound(box, tokens.radius.lg, primary ? rgba(palette.primary, 0.16 + hover * 0.1) : hover > 0 ? theme.cardHover : theme.card);
    g.strokeRound(box, tokens.radius.lg, primary ? rgba(palette.primary, 0.65 + hover * 0.3) : hover > 0 ? theme.lineStrong : theme.line);

    const pad = 30;
    const badge: Rect = { x: box.x + pad, y: box.y + pad, w: 62, h: 62 };
    g.fillRound(badge, tokens.radius.md, primary ? rgba(palette.primary, 0.28) : rgba(ink.secondary, 0.1));
    icon(g, o.icon, badge.x + badge.w / 2, badge.y + badge.h / 2, 28, o.locked ? theme.fgMuted : primary ? palette.primary : theme.fg2, 2.8);

    if (o.locked) lockBadge(g, box.x + box.w - pad, badge.y + 20, o.locked.requires, "right");

    g.text(o.title, box.x + pad, badge.y + badge.h + 44, {
      role: "h2",
      color: o.locked ? theme.fg2 : theme.fg,
      maxWidth: box.w - pad * 2,
    });
    g.paragraph(o.body, { x: box.x + pad, y: badge.y + badge.h + 68, w: box.w - pad * 2 - 30, h: 86 }, {
      role: "body",
      color: theme.fgMuted,
      lines: 2,
    });
    if (o.meta) {
      g.text(o.meta, box.x + pad, box.y + box.h - 26, { role: "caption", color: theme.fg2 });
    }
    icon(g, "forward", box.x + box.w - pad - 4, box.y + box.h - 28, 18, hover > 0 ? theme.fg2 : theme.lineStrong, 2.4);

    g.hit({ id: o.id, rect: r });
    return g.clicked(o.id);
  }

  function envCard(
    g: Gfx,
    r: Rect,
    o: { id: string; spec: EnvironmentSpec; selected: boolean; locked?: LockInfo },
  ): boolean {
    const st = g.state(o.id);
    const hover = g.anim(`${o.id}#h`, st.hover ? 1 : 0, tokens.motion.fast);
    const focus = g.anim(`${o.id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
    if (focus > 0.01) {
      g.save();
      g.alpha(focus);
      g.strokeRound(inset(r, -8), tokens.radius.lg + 8, theme.focusRing, 3);
      g.restore();
    }

    g.fillRound(r, tokens.radius.lg, o.selected ? theme.cardSelected : hover > 0 ? theme.cardHover : theme.card);
    g.strokeRound(r, tokens.radius.lg, o.selected ? palette.primary : hover > 0 ? theme.lineStrong : theme.line, o.selected ? 2 : 1);

    const thumb: Rect = { x: r.x + 12, y: r.y + 12, w: r.w - 24, h: r.h * 0.5 };
    envThumb(g, thumb, o.spec, !!o.locked);

    const tx = r.x + 20;
    g.text(o.spec.name, tx, thumb.y + thumb.h + 30, {
      role: "h3",
      color: o.locked ? theme.fg2 : theme.fg,
      maxWidth: r.w - 40 - (o.selected ? 34 : 0),
    });
    g.paragraph(o.spec.blurb, { x: tx, y: thumb.y + thumb.h + 48, w: r.w - 40, h: 56 }, {
      role: "caption",
      color: theme.fgMuted,
      lines: 2,
    });

    const kindLabel = o.spec.kind === "passthrough" ? "Mixed reality" : o.spec.kind === "panorama" ? "360° photo" : "Rendered";
    tag(g, tx, r.y + r.h - 26, kindLabel, o.spec.kind === "passthrough" ? "accent" : "neutral");
    if (o.locked) lockBadge(g, r.x + r.w - 20, r.y + r.h - 26, o.locked.requires, "right");
    if (o.selected) icon(g, "check", r.x + r.w - 30, thumb.y + thumb.h + 30, 22, palette.accent, 3);

    g.hit({ id: o.id, rect: r });
    return g.clicked(o.id);
  }

  /**
   * A drawn preview rather than a shipped thumbnail — three shapes keyed off the
   * environment's own tint. No image budget, and a customer's new panorama gets
   * a sensible card the moment it is added to the catalogue.
   */
  function envThumb(g: Gfx, r: Rect, spec: EnvironmentSpec, dim: boolean): void {
    g.save();
    g.clip(r, tokens.radius.md);
    const alpha = dim ? 0.4 : 1;

    const grad = g.ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grad.addColorStop(0, rgba(spec.tint, 0.32 * alpha));
    grad.addColorStop(1, rgba(palette.ink, 0.95));
    g.ctx.fillStyle = grad;
    g.ctx.fillRect(r.x, r.y, r.w, r.h);

    const horizon = r.y + r.h * 0.66;
    if (spec.kind === "passthrough") {
      // Suggest a real room: a floor grid seen in perspective.
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        g.hairline(r.x + r.w * t, horizon, r.x + r.w * (0.5 + (t - 0.5) * 2.2), r.y + r.h, rgba(spec.tint, 0.3 * alpha));
      }
      for (let i = 1; i <= 3; i++) {
        const y = horizon + (r.h - (horizon - r.y)) * (i / 3) * 0.5;
        g.hairline(r.x, y, r.x + r.w, y, rgba(spec.tint, 0.22 * alpha));
      }
      g.strokeRound(inset(r, 10), tokens.radius.sm, rgba(spec.tint, 0.45 * alpha), 2);
    } else if (spec.kind === "panorama") {
      // A wide sweep with a sun — reads as photography, not geometry.
      g.hairline(r.x, horizon, r.x + r.w, horizon, rgba(spec.tint, 0.7 * alpha));
      g.circle(r.x + r.w * 0.72, horizon - r.h * 0.24, r.h * 0.11, rgba(spec.tint, 0.55 * alpha));
      g.ctx.fillStyle = rgba(palette.ink, 0.55);
      g.ctx.fillRect(r.x, horizon, r.w, r.h);
      for (let i = 0; i < 3; i++) {
        g.hairline(r.x, horizon + 8 + i * 9, r.x + r.w, horizon + 8 + i * 9, rgba(spec.tint, (0.2 - i * 0.05) * alpha));
      }
    } else {
      // Procedural scenes get their signature silhouette.
      g.hairline(r.x, horizon, r.x + r.w, horizon, rgba(spec.tint, 0.5 * alpha));
      const cols = 7;
      for (let i = 0; i < cols; i++) {
        const t = (i + 0.5) / cols;
        const h = r.h * (0.16 + 0.3 * Math.abs(Math.sin(i * 1.9 + spec.name.length)));
        const w = r.w / cols - 6;
        g.fillRound({ x: r.x + r.w * t - w / 2, y: horizon - h, w, h }, 3, rgba(spec.tint, (0.18 + 0.14 * (i % 2)) * alpha));
      }
      if (spec.floor) {
        g.ctx.fillStyle = rgba(spec.tint, 0.08 * alpha);
        g.ctx.fillRect(r.x, horizon, r.w, r.h);
      }
    }

    g.restore();
    g.strokeRound(r, tokens.radius.md, theme.lineFaint);
  }

  function boardCard(
    g: Gfx,
    r: Rect,
    o: { id: string; preset: (typeof BOARD_PRESETS)[number]; selected: boolean; locked?: LockInfo },
  ): boolean {
    const st = g.state(o.id);
    const hover = g.anim(`${o.id}#h`, st.hover ? 1 : 0, tokens.motion.fast);
    const focus = g.anim(`${o.id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
    if (focus > 0.01) {
      g.save();
      g.alpha(focus);
      g.strokeRound(inset(r, -8), tokens.radius.md + 8, theme.focusRing, 3);
      g.restore();
    }

    g.fillRound(r, tokens.radius.md, o.selected ? theme.cardSelected : hover > 0 ? theme.cardHover : theme.card);
    g.strokeRound(r, tokens.radius.md, o.selected ? palette.primary : hover > 0 ? theme.lineStrong : theme.line, o.selected ? 2 : 1);

    // Miniature of the actual layout — the label alone does not convey shape.
    const { cols, rows } = o.preset;
    const gridArea: Rect = { x: r.x + 20, y: r.y + 18, w: r.w - 40, h: r.h * 0.42 };
    const cw = Math.min(gridArea.w / cols, gridArea.h / rows) * 0.82;
    const gx = gridArea.x + (gridArea.w - cw * cols - (cols - 1) * 3) / 2;
    const gy = gridArea.y + (gridArea.h - cw * rows - (rows - 1) * 3) / 2;
    const dotColour = o.locked ? theme.lineStrong : o.selected ? palette.accent : rgba(ink.secondary, 0.5);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        g.fillRound({ x: gx + i * (cw + 3), y: gy + j * (cw + 3), w: cw, h: cw }, 2, dotColour);
      }
    }

    g.text(o.preset.label, r.x + r.w / 2, r.y + r.h - 52, {
      role: "h3",
      align: "centre",
      color: o.locked ? theme.fg2 : theme.fg,
    });
    g.text(`${o.preset.pairs} pairs · ${cols}×${rows}`, r.x + r.w / 2, r.y + r.h - 24, {
      role: "caption",
      align: "centre",
      color: theme.fgMuted,
    });
    if (o.locked) lockBadge(g, r.x + r.w - 14, r.y + 22, o.locked.requires, "right");
    if (o.selected) icon(g, "check", r.x + 26, r.y + 24, 20, palette.accent, 3);

    g.hit({ id: o.id, rect: r });
    return g.clicked(o.id);
  }

  function playerRow(
    g: Gfx,
    r: Rect,
    o: { id: string; player: PlayerView; canKick: boolean; selfId: string | null },
  ): boolean {
    const p = o.player;
    const col = seatColor(p.seat);
    g.fillRound(r, CONTROL.radius, rgba(palette.ink, 0.34));
    g.strokeRound(r, CONTROL.radius, theme.lineFaint);
    g.fillRound({ x: r.x, y: r.y + 8, w: 5, h: r.h - 16 }, 3, col);

    avatar(g, r.x + 40, r.y + r.h / 2, 22, {
      seat: p.seat,
      name: p.name,
      isAi: p.isAi,
      connected: p.connected,
      out: p.out,
    });

    const isSelf = p.id === o.selfId;
    let tx = r.x + 74;
    g.text(isSelf ? `${p.name} (you)` : p.name, tx, r.y + r.h / 2 + 1, {
      role: "bodyStrong",
      color: p.connected ? theme.fg : theme.fg2,
      maxWidth: r.w - 210,
    });
    tx += Math.min(g.measure(isSelf ? `${p.name} (you)` : p.name, { role: "bodyStrong" }), r.w - 210) + 12;

    if (p.isHost) tx += tag(g, tx, r.y + r.h / 2, "Host", "accent") + 6;
    if (p.isAi) tx += tag(g, tx, r.y + r.h / 2, aiLevelName(p.aiLevel ?? "medium"), "neutral") + 6;
    if (!p.connected) tag(g, tx, r.y + r.h / 2, "Offline", "danger");

    if (o.canKick) {
      const btn: Rect = { x: r.x + r.w - 50, y: r.y + (r.h - 42) / 2, w: 42, h: 42 };
      if (iconButton(g, btn, { id: `${o.id}:kick`, icon: "cross", label: p.isAi ? "Remove" : "Kick", tone: palette.danger })) {
        return true;
      }
    }
    return false;
  }

  function emptySeat(g: Gfx, r: Rect, index: number): void {
    g.save();
    g.ctx.setLineDash([8, 8]);
    g.strokeRound(r, CONTROL.radius, theme.lineFaint, 1.5);
    g.ctx.setLineDash([]);
    g.restore();
    g.text(`Seat ${index + 1} open`, r.x + 74, r.y + r.h / 2 + 1, { role: "body", color: theme.fgMuted });
    g.ring(r.x + 40, r.y + r.h / 2, 21, theme.lineFaint, 1.5);
  }

  function brandMark(g: Gfx, x: number, y: number, size: number): void {
    // Four cards; one turned. The product in one glyph, and it survives a
    // re-skin because both colours come from the palette.
    const cell = size * 0.44;
    const gap = size * 0.12;
    const cells: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    cells.forEach(([cx, cy], i) => {
      const box: Rect = { x: x + cx * (cell + gap), y: y + cy * (cell + gap), w: cell, h: cell };
      if (i === 3) {
        g.fillRound(box, size * 0.1, palette.accent);
      } else {
        g.strokeRound(box, size * 0.1, rgba(ink.primary, i === 0 ? 0.85 : 0.4), 2.5);
      }
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  panel.setRenderer(render);

  function show<K extends ScreenId>(next: K, props: ScreenProps[K]): void {
    store[next] = props;

    if (next === "join") {
      const jp = props as JoinProps;
      // Adopt the authoritative code unless it is just an echo of our own typing.
      if (jp.code !== lastCodeEmitted) codeDraft = normaliseRoomCode(jp.code);
      if (jp.status === "invalid" && lastJoinStatus !== "invalid") shakeT = 0.42;
      lastJoinStatus = jp.status;
    }

    if (screen !== next) {
      envPage = 0;
      lbPage = 0;
      sheetSpec = null;
      nameDraft = null;
      panel.setFocus(null);
      panel.transition(() => {
        screen = next;
      });
    } else {
      panel.markDirty();
    }
    panel.setVisible(true);
  }

  function update(dt: number, pointers: readonly PointerState[]): void {
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      panel.markDirty();
    }
    panel.update(dt, panel.visible ? pointers : []);
    hud.update(dt, pointers);
    toasts.update(dt);
  }

  return {
    hud,
    toasts,
    panel,
    show,
    hide(): void {
      panel.setVisible(false);
    },
    visible(): boolean {
      return panel.visible;
    },
    current(): ScreenId | null {
      return screen;
    },
    update,
    onAction(cb): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setHighlight(id: string | null): void {
      panel.setHighlight(id);
    },
    focusStep(delta: number): void {
      panel.focusStep(delta);
    },
    activateFocused(): void {
      panel.activateFocused();
    },
    dispose(): void {
      unhookHud();
      listeners.clear();
      hud.dispose();
      toasts.dispose();
      panel.dispose();
    },
  };
}

// ── Small shared bits ───────────────────────────────────────────────────────

function modeName(mode: GameMode): string {
  return GAME_MODES.find((m) => m.id === mode)?.name ?? mode;
}

function aiLevelName(level: AiLevel): string {
  return level === "easy" ? "Easy" : level === "expert" ? "Expert" : "Medium";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Re-exported so `main.ts` can describe a board without importing game.ts twice. */
export { presetForPairs, initialsOf };
export type { GameSettings, MatchResult, PlayerView, LeaderboardEntry, Tone };
