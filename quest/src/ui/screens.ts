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
import {
  activeThemeId,
  brand,
  mix as mixHex,
  palette,
  rgba,
  text as ink,
  tokens,
} from "../../shared/brand.ts";
import type { ThemeId } from "../../shared/brand.ts";
import { EDITIONS, allowsEnvironment } from "../../shared/editions.ts";
import type { AiLevel, EditionFeatures, EditionSpec } from "../../shared/editions.ts";
import { ENVIRONMENTS, getEnvironment } from "../../shared/environments.ts";
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
  readableSurface,
  rowsIn,
  theme,
} from "./panel.ts";
import type { IconName, LockInfo, SheetOptions } from "./widgets.ts";
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
  keypad,
  listRow,
  lockBadge,
  lockBadgeWidth,
  notice,
  pager,
  seatColor,
  seatText,
  sectionLabel,
  segmented,
  sheet,
  slider,
  statTile,
  stepper,
  tag,
  tagWidth,
  themeSwitch,
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
  /**
   * Enterprise runtime uploads. Optional: without them the setup band names a
   * customer's own 360 by its catalogue fallback rather than its real name.
   */
  customs?: readonly EnvironmentSpec[];
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
  /**
   * The host's persisted choice. Reported for completeness only: the switch is
   * drawn from the live `activeThemeId()`, because the persisted record can lag
   * a theme set outside the headset UI. The UI never sets it — it emits
   * `setTheme` and lets the host write it back.
   */
  theme: ThemeId;
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
  /**
   * Host-defined dismissal, kept for embedders that want one. The built-in Back
   * chevrons deliberately do not emit it: hosts map it to "hide the menu", and a
   * hidden menu is unreachable on a flat screen, so they emit `navigate`.
   */
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
  | { type: "setTheme"; theme: ThemeId }
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
  // Seeded from the edition so `main.ts` cannot forget to gate the watermark;
  // its own `hud.set()` calls merge over the top of this.
  hud.set({ watermark: features.watermark });
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

  /**
   * Every "Back" chevron routes here.
   *
   * Deliberately a navigation rather than `{ type: "back" }`: the host reads
   * that as "dismiss the menu", which on a flat screen leaves the visitor with
   * no menu, no HUD control that answers outside a match and no way back short
   * of reloading the page. A control labelled Back returns you a screen; closing
   * the UI belongs to "Resume match" and to the host's own `closeMenu`.
   */
  function back(): void {
    go("home");
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

  /**
   * Home.
   *
   * The layout answers one complaint: nobody could find the customisation. It
   * used to sit in a row of five identical chips along the bottom, which reads
   * as "and some settings" — so the environment, the board, the mode and the
   * theme are now a band of preview tiles taking a third of the screen, each
   * showing its *current* value and each a single tap from changing it.
   *
   * Play stays on top and stays the biggest thing on the panel. The rule is that
   * the game is never behind the setup, and the setup is never behind a chip.
   */
  function renderHome(g: Gfx): void {
    const p = store.home;
    if (!p) return;

    const [head, r1] = cutTop(g.area, 104, 18);
    const [playRow, r2] = cutTop(r1, 310, 22);
    const [setup, foot] = cutTop(r2, 312, 16);

    // ── Brand block ──
    brandMark(g, head.x + 4, head.y + 8, 54);
    g.text(edition.name, head.x + 78, head.y + 30, { role: "h1", color: theme.fg, maxWidth: head.w - 340 });
    g.text(edition.tagline, head.x + 80, head.y + 78, { role: "body", color: theme.fg2, maxWidth: head.w - 340 });
    if (edition.id !== "pro") {
      tag(g, head.x + head.w - 150, head.y + 30, EDITION_LABEL[edition.id], "reward");
    }

    // ── Play ──
    const onlineLock = lock((f) => f.onlineMultiplayer, "Room codes let up to eight headsets play the same board together.");
    const aiLock = lock((f) => f.aiOpponents, "AI opponents mean a single visitor always has a game.");
    const cells = colsIn(playRow, 3, 20);

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
        meta: "Six characters, no vowels",
      }),
      onlineLock,
      "Online multiplayer",
      () => emit({ type: "joinRoomIntent" }),
    );

    // ── Set-up band: the four things that sell the product ──
    sectionLabel(g, setup.x, setup.y + 8, "Set up your game", "Tap a tile to change it", setup.w);
    const [, tiles] = cutTop(setup, 34, 8);
    const [envCell, rightCol] = cutLeft(tiles, 700, 16);
    const [pickRow, themeRow] = cutTop(rightCol, 132, 16);
    const [boardCell, modeCell] = colsIn(pickRow, 2, 16);

    const spec = currentEnvironment(p);
    if (environmentTile(g, envCell, spec)) go("environments");

    const preset = presetForPairs(p.settings.pairs);
    if (
      previewTile(g, boardCell, {
        id: "home:tile:board",
        label: "Board",
        value: preset.label,
        sub: `${preset.pairs} pairs · ${preset.cols}×${preset.rows}`,
        draw: (gg, box) => boardMiniature(gg, box, preset.cols, preset.rows, theme.fg2),
      })
    ) {
      go("board");
    }

    if (
      previewTile(g, modeCell, {
        id: "home:tile:mode",
        label: "Mode",
        value: modeName(p.settings.mode),
        sub: modeHint(p.settings.mode),
        draw: (gg, box) => modeMiniature(gg, box, p.settings.mode),
      })
    ) {
      go("board");
    }

    // Theme sits with the rest of the customisation rather than being buried in
    // Settings — it is the change a customer asks to see first.
    sectionLabel(g, themeRow.x, themeRow.y + 12, "Theme");
    const nextTheme = themeSwitch(
      g,
      { x: themeRow.x, y: themeRow.y + 30, w: themeRow.w, h: themeRow.h - 30 },
      { id: "home:theme", value: activeThemeId() },
    );
    if (nextTheme) emit({ type: "setTheme", theme: nextTheme });

    // ── Footer: identity on the left, everything secondary on the right ──
    divider(g, foot.x, foot.y, foot.w);
    const pipW = connectionPip(g, foot.x, foot.y + 46, p.status, p.latencyMs);
    const nameX = foot.x + pipW + 34;
    icon(g, "person", nameX, foot.y + 46, 18, theme.fgMuted, 2);
    g.text(p.playerName || "Player", nameX + 18, foot.y + 46, {
      role: "caption",
      color: theme.fg2,
      maxWidth: 260,
    });

    const quick: { id: ScreenId; label: string }[] = [
      { id: "players", label: "Players" },
      { id: "leaderboard", label: "Leaderboard" },
      { id: "settings", label: "Settings" },
      { id: "assistant", label: "Help" },
    ];
    const chipW = 168;
    const chipsW = quick.length * chipW + (quick.length - 1) * 12;
    const chipRow: Rect = { x: foot.x + foot.w - chipsW, y: foot.y + 18, w: chipsW, h: 56 };
    const chipCells = colsIn(chipRow, quick.length, 12);
    quick.forEach((q, i) => {
      if (chip(g, chipCells[i], { id: `home:nav:${q.id}`, label: q.label })) go(q.id);
    });
  }

  /** The environment the setup band should describe, uploads included. */
  function currentEnvironment(p: HomeProps): EnvironmentSpec {
    return (
      (p.customs ?? []).find((c) => c.id === p.settings.environmentId) ??
      getEnvironment(p.settings.environmentId)
    );
  }

  // ── Host ────────────────────────────────────────────────────────────────

  function renderHost(g: Gfx): void {
    const p = store.host;
    if (!p) return;

    const body = header(g, g.area, {
      title: "Room open",
      backId: "host:back",
      meta: p.starting ? "Starting…" : `${p.players.length} of ${p.maxPlayers} joined`,
      metaColor: p.starting ? theme.accentText : theme.fgMuted,
    });
    if (g.clicked("host:back")) back();

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
    if (g.clicked("join:back")) back();

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

  /**
   * The environment picker — the screen this product is bought on.
   *
   * Two things are deliberate. Every entry carries a drawn preview keyed to its
   * own tint and kind, so the grid reads as a catalogue of rooms rather than a
   * list of names. And the "upload your own 360°" slot is a pinned banner below
   * the grid rather than a tile that gets pushed onto page two: it is the single
   * strongest thing this product does for an Enterprise customer, so it stays on
   * screen whether or not the running edition can actually use it.
   */
  function renderEnvironments(g: Gfx): void {
    const p = store.environments;
    if (!p) return;

    const catalogue: EnvironmentSpec[] = [...ENVIRONMENTS, ...(p.customs ?? [])];
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(catalogue.length / perPage));
    envPage = clamp(envPage, 0, pages - 1);

    const active = catalogue.find((e) => e.id === p.selectedId);
    const body = header(g, g.area, {
      title: "Environment",
      subtitle: "Where the board lives. Passthrough keeps your real room visible.",
      backId: "env:back",
      meta: active ? `Now playing in ${active.name}` : undefined,
      metaColor: theme.accentText,
    });
    if (g.clicked("env:back")) back();

    const [bottom, grid] = cutBottom(body, 104, 18);
    const cells = gridIn(grid, 3, 2, 18);

    const start = envPage * perPage;
    for (let i = 0; i < perPage; i++) {
      const cell = cells[i];
      const spec = catalogue[start + i];
      if (!cell || !spec) continue;
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

    const [pagerBox, banner] = cutRight(bottom, 340, 20);
    renderUploadBanner(g, banner);

    const next = pager(g, pagerBox, {
      id: "env:pager",
      page: envPage,
      pages,
      caption: `Page ${envPage + 1} of ${pages}`,
    });
    if (next !== null) {
      envPage = next;
      panel.markDirty();
    }
  }

  /** Always drawn, locked or not. A sales surface you cannot see does not sell. */
  function renderUploadBanner(g: Gfx, r: Rect): void {
    const customLock = lock(
      (f) => f.custom360,
      "Load your own 360° photography as a playable room — your showroom, your site, your event space.",
    );
    const st = g.state("env:upload");
    const hover = g.anim("env:upload#h", st.hover ? 1 : 0, tokens.motion.fast);
    const focus = g.anim("env:upload#f", st.focus ? 1 : 0, tokens.motion.fast);
    const tone = customLock ? theme.rewardText : theme.accentText;

    if (focus > 0.01) {
      g.save();
      g.alpha(focus);
      g.strokeRound(inset(r, -8), tokens.radius.lg + 8, theme.focusRing, 3);
      g.restore();
    }

    g.fillRound(r, tokens.radius.lg, hover > 0 ? theme.cardHover : theme.card);
    g.save();
    // Dashed, because it is a slot waiting to be filled rather than a thing.
    g.ctx.setLineDash([10, 8]);
    g.strokeRound(r, tokens.radius.lg, hover > 0 ? rgba(palette.accent, 0.8) : theme.lineStrong, 2);
    g.ctx.setLineDash([]);
    g.restore();

    icon(g, "upload", r.x + 48, r.y + r.h / 2, 36, tone, 2.8);
    const tx = r.x + 84;
    g.text("Add your own 360°", tx, r.y + r.h * 0.36, { role: "h3", color: theme.fg, maxWidth: r.w - 300 });
    g.text(
      customLock
        ? "Your showroom, your site, your event space — as a playable room."
        : "Load an equirectangular photo from the headset and play inside it.",
      tx,
      r.y + r.h * 0.68,
      { role: "caption", color: theme.fgMuted, maxWidth: r.w - 300 },
    );
    if (customLock) lockBadge(g, r.x + r.w - 24, r.y + r.h / 2, customLock.requires, "right");
    else changeHint(g, r.x + r.w - 26, r.y + r.h / 2, "Upload", hover);

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
    if (g.clicked("board:back")) back();

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
    if (g.clicked("players:back")) back();

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
    g.fillRound(box, CONTROL.radius, theme.card);
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
    if (g.clicked("lb:back")) back();

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

    // `cutBottom` returns [taken, remainder]: the 66 px strip is the pager, the
    // remainder is the table. Taking them the other way round collapsed every
    // row to about −1 px and printed all five on top of each other.
    const [foot, table] = cutBottom(afterScope, 66, 12);

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
    const medal = e.rank === 1 ? theme.rewardText : e.rank === 2 ? theme.fg2 : theme.accentText;
    g.fillRound(r, CONTROL.radius, theme.card);
    if (podium) g.fillRound(r, CONTROL.radius, rgba(medal, 0.1));
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
    if (g.clicked("set:back")) back();

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

    // ── Right column: appearance, comfort and system ──
    let ry = right.y;
    sectionLabel(g, right.x, ry + 8, "Appearance", "Applies everywhere, instantly", right.w);
    ry += 34;

    // Ticked from the *live* theme, exactly like the one on Home. The entry
    // screen can set a theme without the host's persisted record hearing about
    // it, so `p.theme` is allowed to disagree with what is on the glass — and a
    // switch that ticks the theme you are not looking at offers one option that
    // does nothing (`setTheme` no-ops on the active id) and one that is wrong.
    const nextTheme = themeSwitch(g, { x: right.x, y: ry, w: right.w, h: 82 }, {
      id: "set:theme",
      value: activeThemeId(),
    });
    if (nextTheme) emit({ type: "setTheme", theme: nextTheme });
    ry += 82 + 22;

    divider(g, right.x, ry - 12, right.w);
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
    if (g.clicked("as:back")) back();

    if (p.tour) {
      renderTour(g, body, p.tour);
      return;
    }

    const [answerArea, rest] = cutTop(body, 452, 20);
    g.fillRound(answerArea, tokens.radius.lg, theme.card);
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
    const [foot, chips] = cutBottom(rest, CONTROL.h, 20);
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
    // 300, not 240: "Take the tour" is 13 characters of h3 and was ellipsised to
    // "Take the…" in the narrower cell.
    const [tourBtn, askBtn] = cutRight(foot, 300, 14);
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
    const [foot, card] = cutBottom(body, CONTROL.h, 20);
    g.fillRound(card, tokens.radius.lg, theme.card);
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
      if (on) g.fillRound({ x: cx - 12, y: cy - 5, w: 26, h: 10 }, 5, theme.accentText);
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

    const [top, bottom] = cutTop(body, 452, 20);
    const [podiumArea, tableArea] = cutLeft(top, 540, 30);
    drawPodium(g, podiumArea, p);

    // Full standings.
    const shown = results.slice(0, 6);
    const rows = rowsIn(tableArea, 6, 8);
    shown.forEach((res, i) => {
      const r = rows[i];
      const view = p.players.find((x) => x.id === res.playerId);
      g.fillRound(r, CONTROL.radius, theme.card);
      g.strokeRound(r, CONTROL.radius, res.rank === 1 ? rgba(palette.reward, 0.45) : theme.lineFaint);
      g.text(`${res.rank}`, r.x + 22, r.y + r.h / 2 + 1, {
        role: "bodyStrong",
        align: "centre",
        color: res.rank === 1 ? theme.rewardText : theme.fgMuted,
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
      g.text(String(res.score), r.x + r.w - 20, r.y + r.h / 2 + 1, { role: "h3", align: "right", color: seatText(res.seat) });
    });

    // Stats and actions.
    const [stats, belowStats] = cutTop(bottom, 118, 20);
    const [actions] = cutTop(belowStats, CONTROL.h, 0);
    const tiles = colsIn(stats, 4, 14);
    statTile(g, tiles[0], { label: "Duration", value: formatDuration(p.result.durationMs) });
    statTile(g, tiles[1], { label: "Board", value: `${p.result.pairs} pairs` });
    statTile(g, tiles[2], { label: "Mode", value: modeName(p.result.mode) });
    statTile(g, tiles[3], {
      label: "Best accuracy",
      value: `${Math.round(Math.max(0, ...results.map((r) => r.accuracy)) * 100)}%`,
      tone: theme.rewardText,
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

      g.fillRound(bar, [tokens.radius.md, tokens.radius.md, 0, 0], theme.card);
      g.fillRound(bar, [tokens.radius.md, tokens.radius.md, 0, 0], rgba(col, 0.24));
      g.strokeRound(bar, [tokens.radius.md, tokens.radius.md, 0, 0], rgba(col, 0.7));
      g.text(String(res.score), bar.x + bar.w / 2, bar.y + 30, {
        role: "h2",
        align: "centre",
        color: seatText(res.seat),
      });
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

    g.text(o.title, box.x + pad, badge.y + badge.h + 38, {
      role: "h2",
      color: o.locked ? theme.fg2 : theme.fg,
      maxWidth: box.w - pad * 2,
    });
    g.paragraph(o.body, { x: box.x + pad, y: badge.y + badge.h + 64, w: box.w - pad * 2 - 30, h: 84 }, {
      role: "body",
      color: theme.fgMuted,
      lines: 2,
    });
    if (o.meta) {
      g.text(o.meta, box.x + pad, box.y + box.h - 24, { role: "caption", color: theme.fg2 });
    }
    icon(g, "forward", box.x + box.w - pad - 4, box.y + box.h - 26, 18, hover > 0 ? theme.fg2 : theme.lineStrong, 2.4);

    g.hit({ id: o.id, rect: r });
    return g.clicked(o.id);
  }

  // ── Home set-up tiles ───────────────────────────────────────────────────

  /** Shared card body for a tile whose whole surface is one target. */
  function tileBody(g: Gfx, id: string, r: Rect): { box: Rect; hover: number } {
    const st = g.state(id);
    const hover = g.anim(`${id}#h`, st.hover ? 1 : 0, tokens.motion.fast);
    const press = g.anim(`${id}#p`, st.active ? 1 : 0, 90);
    const focus = g.anim(`${id}#f`, st.focus ? 1 : 0, tokens.motion.fast);
    const box = inset(r, press * 3, press * 2, press * 4, press * 2);

    if (focus > 0.01) {
      g.save();
      g.alpha(focus);
      g.strokeRound(inset(r, -8), tokens.radius.lg + 8, theme.focusRing, 3);
      g.restore();
    }
    g.fillRound(box, tokens.radius.lg, hover > 0 ? theme.cardHover : theme.card);
    g.strokeRound(box, tokens.radius.lg, hover > 0 ? theme.lineStrong : theme.line);
    g.hit({ id, rect: r });
    return { box, hover };
  }

  /**
   * The change affordance on a whole-card target. A word and an arrow rather
   * than a nested button: two hit regions where there is one action is a lie,
   * and on a ray-driven panel it is a lie you can feel.
   */
  function changeHint(g: Gfx, x: number, cy: number, label: string, hover: number): void {
    const col = hover > 0 ? theme.fg : theme.fg2;
    icon(g, "forward", x, cy, 18, col, 2.6);
    g.text(label, x - 12, cy + 1, { role: "caption", align: "right", color: col });
  }

  /** The set-up band's hero: a drawn preview of the room you are playing in. */
  function environmentTile(g: Gfx, r: Rect, spec: EnvironmentSpec): boolean {
    const id = "home:tile:env";
    const { box, hover } = tileBody(g, id, r);

    g.text("ENVIRONMENT", box.x + 24, box.y + 28, { role: "label", color: theme.fgMuted, upper: true });

    const thumb: Rect = { x: box.x + 24, y: box.y + 50, w: 300, h: box.h - 74 };
    envThumb(g, thumb, spec, false);

    const tx = thumb.x + thumb.w + 26;
    const tw = box.x + box.w - 24 - tx;
    g.text(spec.name, tx, box.y + 96, { role: "h2", color: theme.fg, maxWidth: tw });
    g.paragraph(spec.blurb, { x: tx, y: box.y + 122, w: tw, h: 76 }, {
      role: "caption",
      color: theme.fgMuted,
      lines: 3,
    });
    tag(g, tx, box.y + box.h - 40, kindLabel(spec), spec.kind === "passthrough" ? "accent" : "neutral");
    changeHint(g, box.x + box.w - 26, box.y + box.h - 40, "Change", hover);

    return g.clicked(id);
  }

  /** Compact tile: a miniature, the current value, and one line of why. */
  function previewTile(
    g: Gfx,
    r: Rect,
    o: { id: string; label: string; value: string; sub: string; draw: (g: Gfx, box: Rect) => void },
  ): boolean {
    const { box, hover } = tileBody(g, o.id, r);
    g.text(o.label.toUpperCase(), box.x + 20, box.y + 26, { role: "label", color: theme.fgMuted, upper: true });

    // A raised well rather than a recessed one: `card` is already the darkest
    // neutral in the dark theme, so anything "deeper" would be invisible.
    const art: Rect = { x: box.x + 20, y: box.y + 44, w: 68, h: box.h - 64 };
    g.fillRound(art, tokens.radius.sm, theme.panelTop);
    g.strokeRound(art, tokens.radius.sm, theme.lineFaint);
    o.draw(g, inset(art, 10));

    const tx = art.x + art.w + 18;
    // Stop short of the chevron rather than running under it.
    const tw = box.x + box.w - 46 - tx;
    g.text(o.value, tx, box.y + 62, { role: "h3", color: theme.fg, maxWidth: tw });
    g.text(o.sub, tx, box.y + 92, { role: "caption", color: theme.fgMuted, maxWidth: tw });
    icon(g, "forward", box.x + box.w - 22, box.y + box.h / 2, 16, hover > 0 ? theme.fg2 : theme.lineStrong, 2.4);

    return g.clicked(o.id);
  }

  /** The board's actual shape, at thumbnail size. A label cannot show 6×5. */
  function boardMiniature(g: Gfx, r: Rect, cols: number, rows: number, colour: string): void {
    const gap = 2;
    const cell = Math.min((r.w - gap * (cols - 1)) / cols, (r.h - gap * (rows - 1)) / rows);
    const gx = r.x + (r.w - cell * cols - gap * (cols - 1)) / 2;
    const gy = r.y + (r.h - cell * rows - gap * (rows - 1)) / 2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        g.fillRound({ x: gx + i * (cell + gap), y: gy + j * (cell + gap), w: cell, h: cell }, 1.5, colour);
      }
    }
  }

  function modeMiniature(g: Gfx, r: Rect, mode: GameMode): void {
    const name: IconName = mode === "timeattack" ? "timer" : mode === "sudden" ? "spark" : "cards";
    icon(g, name, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h), theme.fg2, 2.6);
  }

  /** One short line per mode. The full blurb belongs on the Board screen. */
  function modeHint(mode: GameMode): string {
    return mode === "timeattack"
      ? "Everyone plays at once"
      : mode === "sudden"
        ? "One miss and you are out"
        : "Match a pair, play again";
  }

  function kindLabel(spec: EnvironmentSpec): string {
    return spec.kind === "passthrough" ? "Mixed reality" : spec.kind === "panorama" ? "360° photo" : "Rendered";
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
    // The active room is marked four ways — a heavy border, a filled ribbon, the
    // word "ACTIVE" and a tick. Across a trade-show stand, one of them will land.
    g.strokeRound(
      r,
      tokens.radius.lg,
      o.selected ? palette.primary : hover > 0 ? theme.lineStrong : theme.line,
      o.selected ? 3 : 1,
    );

    const thumb: Rect = { x: r.x + 12, y: r.y + 12, w: r.w - 24, h: r.h * 0.52 };
    envThumb(g, thumb, o.spec, !!o.locked);

    if (o.selected) {
      const fill = readableSurface(palette.primary, ink.onPrimary);
      const label = "ACTIVE";
      const lw = g.measure(label, { role: "label", size: 19, tracking: 2 }) + 54;
      const ribbon: Rect = { x: thumb.x, y: thumb.y, w: lw, h: 38 };
      g.fillRound(ribbon, [tokens.radius.md, 0, tokens.radius.md, 0], fill);
      icon(g, "check", ribbon.x + 20, ribbon.y + ribbon.h / 2, 18, ink.onPrimary, 3);
      g.text(label, ribbon.x + 36, ribbon.y + ribbon.h / 2 + 1, {
        role: "label",
        size: 19,
        tracking: 2,
        color: ink.onPrimary,
        upper: true,
      });
    }

    // Below the preview there is room for a title line and two lines of blurb,
    // and no more. The kind therefore rides the title's line, right-aligned,
    // instead of being pinned to the card's bottom edge where the blurb's second
    // line printed straight through it on every entry whose text wrapped.
    const tx = r.x + 20;
    const titleY = thumb.y + thumb.h + 32;
    const kind = kindLabel(o.spec);
    const kindW = tagWidth(g, kind);
    g.text(o.spec.name, tx, titleY, {
      role: "h3",
      color: o.locked ? theme.fg2 : theme.fg,
      maxWidth: r.w - 40 - kindW - 18,
    });
    tag(g, r.x + r.w - 20 - kindW, titleY, kind, o.spec.kind === "passthrough" ? "accent" : "neutral");

    // A locked card keeps its badge in the bottom corner, so the blurb column
    // stops short of it rather than running underneath.
    const badgeW = o.locked ? lockBadgeWidth(g, o.locked.requires) + 18 : 0;
    g.paragraph(o.spec.blurb, { x: tx, y: titleY + 20, w: r.w - 40 - badgeW, h: 60 }, {
      role: "caption",
      color: theme.fgMuted,
      lines: 2,
    });

    if (o.locked) lockBadge(g, r.x + r.w - 20, r.y + r.h - 26, o.locked.requires, "right");

    g.hit({ id: o.id, rect: r });
    return g.clicked(o.id);
  }

  /**
   * A drawn preview rather than a shipped thumbnail: no image budget, no load,
   * and a customer's own 360 gets a sensible card the instant it is uploaded.
   *
   * Every environment gets its own silhouette rather than one generic skyline —
   * this grid is what the product is chosen on, and six identical rectangles in
   * six different colours is a swatch book, not a catalogue. Everything is keyed
   * off the spec's own `tint` over `theme.deep`, so previews stay dark and the
   * tint stays legible in both themes.
   */
  function envThumb(g: Gfx, r: Rect, spec: EnvironmentSpec, dim: boolean): void {
    g.save();
    g.clip(r, tokens.radius.md);
    const a = dim ? 0.4 : 1;
    const base = theme.deep;
    const horizon = r.y + r.h * 0.64;
    const line = (x0: number, y0: number, x1: number, y1: number, alpha: number) =>
      g.hairline(x0, y0, x1, y1, rgba(spec.tint, alpha * a));

    const grad = g.ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grad.addColorStop(0, mixHex(base, spec.tint, 0.34 * a));
    grad.addColorStop(1, base);
    g.ctx.fillStyle = grad;
    g.ctx.fillRect(r.x, r.y, r.w, r.h);

    if (spec.kind === "passthrough") {
      // A real room: perspective floor grid running back to a doorway.
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        line(r.x + r.w * t, horizon, r.x + r.w * (0.5 + (t - 0.5) * 2.4), r.y + r.h, 0.3);
      }
      for (let i = 1; i <= 3; i++) {
        line(r.x, horizon + (r.h * 0.36 * i) / 3, r.x + r.w, horizon + (r.h * 0.36 * i) / 3, 0.24 - i * 0.04);
      }
      const door: Rect = { x: r.x + r.w * 0.44, y: horizon - r.h * 0.34, w: r.w * 0.16, h: r.h * 0.34 };
      g.fillRound(door, 2, rgba(spec.tint, 0.16 * a));
      g.strokeRound(door, 2, rgba(spec.tint, 0.5 * a), 2);
    } else if (spec.kind === "panorama") {
      // Photography: a low sun, a graded sky and a reflected foreground.
      g.circle(r.x + r.w * 0.72, horizon - r.h * 0.2, r.h * 0.12, rgba(spec.tint, 0.5 * a));
      g.ring(r.x + r.w * 0.72, horizon - r.h * 0.2, r.h * 0.2, rgba(spec.tint, 0.16 * a), 2);
      g.ctx.fillStyle = rgba(base, 0.55);
      g.ctx.fillRect(r.x, horizon, r.w, r.h);
      line(r.x, horizon, r.x + r.w, horizon, 0.75);
      for (let i = 0; i < 4; i++) {
        const y = horizon + 9 + i * 10;
        g.hairline(r.x + r.w * (0.5 - 0.26 * (4 - i)), y, r.x + r.w * (0.5 + 0.26 * (4 - i)), y, rgba(spec.tint, (0.22 - i * 0.05) * a));
      }
    } else {
      envPresetArt(g, r, spec, horizon, a);
    }

    if (spec.floor) {
      g.ctx.fillStyle = rgba(spec.tint, 0.07 * a);
      g.ctx.fillRect(r.x, horizon, r.w, r.h);
    }

    g.restore();
    g.strokeRound(r, tokens.radius.md, theme.lineFaint);
  }

  /** One silhouette per procedural preset, so no two cards look alike. */
  function envPresetArt(g: Gfx, r: Rect, spec: EnvironmentSpec, horizon: number, a: number): void {
    const t = (alpha: number) => rgba(spec.tint, alpha * a);
    const cx = r.x + r.w / 2;

    switch (spec.preset) {
      case "orbital-deck": {
        // A planet's limb rising under a scatter of stars.
        for (let i = 0; i < 22; i++) {
          const sx = r.x + ((i * 97) % 100) / 100 * r.w;
          const sy = r.y + ((i * 53) % 60) / 100 * r.h;
          g.circle(sx, sy, 1.4, t(0.35 + (i % 3) * 0.15));
        }
        g.ctx.save();
        g.ctx.beginPath();
        g.ctx.arc(cx, r.y + r.h * 1.5, r.w * 0.62, Math.PI * 1.18, Math.PI * 1.82);
        g.ctx.lineTo(cx, r.y + r.h * 1.5);
        g.ctx.closePath();
        g.ctx.fillStyle = t(0.22);
        g.ctx.fill();
        g.ctx.strokeStyle = t(0.7);
        g.ctx.lineWidth = 2;
        g.ctx.stroke();
        g.ctx.restore();
        break;
      }
      case "quantum-lab": {
        // Clean floor, soft light cones from above.
        for (let i = 0; i < 3; i++) {
          const lx = r.x + r.w * (0.22 + i * 0.28);
          g.path([lx, r.y + 2, lx - r.w * 0.09, horizon, lx + r.w * 0.09, horizon], t(0.24), 1.5, true);
          g.ctx.fillStyle = t(0.1);
          g.ctx.fill();
        }
        g.hairline(r.x, horizon, r.x + r.w, horizon, t(0.6));
        for (let i = 1; i <= 3; i++) {
          g.hairline(r.x, horizon + i * 11, r.x + r.w, horizon + i * 11, t(0.14));
        }
        break;
      }
      case "cyber-atrium": {
        // Rain on glass, signage bleeding through it.
        for (let i = 0; i < 5; i++) {
          const bw = r.w * (0.1 + (i % 3) * 0.045);
          const bh = r.h * (0.1 + (i % 2) * 0.09);
          g.fillRound({ x: r.x + r.w * (0.06 + i * 0.19), y: r.y + r.h * (0.16 + (i % 3) * 0.12), w: bw, h: bh }, 2, t(0.3));
        }
        for (let i = 0; i < 16; i++) {
          const rx = r.x + ((i * 61) % 100) / 100 * r.w;
          g.hairline(rx, r.y + ((i * 37) % 70) / 100 * r.h, rx - 4, r.y + ((i * 37) % 70) / 100 * r.h + 16, t(0.3));
        }
        g.hairline(r.x, horizon, r.x + r.w, horizon, t(0.5));
        break;
      }
      case "aurora-void": {
        // Weightless ribbons, no ground at all.
        for (let i = 0; i < 4; i++) {
          const y = r.y + r.h * (0.28 + i * 0.14);
          const pts: number[] = [];
          for (let s = 0; s <= 8; s++) {
            const x = r.x + (r.w * s) / 8;
            pts.push(x, y + Math.sin(s * 0.8 + i * 1.3) * r.h * 0.07);
          }
          g.path(pts, t(0.42 - i * 0.08), 3 + i);
        }
        break;
      }
      case "neon-vault":
      default: {
        // Ribbed arches converging on a lit end wall.
        for (let i = 1; i <= 4; i++) {
          const k = i / 5;
          const w = r.w * (1 - k * 0.72);
          const h = r.h * (1 - k * 0.5);
          const box: Rect = { x: cx - w / 2, y: r.y + (r.h - h) / 2 - r.h * 0.06, w, h };
          g.strokeRound(box, tokens.radius.sm, t(0.5 - i * 0.08), 2);
        }
        g.fillRound({ x: cx - r.w * 0.08, y: horizon - r.h * 0.2, w: r.w * 0.16, h: r.h * 0.2 }, 2, t(0.35));
        g.hairline(r.x, horizon, r.x + r.w, horizon, t(0.45));
        break;
      }
    }
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
    const dotColour = o.locked ? theme.lineStrong : o.selected ? theme.accentText : rgba(ink.secondary, 0.5);
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
    if (o.selected) icon(g, "check", r.x + 26, r.y + 24, 20, theme.accentText, 3);

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
    g.fillRound(r, CONTROL.radius, theme.card);
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
      // 48 design px ≈ 1.4° at reading distance — the smallest target in the
      // product, and still above the 44 CSS-px equivalent floor.
      const btn: Rect = { x: r.x + r.w - 56, y: r.y + (r.h - 48) / 2, w: 48, h: 48 };
      if (iconButton(g, btn, { id: `${o.id}:kick`, icon: "cross", label: p.isAi ? "Remove" : "Kick", tone: theme.dangerText })) {
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
