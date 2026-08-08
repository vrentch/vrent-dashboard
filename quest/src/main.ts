/**
 * Application entry point — the only file that knows every subsystem exists.
 *
 * Everything else is written against `src/contracts.ts` and talks to nobody.
 * This file owns the app state, translates UI intents into calls, and routes
 * game events to the board and HUD. It deliberately contains no game rules:
 * those live in `shared/game.ts` and run identically here and on the server.
 *
 * The one structural idea worth knowing: a match is driven either by
 * `createLocalSession` (solo and AI, no network at all) or by `createNetClient`
 * (a server-authoritative room). Both are funnelled into the same handful of
 * board/HUD calls below, so nothing downstream can tell the difference.
 */

import * as THREE from "three";

import {
  applyBrandCssVars,
  brand,
  isThemeId,
  setTheme,
  type ThemeId,
} from "../shared/brand.ts";
import { allowsEnvironment, resolveEdition, type AiLevel } from "../shared/editions.ts";
import {
  DEFAULT_SETTINGS,
  isValidRoomCode,
  type GameSettings,
  type MatchResult,
  type Player,
} from "../shared/game.ts";
import {
  DEFAULT_ENVIRONMENT_ID,
  getEnvironment,
  type EnvironmentSpec,
} from "../shared/environments.ts";
import type {
  EmoteId,
  LeaderboardEntry,
  LeaderboardScope,
  PlayerView,
  RoomView,
} from "../shared/protocol.ts";

import type { NetStatus } from "./contracts.ts";
import { createAudio } from "./core/audio.ts";
import { createEngine, maybeAutoEnterXR } from "./core/engine.ts";
import { createEnvironment } from "./env/controller.ts";
import { addCustomPanorama, customPanoramaSpecs, customPanoramaSupported } from "./env/custom.ts";
import { createBoard } from "./game/board.ts";
import { SYMBOL_SETS } from "./game/symbols.ts";
import { createNetClient } from "./net/client.ts";
import { createAssistant } from "./ai/assistant.ts";
import { createVoice } from "./ai/voice.ts";
import { createUi, type ScreenId, type UiAction, type UiToggleKey } from "./ui/screens.ts";
import { createEntryScreen } from "./ui/entry.ts";
import { createLocalSession, type LocalSession } from "./session.ts";

const VERSION = "1.0.0";
const EDITION = resolveEdition(import.meta.env?.VITE_EDITION as string | undefined);
const SERVER_URL = (import.meta.env?.VITE_SERVER_URL as string | undefined) ?? "";

// ── Persisted preferences ───────────────────────────────────────────────────

type Toggles = Record<UiToggleKey, boolean>;

interface Prefs {
  playerName: string;
  settings: GameSettings;
  placement: "table" | "room";
  aiLevel: AiLevel;
  theme: ThemeId;
  toggles: Toggles;
}

const DEFAULT_TOGGLES: Toggles = {
  sound: true,
  haptics: true,
  comfortVignette: false,
  hints: true,
  showRays: true,
};

const PREFS_KEY = "vrent-memory-xr.prefs";

function prefersLight(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  } catch {
    return false;
  }
}

function loadPrefs(): Prefs {
  const base: Prefs = {
    playerName: "",
    settings: { ...DEFAULT_SETTINGS },
    placement: "room",
    aiLevel: "medium",
    // First run follows the operator's OS preference; after that their explicit
    // choice wins, so a demo laptop set to light does not open dark.
    theme: prefersLight() ? "light" : "dark",
    toggles: { ...DEFAULT_TOGGLES },
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...base,
      ...saved,
      theme: isThemeId(saved.theme) ? saved.theme : base.theme,
      settings: { ...base.settings, ...(saved.settings ?? {}) },
      toggles: { ...base.toggles, ...(saved.toggles ?? {}) },
    };
  } catch {
    // A corrupt or unreadable store must never stop the app booting.
    return base;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private browsing, quota — preferences are not worth failing over. */
  }
}

// ── App state ───────────────────────────────────────────────────────────────

const prefs = loadPrefs();

const app = {
  /** Which backend is driving the current match, if any. */
  mode: "idle" as "idle" | "local" | "net",
  room: null as RoomView | null,
  selfId: null as string | null,
  netStatus: "offline" as NetStatus,
  latency: 0,
  /** Local-play roster, mirrored into PlayerView for the shared HUD. */
  localPlayers: [] as Player[],
  turnSeat: 0,
  pairsLeft: 0,
  startedAt: 0,
  aiLevels: [] as AiLevel[],
  joinCode: "",
  joinStatus: "idle" as "idle" | "checking" | "invalid" | "joined",
  joinMessage: "",
  leaderboard: { scope: "global" as LeaderboardScope, entries: [] as LeaderboardEntry[], loading: false },
  customs: [] as EnvironmentSpec[],
  result: null as MatchResult | null,
  posted: false,
  assistantBusy: false,
  assistantAnswer: null as Awaited<ReturnType<ReturnType<typeof createAssistant>["ask"]>> | null,
  tourIndex: -1,
  /** Wall-clock deadline for the Demo edition's kiosk timeout, 0 = none. */
  sessionDeadline: 0,
};

// ── Boot ────────────────────────────────────────────────────────────────────

setTheme(prefs.theme);
applyBrandCssVars();
document.title = EDITION.name;

const canvas = document.getElementById("xr-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;
document.getElementById("boot")?.remove();

const engine = createEngine(canvas);
const audio = createAudio(engine.camera);
const environment = createEnvironment(engine);
const assistant = createAssistant();
const voice = createVoice();

const board = createBoard(engine, {
  onCardActivated: (index) => flipCard(index),
  onCardHovered: (index) => {
    if (index !== null) audio.play("hover", { gain: 0.5 });
  },
});
engine.world.add(board.group);

const ui = createUi(engine, { edition: EDITION });

const local: LocalSession = createLocalSession({
  onRevealed: (index, symbol, seat) => {
    board.reveal(index, symbol);
    audio.play("flip");
    void seat;
  },
  onMatched: (indices, seat, streak) => {
    board.markMatched(indices, seat);
    audio.play("match", { gain: Math.min(1.4, 1 + streak * 0.1) });
    syncLocalRoster();
  },
  onMissed: (indices) => {
    board.markMissed(indices);
    audio.play("miss");
  },
  onHidden: (indices) => board.hide(indices),
  onTurn: (seat, isHuman) => {
    app.turnSeat = seat;
    board.setInteractive(isHuman);
    if (isHuman) audio.play("turnStart");
    syncLocalRoster();
  },
  onGameOver: (result) => finishMatch(result),
  onAiIntent: (index, seat) => board.showIntent(index, seat),
});

const net = createNetClient(SERVER_URL, {
  onStatus: (status) => {
    app.netStatus = status;
    if (status === "reconnecting") ui.toasts.push({ text: "Reconnecting", key: "net" });
    if (status === "online") ui.toasts.dismissKey("net");
    if (status === "failed") ui.toasts.push({ text: "Lost connection to the room", key: "net" });
    refresh();
  },
  onRoom: (room) => {
    const firstView = app.room === null;
    app.room = room;
    app.selfId = net.selfId();
    app.pairsLeft = room.cards.filter((c) => !c.matched).length / 2;
    if (room.phase === "playing" && app.mode !== "net") startNetMatch(room);
    if (firstView && room.phase === "lobby") ui.show("host", hostProps());
    refresh();
  },
  onRevealed: (index, symbol) => {
    board.reveal(index, symbol);
    audio.play("flip");
  },
  onMatched: (indices, _by, seat) => {
    board.markMatched(indices, seat);
    audio.play("match");
  },
  onMissed: (indices) => {
    board.markMissed(indices);
    audio.play("miss");
  },
  onHidden: (indices) => board.hide(indices),
  onTurn: (playerId, seat) => {
    app.turnSeat = seat;
    board.setInteractive(playerId === app.selfId);
    if (playerId === app.selfId) audio.play("turnStart");
    refresh();
  },
  onGameOver: (result) => finishMatch(result),
  onLeaderboard: (entries) => {
    app.leaderboard.entries = entries;
    app.leaderboard.loading = false;
    refresh();
  },
  onEmote: (playerId, emote) => {
    const seat = app.room?.players.find((p) => p.id === playerId)?.seat ?? 0;
    ui.hud.playEmote(seat, emote);
  },
  onError: (_code, message) => {
    app.joinStatus = "invalid";
    app.joinMessage = message;
    ui.toasts.push(message);
    refresh();
  },
});

// ── Player views ────────────────────────────────────────────────────────────

/** Local matches have no server, so the HUD's PlayerView list is derived here. */
function toPlayerViews(players: readonly Player[]): PlayerView[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    score: p.score,
    streak: p.streak,
    isAi: p.isAi,
    ...(p.aiLevel ? { aiLevel: p.aiLevel } : {}),
    connected: p.connected,
    out: p.out,
    isHost: p.seat === 0,
  }));
}

function players(): readonly PlayerView[] {
  return app.mode === "net" && app.room ? app.room.players : toPlayerViews(app.localPlayers);
}

function syncLocalRoster(): void {
  const state = local.state();
  if (!state) return;
  app.localPlayers = state.players;
  app.pairsLeft = state.cards.filter((c) => !c.matched).length / 2;
  refresh();
}

// ── Match lifecycle ─────────────────────────────────────────────────────────

function startLocalMatch(): void {
  const state = local.start(prefs.settings, prefs.playerName || "You", app.aiLevels);
  app.mode = "local";
  app.localPlayers = state.players;
  app.startedAt = Date.now();
  app.pairsLeft = prefs.settings.pairs;
  app.result = null;
  app.posted = false;
  app.sessionDeadline =
    EDITION.features.sessionLimitSec > 0 ? Date.now() + EDITION.features.sessionLimitSec * 1000 : 0;

  board.build(prefs.settings, state.cards);
  board.setPlacement(prefs.placement);
  ui.hide();
  ui.hud.setVisible(true);
  refresh();
}

function startNetMatch(room: RoomView): void {
  app.mode = "net";
  app.startedAt = room.startedAt;
  app.result = null;
  app.posted = false;

  // The server withholds every symbol until a card is legitimately turned, so
  // the board is built from face-down placeholders and filled in by `reveal`.
  board.build(
    room.settings,
    room.cards.map((c) => ({
      index: c.index,
      symbol: c.symbol ?? -1,
      faceUp: c.faceUp,
      matched: c.matched,
      matchedBy: c.matchedBy,
    })),
  );
  board.setPlacement(prefs.placement);
  ui.hide();
  ui.hud.setVisible(true);
  refresh();
}

function flipCard(index: number): void {
  if (app.mode === "local") local.flip(index);
  else if (app.mode === "net") net.flip(index);
}

function finishMatch(result: MatchResult): void {
  app.result = result;
  app.sessionDeadline = 0;
  board.setInteractive(false);
  ui.hud.setVisible(false);

  const self = result.results.find((r) => r.playerId === app.selfId || !r.isAi);
  audio.play(self && self.rank === 1 ? "win" : "lose");

  ui.show("results", { result, players: players(), posted: app.posted });
}

function leaveMatch(): void {
  local.end();
  if (app.mode === "net") net.leaveRoom();
  app.mode = "idle";
  app.room = null;
  app.result = null;
  app.sessionDeadline = 0;
  ui.hud.setVisible(false);
  ui.show("home", homeProps());
}

// ── Screen props ────────────────────────────────────────────────────────────

function homeProps() {
  return {
    playerName: prefs.playerName,
    settings: prefs.settings,
    status: app.netStatus,
    latencyMs: app.latency,
    canResume: app.mode !== "idle" && app.result === null,
  };
}

function hostProps() {
  return {
    code: app.room?.code ?? "",
    players: players(),
    maxPlayers: app.room?.maxPlayers ?? EDITION.features.maxPlayers,
    settings: app.room?.settings ?? prefs.settings,
    isHost: app.room ? app.room.hostId === app.selfId : true,
    status: app.netStatus,
    selfId: app.selfId,
  };
}

function settingsProps() {
  return {
    settings: prefs.settings,
    toggles: prefs.toggles,
    theme: prefs.theme,
    placement: prefs.placement,
    symbolSets: SYMBOL_SETS.map((s) => ({ id: s.id, name: s.name })),
    version: `${EDITION.name} ${VERSION}`,
  };
}

/** Re-renders whichever screen is showing, plus the always-on HUD. */
function refresh(): void {
  ui.hud.set({
    players: players(),
    selfId: app.selfId,
    turnSeat: app.turnSeat,
    mode: prefs.settings.mode,
    pairsLeft: app.pairsLeft,
    pairsTotal: (app.room?.settings ?? prefs.settings).pairs,
    turnDeadline: app.room?.turnDeadline ?? 0,
    turnSeconds: (app.room?.settings ?? prefs.settings).turnSeconds,
    status: app.netStatus,
    latencyMs: app.latency,
    startedAt: app.startedAt,
    watermark: EDITION.features.watermark,
  });

  // `current()` keeps reporting the last screen after `hide()`, so re-rendering
  // it unconditionally re-opens the menu — which left it floating over the
  // board for the whole match, because starting a game hides the menu and then
  // immediately refreshes. The HUD above is always live; the menu only when shown.
  if (!ui.visible()) return;

  switch (ui.current()) {
    case "home":
      ui.show("home", homeProps());
      break;
    case "host":
      ui.show("host", hostProps());
      break;
    case "join":
      ui.show("join", {
        code: app.joinCode,
        status: app.joinStatus,
        ...(app.joinMessage ? { message: app.joinMessage } : {}),
      });
      break;
    case "environments":
      ui.show("environments", { selectedId: prefs.settings.environmentId, customs: app.customs });
      break;
    case "board":
      ui.show("board", { settings: prefs.settings });
      break;
    case "players":
      ui.show("players", {
        players: players(),
        selfId: app.selfId,
        isHost: app.room ? app.room.hostId === app.selfId : true,
        maxPlayers: app.room?.maxPlayers ?? EDITION.features.maxPlayers,
        aiLevel: prefs.aiLevel,
      });
      break;
    case "leaderboard":
      ui.show("leaderboard", { ...app.leaderboard });
      break;
    case "settings":
      ui.show("settings", settingsProps());
      break;
    case "assistant":
      ui.show("assistant", {
        answer: app.assistantAnswer,
        busy: app.assistantBusy,
        suggestions: assistant.suggestionsFor(ui.current() ?? "home"),
        tour: tourStep(),
      });
      break;
    default:
      break;
  }
}

// ── Environment ─────────────────────────────────────────────────────────────

async function applyEnvironment(id: string): Promise<void> {
  const spec =
    app.customs.find((c) => c.id === id) ??
    (allowsEnvironment(EDITION, id) ? getEnvironment(id) : getEnvironment(DEFAULT_ENVIRONMENT_ID));

  prefs.settings.environmentId = spec.id;
  savePrefs(prefs);

  // Passthrough is a different XR session type, not just a different skybox.
  const wantsAr = spec.kind === "passthrough";
  if (wantsAr && engine.mode === "vr") await engine.requestSession("ar");
  if (!wantsAr && engine.mode === "ar") await engine.requestSession("vr");

  await environment.apply(spec);
  board.setPlacement(wantsAr ? "table" : prefs.placement);
  refresh();
}

environment.onFallback((requested, used) => {
  ui.toasts.push(`${requested.name} could not load — showing ${used.name}`);
});

// ── UI actions ──────────────────────────────────────────────────────────────

ui.onAction((action: UiAction) => {
  switch (action.type) {
    case "navigate":
      openScreen(action.screen);
      break;
    case "back":
    case "closeMenu":
      ui.hide();
      break;
    case "openMenu":
      openScreen("home");
      break;

    case "playSolo":
      startLocalMatch();
      break;
    case "resumeMatch":
      ui.hide();
      break;
    case "hostRoom":
      if (!EDITION.features.onlineMultiplayer) return upsell("onlineMultiplayer");
      void hostRoom();
      break;
    case "joinRoomIntent":
      if (!EDITION.features.onlineMultiplayer) return upsell("onlineMultiplayer");
      app.joinCode = "";
      app.joinStatus = "idle";
      openScreen("join");
      break;

    case "startGame":
      if (app.mode === "net") net.startGame();
      else startLocalMatch();
      break;
    case "cancelRoom":
      leaveMatch();
      break;
    case "setMaxPlayers":
      // Only meaningful before a room exists; the server owns it afterwards.
      break;

    case "codeChanged":
      app.joinCode = action.code;
      app.joinStatus = "idle";
      refresh();
      break;
    case "submitCode":
      if (!isValidRoomCode(action.code)) {
        app.joinStatus = "invalid";
        app.joinMessage = "That code is not six characters.";
        return refresh();
      }
      app.joinStatus = "checking";
      refresh();
      void net.connect(prefs.playerName || "Player").then(() => net.joinRoom(action.code));
      break;

    case "selectEnvironment":
      void applyEnvironment(action.environmentId);
      break;
    case "uploadPanorama":
      if (!EDITION.features.custom360) return upsell("custom360");
      void pickPanorama();
      break;

    case "setPairs":
      prefs.settings.pairs = Math.min(action.pairs, EDITION.features.maxPairs);
      savePrefs(prefs);
      if (app.mode === "net") net.updateSettings({ pairs: prefs.settings.pairs });
      refresh();
      break;
    case "setMode":
      prefs.settings.mode = action.mode;
      savePrefs(prefs);
      if (app.mode === "net") net.updateSettings({ mode: action.mode });
      refresh();
      break;

    case "addAi":
      if (app.mode === "net") net.addAi(action.level);
      else if (app.aiLevels.length < 7) app.aiLevels.push(action.level);
      refresh();
      break;
    case "setAiLevel":
      prefs.aiLevel = action.level;
      savePrefs(prefs);
      refresh();
      break;
    case "removeAi":
      if (app.mode === "net") net.removeAi(action.playerId);
      else app.aiLevels.pop();
      refresh();
      break;
    case "kickPlayer":
      net.removeAi(action.playerId);
      break;
    case "setPlayerName":
      prefs.playerName = action.name.slice(0, 18);
      savePrefs(prefs);
      refresh();
      break;

    case "setLeaderboardScope":
      app.leaderboard.scope = action.scope;
      app.leaderboard.loading = true;
      net.requestLeaderboard(action.scope);
      refresh();
      break;
    case "refreshLeaderboard":
      app.leaderboard.loading = true;
      net.requestLeaderboard(app.leaderboard.scope);
      refresh();
      break;
    case "postScore":
      app.posted = true;
      refresh();
      break;

    case "setTurnSeconds":
      prefs.settings.turnSeconds = action.seconds;
      savePrefs(prefs);
      refresh();
      break;
    case "setPeekMs":
      prefs.settings.peekMs = action.ms;
      savePrefs(prefs);
      refresh();
      break;
    case "setSymbolSet":
      prefs.settings.symbolSetId = action.symbolSetId;
      savePrefs(prefs);
      refresh();
      break;
    case "setPlacement":
      prefs.placement = action.placement;
      savePrefs(prefs);
      board.setPlacement(action.placement);
      ui.hud.setPlacement(action.placement);
      refresh();
      break;
    case "setTheme":
      prefs.theme = action.theme;
      savePrefs(prefs);
      // Everything that caches a derived colour rebuilds off the change event
      // fired inside setTheme; nothing else to do here.
      setTheme(action.theme);
      refresh();
      break;
    case "setToggle":
      prefs.toggles[action.key] = action.value;
      savePrefs(prefs);
      if (action.key === "sound") audio.setMuted(!action.value);
      refresh();
      break;
    case "recentre":
      engine.recentre();
      break;
    case "exitXr":
      void engine.endSession();
      break;
    case "openWhiteLabel":
      if (!EDITION.features.whiteLabel) return upsell("whiteLabel");
      ui.toasts.push(`Branding is configured per build — contact ${brand.contactEmail}`);
      break;

    case "askAssistant":
      void ask(action.question);
      break;
    case "startTour":
      app.tourIndex = 0;
      openScreen("assistant");
      break;
    case "tourStep":
      app.tourIndex = Math.max(0, Math.min(assistant.tour().length - 1, app.tourIndex + action.delta));
      refresh();
      break;
    case "endTour":
      app.tourIndex = -1;
      refresh();
      break;

    case "playAgain":
      if (app.mode === "net") net.startGame();
      else startLocalMatch();
      break;
    case "changeSetup":
      openScreen("board");
      break;
    case "returnHome":
      leaveMatch();
      break;

    case "sendEmote":
      if (app.mode === "net") net.emote(action.emote as EmoteId);
      else ui.hud.playEmote(0, action.emote as EmoteId);
      break;

    case "showUpgrade":
      ui.toasts.push(`${action.reason} — contact ${brand.contactEmail}`);
      break;
  }
});

function openScreen(screen: ScreenId): void {
  if (screen === "leaderboard" && EDITION.features.globalLeaderboard && app.netStatus === "online") {
    app.leaderboard.loading = true;
    net.requestLeaderboard(app.leaderboard.scope);
  }
  if (screen === "environments") void refreshCustoms();
  // `refresh` re-renders whatever `current()` reports, so show the screen with
  // placeholder-free props first and let refresh fill in anything async.
  ui.show(screen, screenPropsFor(screen));
  refresh();
}

function screenPropsFor(screen: ScreenId): never {
  // `refresh` immediately overwrites these, so the initial payload only has to
  // be structurally valid. Keeping one code path avoids a second prop builder
  // that could drift from the first.
  const map: Record<ScreenId, unknown> = {
    home: homeProps(),
    host: hostProps(),
    join: { code: app.joinCode, status: app.joinStatus },
    environments: { selectedId: prefs.settings.environmentId, customs: app.customs },
    board: { settings: prefs.settings },
    players: {
      players: players(),
      selfId: app.selfId,
      isHost: true,
      maxPlayers: EDITION.features.maxPlayers,
      aiLevel: prefs.aiLevel,
    },
    leaderboard: { ...app.leaderboard },
    settings: settingsProps(),
    assistant: { suggestions: assistant.suggestionsFor(screen), busy: app.assistantBusy },
    results: { result: app.result, players: players(), posted: app.posted },
  };
  return map[screen] as never;
}

function upsell(feature: string): void {
  ui.toasts.push(`Not included in ${EDITION.name}. ${brand.contactEmail} can enable ${feature}.`);
}

async function hostRoom(): Promise<void> {
  await net.connect(prefs.playerName || "Host");
  net.createRoom(prefs.settings, EDITION.features.maxPlayers);
  openScreen("host");
}

async function refreshCustoms(): Promise<void> {
  if (!EDITION.features.custom360 || !customPanoramaSupported()) return;
  app.customs = await customPanoramaSpecs();
  refresh();
}

/** Enterprise only: load a customer's own 360 photograph as a playable room. */
async function pickPanorama(): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      ui.toasts.push({ text: "Importing 360 image", key: "pano" });
      const added = await addCustomPanorama(file);
      ui.toasts.dismissKey("pano");
      await refreshCustoms();
      await applyEnvironment(added.id);
    } catch (err) {
      ui.toasts.dismissKey("pano");
      ui.toasts.push(err instanceof Error ? err.message : "That image could not be used");
    }
  };
  input.click();
}

/** The UI renders "step N of M", so position travels with the step. */
function tourStep() {
  if (app.tourIndex < 0) return null;
  const steps = assistant.tour();
  const step = steps[app.tourIndex];
  if (!step) return null;
  return { index: app.tourIndex, total: steps.length, title: step.title, body: step.body };
}

async function ask(question: string): Promise<void> {
  app.assistantBusy = true;
  refresh();
  const answer = await assistant.ask(question, {
    edition: EDITION,
    screen: ui.current() ?? "home",
    inGame: app.mode !== "idle" && app.result === null,
    settings: prefs.settings,
    players: app.localPlayers,
  });
  app.assistantBusy = false;
  app.assistantAnswer = answer;
  ui.setHighlight(answer.highlight ?? null);
  if (prefs.toggles.sound) voice.speak(answer.text);
  refresh();
}

// ── Frame loop ──────────────────────────────────────────────────────────────

engine.onFrame((dt, now) => {
  const pointers = engine.pointers();
  environment.update(dt, now);
  board.update(dt, now, pointers);
  ui.update(dt, pointers);
  ui.hud.update(dt, pointers);
  ui.toasts.update(dt);

  app.latency = net.latency();

  // Demo builds free the headset up for the next visitor at a trade stand.
  if (app.sessionDeadline > 0 && Date.now() > app.sessionDeadline) {
    app.sessionDeadline = 0;
    ui.toasts.push("Demo session ended — thanks for playing");
    leaveMatch();
  }
});

// Keep the board's grounding shadow under the board wherever it ends up.
{
  const centre = new THREE.Vector3();
  engine.onFrame(() => {
    board.group.getWorldPosition(centre);
    environment.setBoardAnchor(centre);
  });
}

engine.onModeChange((mode) => {
  if (mode === "none") {
    entry.show();
    ui.hide();
  } else {
    entry.hide();
    if (!app.mode || app.mode === "idle") ui.show("home", homeProps());
  }
});

// ── Entry screen ────────────────────────────────────────────────────────────

const entry = createEntryScreen({
  edition: EDITION,
  version: VERSION,
  onEnter: async (mode) => {
    entry.setBusy(true, "Starting");
    try {
      await audio.resume();
      await engine.requestSession(mode);
      await applyEnvironment(prefs.settings.environmentId);
      ui.show("home", homeProps());
    } catch (err) {
      entry.setError(err instanceof Error ? err.message : "Could not start the headset session");
    } finally {
      entry.setBusy(false);
    }
  },
  onPlayFlat: async () => {
    // Desktop visitors on vrent.ch get the real game on a flat screen.
    entry.hide();
    await audio.resume();
    await applyEnvironment(prefs.settings.environmentId);
    ui.show("home", homeProps());
  },
});

entry.mount(uiRoot);
audio.setMuted(!prefs.toggles.sound);

// An installed immersive PWA opens with no page to tap, so the app itself has
// to start the session; the launch tap is the user activation. Gated inside
// `maybeAutoEnterXR` so it never fires in a browser tab.
void maybeAutoEnterXR(engine, EDITION.features.mixedReality ? "ar" : "vr").then((entered) => {
  if (entered) void applyEnvironment(prefs.settings.environmentId);
});

// Surfacing failures beats a silently dead canvas in front of a customer.
window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled]", e.reason);
});
