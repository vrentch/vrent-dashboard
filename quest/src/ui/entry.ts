/**
 * The 2D screen shown before entering XR — and the page that sells the product.
 *
 * It has two jobs at once, and both matter commercially:
 *
 *   • In the headset browser it is the door into the session. WebXR will only
 *     grant an immersive session from a real user gesture, so there has to be a
 *     button, and that button had better be obvious.
 *   • On a desktop or a phone it is the product page a buyer lands on. So it
 *     carries the brand mark, what the thing actually is, the three editions
 *     with what each one includes, what "custom build" concretely means, and a
 *     way to start that conversation.
 *
 * Every claim on the page is read out of `shared/` — the editions, the room
 * catalogue, the board sizes, the game modes, and every franc of the pricing.
 * Nothing is retyped, so a change to the product is a change to the pitch, and
 * the pitch cannot drift into saying something the build does not do or quote a
 * price the company no longer charges. The one number format the page owns is
 * `formatMoney`, and every figure goes through it.
 *
 * Which build matters: a capability claim — the lede, the three steps, the
 * stats strip, the hero caption — is read out of `deps.edition.features`, not
 * out of the top edition, so a Demo APK never offers eight players or a room
 * code it has no server for. The three places that deliberately describe the
 * whole product rather than this build — the room catalogue, the tailoring
 * cards and the edition comparison — say so on the page: rooms outside the
 * build are dimmed and badged with the edition that includes them, and the
 * stats strip carries a line naming the build its numbers belong to.
 *
 * Capability detection decides which of the three faces the call-to-action
 * wears. Everything visual comes from `applyBrandCssVars` plus the token
 * properties this module publishes, so a palette or theme change re-skins the
 * page with no CSS edit and nothing is ever fetched from a font CDN.
 */

import "./entry.css";
import {
  activeThemeId,
  applyBrandCssVars,
  brand,
  isThemeId,
  luminance,
  onThemeChange,
  palette,
  rgba,
  scene,
  setTheme,
  text as ink,
  THEMES,
  tokens,
  type ThemeId,
} from "../../shared/brand.ts";
import { allowsEnvironment, EDITIONS, VAT_NOTE } from "../../shared/editions.ts";
import type {
  EditionFeatures,
  EditionId,
  EditionPricing,
  EditionSpec,
  PriceTier,
} from "../../shared/editions.ts";
import { ENVIRONMENTS } from "../../shared/environments.ts";
import type { EnvironmentKind, EnvironmentSpec } from "../../shared/environments.ts";
import { BOARD_PRESETS, GAME_MODES } from "../../shared/game.ts";
import type { BoardPreset } from "../../shared/game.ts";

// ── Capability detection ────────────────────────────────────────────────────

export type EntryDevice = "headset" | "desktop" | "mobile";

export interface EntryCapabilities {
  device: EntryDevice;
  /** `navigator.xr` exists at all. */
  hasWebXr: boolean;
  /** Passthrough mixed reality is available. */
  ar: boolean;
  /** Fully immersive VR is available. */
  vr: boolean;
  /** Page is on a secure origin — WebXR silently refuses otherwise. */
  secure: boolean;
}

/** Minimal structural type; avoids depending on ambient WebXR declarations. */
interface XrLike {
  isSessionSupported(mode: string): Promise<boolean>;
}

function xrSystem(): XrLike | null {
  const nav = navigator as Navigator & { xr?: XrLike };
  return nav.xr ?? null;
}

function detectDevice(): EntryDevice {
  const ua = navigator.userAgent;
  // Quest's browser reports OculusBrowser; the Wolvic/Quest 3 strings include
  // "Quest". Either way it is a headset and should go straight to the CTA.
  if (/OculusBrowser|Quest|Pico|Vive|Wolvic/i.test(ua)) return "headset";
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  if (coarse && Math.min(window.screen.width, window.screen.height) < 820) return "mobile";
  return "desktop";
}

export async function detectCapabilities(): Promise<EntryCapabilities> {
  const device = detectDevice();
  const secure = window.isSecureContext !== false;
  const xr = xrSystem();
  if (!xr) return { device, hasWebXr: false, ar: false, vr: false, secure };

  const [ar, vr] = await Promise.all([
    xr.isSessionSupported("immersive-ar").catch(() => false),
    xr.isSessionSupported("immersive-vr").catch(() => false),
  ]);
  return { device, hasWebXr: true, ar, vr, secure };
}

// ── Theme persistence ───────────────────────────────────────────────────────

/**
 * Where a theme chosen *on this page* is remembered.
 *
 * `main.ts` owns the in-headset preferences under `vrent-memory-xr.prefs` and
 * is their only writer — writing that record from here would be silently
 * reverted the next time any other setting changed. So the page keeps its own
 * key and only *reads* the app's as a fallback, which means a theme picked in
 * the headset settings is not stomped by the OS preference on the next boot.
 *
 * Resolution order on load: this key → the app's saved theme → the OS
 * `prefers-color-scheme`. Until the visitor makes an explicit choice the page
 * keeps following the OS live, including a change made while it is open.
 */
const THEME_KEY = "vrent-memory-xr.theme";
const APP_PREFS_KEY = "vrent-memory-xr.prefs";

const THEME_ORDER: readonly ThemeId[] = ["dark", "light"];

function storedTheme(): ThemeId | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isThemeId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function appPrefsTheme(): ThemeId | null {
  try {
    const raw = localStorage.getItem(APP_PREFS_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { theme?: unknown };
    return isThemeId(saved.theme) ? saved.theme : null;
  } catch {
    // Corrupt or unreadable storage must never decide whether the page renders.
    return null;
  }
}

function rememberTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* private browsing, quota — a theme is not worth failing over. */
  }
}

function systemQuery(): MediaQueryList | null {
  try {
    return window.matchMedia("(prefers-color-scheme: light)");
  } catch {
    return null;
  }
}

function systemTheme(mq: MediaQueryList | null): ThemeId {
  return mq?.matches ? "light" : "dark";
}

// ── Public shape ────────────────────────────────────────────────────────────

export interface EntryScreenDeps {
  edition: EditionSpec;
  version?: string;
  /** Start an immersive session. Throwing shows an inline error. */
  onEnter: (mode: "ar" | "vr") => void | Promise<void>;
  /** Start the flat-screen fallback. Omit to hide that route. */
  onPlayFlat?: () => void | Promise<void>;
}

export interface EntryScreen {
  readonly el: HTMLElement;
  mount(parent?: HTMLElement): void;
  show(): void;
  hide(): void;
  setBusy(busy: boolean, label?: string): void;
  setError(message: string | null): void;
  capabilities(): EntryCapabilities | null;
  /** Re-runs detection, e.g. after the user grants a permission. */
  refresh(): Promise<void>;
  dispose(): void;
}

const EDITION_ORDER: readonly EditionId[] = ["demo", "pro", "enterprise"];

export function createEntryScreen(deps: EntryScreenDeps): EntryScreen {
  applyBrandCssVars();
  applyTokenCssVars();

  const el = document.createElement("div");
  el.className = "vr-entry";
  el.innerHTML = SHELL;

  const $ = <T extends HTMLElement>(sel: string): T => {
    const found = el.querySelector<T>(sel);
    if (!found) throw new Error(`entry: missing ${sel}`);
    return found;
  };

  const ctaEl = $<HTMLDivElement>("[data-cta]");
  const statusEl = $<HTMLParagraphElement>("[data-status]");
  const statusText = $<HTMLSpanElement>("[data-status-text]");
  const noteEl = $<HTMLDivElement>("[data-note]");
  const noteTitle = $<HTMLParagraphElement>("[data-note-title]");
  const noteBody = $<HTMLParagraphElement>("[data-note-body]");
  const urlEl = $<HTMLSpanElement>("[data-url]");
  const errorEl = $<HTMLParagraphElement>("[data-error]");
  const pointsEl = $<HTMLUListElement>("[data-points]");

  const cleanups: (() => void)[] = [];

  // ── Copy driven by brand and product data ────────────────────────────────

  // Every number below describes *this* build. Reading them off the top
  // edition is how a sales page ends up promising a server the APK in the
  // visitor's hands does not talk to.
  const edition = deps.edition;
  const boards = editionBoards(edition.features);
  const smallestBoard = boards[0];
  const largestBoard = boards[boards.length - 1];

  $("[data-title]").textContent = brand.tagline;
  $("[data-lede]").textContent = ledeFor(edition);
  $("[data-product]").textContent = brand.shortName;
  $("[data-brandname]").textContent = brand.name;
  $("[data-edition-badge]").textContent = editionLabel(edition.id);
  $("[data-version]").textContent = deps.version ? `v${deps.version}` : "";
  $("[data-art-caption]").textContent =
    `${smallestBoard.pairs * 2} to ${largestBoard.pairs * 2} cards`;
  urlEl.textContent = brand.website.replace(/^https?:\/\//, "");

  $<HTMLAnchorElement>("[data-brand-link]").href = brand.website;
  const site = $<HTMLAnchorElement>("[data-site]");
  site.href = brand.website;
  site.textContent = brand.website.replace(/^https?:\/\//, "");
  const mail = $<HTMLAnchorElement>("[data-mail]");
  mail.href = `mailto:${brand.contactEmail}`;
  mail.textContent = brand.contactEmail;
  $("[data-copy]").textContent = `${brand.name} · ${edition.name}`;

  // The contact route, written out three ways: a button, a plain address that
  // can be selected in a headset where `mailto:` opens nothing, and the domain.
  const contactBtn = $<HTMLAnchorElement>("[data-contact-mail]");
  contactBtn.href = `mailto:${brand.contactEmail}?subject=${encodeURIComponent(
    `${brand.shortName} — custom build`,
  )}`;
  contactBtn.insertAdjacentHTML("afterbegin", ICONS.arrow);
  $("[data-contact-mail-label]").textContent = `Email ${brand.contactEmail}`;
  $("[data-contact-address]").textContent = brand.contactEmail;
  const contactSite = $<HTMLAnchorElement>("[data-contact-site]");
  contactSite.href = brand.website;
  contactSite.textContent = brand.website.replace(/^https?:\/\//, "");

  for (const point of edition.sellingPoints) {
    const li = document.createElement("li");
    li.textContent = point;
    pointsEl.appendChild(li);
  }

  renderSteps($("[data-steps]"), edition);
  renderStats($("[data-stats]"), edition);
  renderStatsScope($("[data-stats-note]"), edition);
  renderRooms($("[data-rooms]"), edition);
  $("[data-rooms-aside]").textContent = roomsAside(edition);
  renderTailoring($("[data-tailoring]"));
  renderPricing($("[data-pricing]"));
  // The one place VAT is mentioned. It belongs under the figures it qualifies
  // and nowhere else — repeated, it starts to read as a disclaimer.
  $("[data-vat]").textContent = VAT_NOTE;
  renderEditions($("[data-editions]"), edition.id);

  // ── Theme control ────────────────────────────────────────────────────────

  const themeGroup = $<HTMLDivElement>("[data-theme]");
  const themeButtons = new Map<ThemeId, HTMLButtonElement>();
  for (const id of THEME_ORDER) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vr-theme__opt";
    b.title = `${THEMES[id].name} theme`;
    b.innerHTML = THEME_ICONS[id];
    const label = document.createElement("span");
    label.className = "vr-sr";
    label.textContent = `${THEMES[id].name} theme`;
    b.appendChild(label);
    b.addEventListener("click", () => chooseTheme(id));
    themeGroup.appendChild(b);
    themeButtons.set(id, b);
  }

  /**
   * Rewrites everything this module *derived* from the palette. `palette`,
   * `text` and `scene` are mutated in place on a theme change, so the token
   * custom properties, the browser chrome colour and the control's own state
   * are all stale until they are written again.
   */
  function syncTheme(): void {
    const id = activeThemeId();
    applyTokenCssVars();
    themeGroup.dataset.active = id;
    for (const [key, b] of themeButtons) b.setAttribute("aria-pressed", String(key === id));
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = palette.ink;
  }

  // True while nobody has expressed a preference, in which case the OS keeps
  // driving — including a change made while the page is open.
  let followingSystem = storedTheme() === null && appPrefsTheme() === null;
  let settled = false;

  function chooseTheme(id: ThemeId): void {
    followingSystem = false;
    rememberTheme(id);
    setTheme(id); // A no-op when already active…
    syncTheme(); // …so the control is synced unconditionally.
  }

  cleanups.push(
    onThemeChange(() => {
      // A change made anywhere else — the in-headset settings screen — counts
      // as a preference too, once the visitor has one at all.
      if (settled && !followingSystem) rememberTheme(activeThemeId());
      syncTheme();
    }),
  );

  const mq = systemQuery();
  setTheme(storedTheme() ?? appPrefsTheme() ?? systemTheme(mq));
  settled = true;
  syncTheme();

  if (mq) {
    const onSystem = () => {
      if (followingSystem) setTheme(systemTheme(mq));
    };
    mq.addEventListener("change", onSystem);
    cleanups.push(() => mq.removeEventListener("change", onSystem));
  }

  // ── State ────────────────────────────────────────────────────────────────

  let caps: EntryCapabilities | null = null;
  let busy = false;

  function setStatus(tone: "idle" | "ready" | "warn" | "error", message: string): void {
    statusEl.dataset.tone = tone;
    statusText.textContent = message;
  }

  function setError(message: string | null): void {
    errorEl.textContent = message ?? "";
    errorEl.classList.toggle("is-shown", !!message);
  }

  function setNote(title: string | null, body?: string, showUrl = false): void {
    noteEl.classList.toggle("is-shown", !!title);
    if (!title) return;
    noteTitle.textContent = title;
    noteBody.textContent = body ?? "";
    urlEl.hidden = !showUrl;
  }

  function setBusy(next: boolean, label?: string): void {
    busy = next;
    for (const b of ctaEl.querySelectorAll("button")) {
      b.disabled = next;
      b.classList.toggle("is-busy", next && b.dataset.primary === "true");
    }
    if (label) setStatus(next ? "warn" : "ready", label);
  }

  /** Wraps a CTA handler so a rejected session request surfaces, not vanishes. */
  function run(label: string, fn: () => void | Promise<void>): () => void {
    return () => {
      if (busy) return;
      setError(null);
      setBusy(true, label);
      Promise.resolve()
        .then(fn)
        .then(() => setBusy(false))
        .catch((err: unknown) => {
          setBusy(false);
          const msg = err instanceof Error ? err.message : String(err);
          setError(
            /denied|NotAllowed/i.test(msg)
              ? "The headset declined the session. Check that the browser has permission and try again."
              : `Could not start the session. ${msg}`,
          );
          setStatus("error", "Session not started");
        });
    };
  }

  function addButton(o: {
    label: string;
    primary?: boolean;
    icon?: "headset" | "play" | "arrow";
    onClick: () => void;
  }): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `vr-btn${o.primary ? " vr-btn--primary" : ""}`;
    if (o.primary) b.dataset.primary = "true";
    if (o.icon) b.insertAdjacentHTML("afterbegin", ICONS[o.icon]);
    const span = document.createElement("span");
    span.textContent = o.label;
    b.appendChild(span);
    b.addEventListener("click", o.onClick);
    ctaEl.appendChild(b);
    return b;
  }

  function scrollTo(selector: string): void {
    el.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Capability-driven call to action ─────────────────────────────────────

  function buildCta(c: EntryCapabilities): void {
    ctaEl.replaceChildren();
    setNote(null);
    const mrAllowed = deps.edition.features.mixedReality;

    if (!c.secure) {
      setStatus("error", "Needs a secure (https) connection");
      setNote(
        "WebXR needs https",
        "Browsers only hand out immersive sessions on a secure origin. Serve this page over https or from localhost.",
      );
      if (deps.onPlayFlat) {
        addButton({ label: "Play on this screen", primary: true, icon: "play", onClick: run("Starting…", deps.onPlayFlat) });
      }
      return;
    }

    if (c.ar || c.vr) {
      // A headset, or a desktop with an emulator. Lead with mixed reality when
      // the edition includes it — that is the demo that sells the product.
      if (c.ar && mrAllowed) {
        addButton({
          label: "Enter Mixed Reality",
          primary: true,
          icon: "headset",
          onClick: run("Starting mixed reality…", () => deps.onEnter("ar")),
        });
      }
      if (c.vr) {
        // When passthrough is the headline route, VR steps back to a secondary.
        const secondary = c.ar && mrAllowed;
        addButton({
          label: "Enter VR",
          primary: !secondary,
          icon: secondary ? "arrow" : "headset",
          onClick: run("Starting VR…", () => deps.onEnter("vr")),
        });
      }
      setStatus(
        "ready",
        c.device === "headset"
          ? `Headset ready · ${c.ar && mrAllowed ? "passthrough and VR available" : "VR available"}`
          : "WebXR device detected in this browser",
      );
      if (c.ar && mrAllowed) {
        setNote(
          "Put the board on your real table",
          "Mixed reality keeps your room visible through the headset cameras. Look at a clear surface when the board appears, or recentre from Settings.",
        );
      }
      return;
    }

    if (c.device === "mobile") {
      setStatus("warn", "Phones cannot run mixed reality");
      setNote(
        "Open this on your Quest 3",
        "Type this address into the headset's browser, or install the app from the Meta store. The full game needs the headset's cameras and controllers.",
        true,
      );
      if (deps.onPlayFlat) {
        addButton({ label: "Try the flat-screen version", primary: true, icon: "play", onClick: run("Starting…", deps.onPlayFlat) });
      }
      addButton({ label: "What it costs", onClick: () => scrollTo("[data-pricing-section]") });
      return;
    }

    // Desktop, no WebXR.
    setStatus("warn", c.hasWebXr ? "No headset connected to this browser" : "This browser has no WebXR support");
    setNote(
      "The full game runs on a Meta Quest 3",
      "Open this address in the headset's browser and the same page turns into the mixed-reality game. On this screen you can play the same board with a mouse.",
      true,
    );
    if (deps.onPlayFlat) {
      addButton({ label: "Play on this screen", primary: true, icon: "play", onClick: run("Starting…", deps.onPlayFlat) });
    }
    addButton({
      label: "What it costs",
      icon: "arrow",
      onClick: () => scrollTo("[data-pricing-section]"),
    });
  }

  async function refresh(): Promise<void> {
    setStatus("idle", "Checking this device…");
    caps = await detectCapabilities();
    buildCta(caps);
  }

  // Detection is async; give the user something honest in the meantime.
  setStatus("idle", "Checking this device…");
  void refresh();

  // Keyboard shortcut: Enter starts the primary route. Faster in the headset
  // browser with a paired keyboard, and it costs nothing.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || busy || el.classList.contains("is-hidden")) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "BUTTON" || target.tagName === "A")) return;
    ctaEl.querySelector<HTMLButtonElement>('button[data-primary="true"]')?.click();
  };
  window.addEventListener("keydown", onKey);
  cleanups.push(() => window.removeEventListener("keydown", onKey));

  return {
    el,
    mount(parent: HTMLElement = document.body): void {
      parent.appendChild(el);
    },
    show(): void {
      el.classList.remove("is-hidden");
      el.removeAttribute("aria-hidden");
    },
    hide(): void {
      el.classList.add("is-hidden");
      el.setAttribute("aria-hidden", "true");
    },
    setBusy,
    setError,
    capabilities: () => caps,
    refresh,
    dispose(): void {
      for (const c of cleanups) c();
      cleanups.length = 0;
      el.remove();
    },
  };
}

// ── Section builders ────────────────────────────────────────────────────────

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (content !== undefined) n.textContent = content;
  return n;
}

// ── What this build can actually do ─────────────────────────────────────────
//
// Four readings of the edition's own feature flags. Everything the page claims
// about capacity goes through one of them, so a Demo build cannot describe a
// board, a room or a player count it will refuse to produce.

/** The board sizes the picker will actually offer in this build. */
function editionBoards(f: EditionFeatures): readonly BoardPreset[] {
  const offered = BOARD_PRESETS.filter((p) => p.pairs <= f.maxPairs);
  return offered.length > 0 ? offered : [BOARD_PRESETS[0]];
}

/** The rooms this build may load, in catalogue order. */
function editionRooms(spec: EditionSpec): readonly EnvironmentSpec[] {
  return ENVIRONMENTS.filter((e) => allowsEnvironment(spec, e.id));
}

/** Rooms that are somewhere other than the player's own, i.e. countable ones. */
function editionSceneRooms(spec: EditionSpec): number {
  return editionRooms(spec).filter((e) => e.kind !== "passthrough").length;
}

/** True when the visitor's own room is a place this build can put the board. */
function editionUsesRealRoom(spec: EditionSpec): boolean {
  return (
    spec.features.mixedReality &&
    editionRooms(spec).some((e) => e.kind === "passthrough")
  );
}

/** "Pro", "Pro and Enterprise" — for pointing at what this build leaves out. */
function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The editions whose feature flags satisfy `pred`, named. */
function editionsWhere(pred: (f: EditionFeatures) => boolean): string {
  return joinNames(
    EDITION_ORDER.filter((id) => pred(EDITIONS[id].features)).map(editionLabel),
  );
}

/**
 * The opening claim, and the one a buyer is most likely to quote back. A build
 * with no server has no room codes to offer, so it does not offer them.
 */
function ledeFor(spec: EditionSpec): string {
  const f = spec.features;
  const where = editionUsesRealRoom(spec)
    ? "in your real room or in a rendered one"
    : "in a rendered room";

  if (f.onlineMultiplayer) {
    return (
      `Up to ${f.maxPlayers} people around one board, ${where}. ` +
      "It runs in the headset's own browser, so a guest joins by reading a six-character code — " +
      "nothing to install, no account to make."
    );
  }
  const who = f.aiOpponents ? "One player against the machine" : "A single player at the board";
  return (
    `${who}, ${where}. It runs standalone in the headset's own browser — ` +
    "nothing to install, no account to make, no server behind it."
  );
}

/** How a session actually runs, in the order a buyer will experience it. */
function renderSteps(host: HTMLElement, spec: EditionSpec): void {
  const f = spec.features;
  const boards = editionBoards(f);
  const first = boards[0];
  const last = boards[boards.length - 1];
  const online = editionsWhere((o) => o.onlineMultiplayer);

  const solo = f.aiOpponents
    ? `This build plays solo: ${f.aiLevels.length} AI difficulties take the seat opposite, so a ` +
      "visitor never waits for a second player."
    : "This build plays solo — one visitor, one board, no waiting for anyone.";

  const steps: readonly { title: string; body: string }[] = [
    {
      title: "Open it in the headset",
      body:
        "This page is the whole app. In the Quest browser one tap starts the immersive " +
        "session; for a fixed installation the same build ships as a signed Android package.",
    },
    f.onlineMultiplayer
      ? {
          title: "Everyone joins with a code",
          body:
            `The host reads out a six-character room code and up to ${f.maxPlayers} players share one board. ` +
            `${f.aiLevels.length} AI difficulties fill any empty seat, so a single visitor always has a game.`,
        }
      : {
          title: "Start playing on your own",
          body: online
            ? `${solo} Shared boards behind a six-character room code come with ${online}.`
            : solo,
        },
    {
      title: editionUsesRealRoom(spec) ? "Play in your room, or another" : "Pick a room",
      body:
        (editionUsesRealRoom(spec)
          ? "Passthrough puts the board on your real table; otherwise pick a room. "
          : "The board stands in a rendered room of your choosing. ") +
        `Boards run from ${first.pairs * 2} to ${last.pairs * 2} cards across ` +
        `${GAME_MODES.length} modes: ${GAME_MODES.map((m) => m.name).join(", ")}.`,
    },
  ];

  host.replaceChildren();
  steps.forEach((step, i) => {
    const item = node("article", "vr-step");
    item.appendChild(node("span", "vr-step__n", String(i + 1).padStart(2, "0")));
    item.appendChild(node("h3", "vr-step__title", step.title));
    item.appendChild(node("p", "vr-step__body", step.body));
    host.appendChild(item);
  });
}

/**
 * Hard numbers — the part of the page a buyer screenshots, so every one of the
 * five is this build's own figure. The strip is exactly five cells wide by
 * design (the stylesheet lays out five), so a capability this build lacks
 * changes what a cell says rather than removing it.
 */
function renderStats(host: HTMLElement, spec: EditionSpec): void {
  const f = spec.features;
  const boards = editionBoards(f);
  const cards = boards.map((p) => p.pairs * 2);
  const levels = f.aiOpponents ? f.aiLevels : [];

  const seats = f.onlineMultiplayer
    ? { value: String(f.maxPlayers), label: "Players in a room", detail: "One six-character code" }
    : {
        value: String(f.maxPlayers),
        label: f.maxPlayers === 1 ? "Player at the board" : "Players at the board",
        detail: f.aiOpponents ? "Plus an AI opponent" : "Solo play",
      };

  const stats: readonly { value: string; label: string; detail: string }[] = [
    seats,
    {
      value: cards.length > 1 ? `${cards[0]}–${cards[cards.length - 1]}` : String(cards[0]),
      label: "Cards on the board",
      detail: `${boards.length} preset ${boards.length === 1 ? "size" : "sizes"}`,
    },
    {
      value: String(GAME_MODES.length),
      label: "Game modes",
      detail: GAME_MODES.map((m) => m.name).join(", "),
    },
    {
      value: String(editionSceneRooms(spec)),
      label: "Rooms included",
      detail: editionUsesRealRoom(spec) ? "Plus your real one" : "Rendered rooms only",
    },
    {
      value: String(levels.length),
      label: "AI difficulties",
      detail:
        levels.length > 1
          ? `${sentenceCase(levels[0])} to ${levels[levels.length - 1]}`
          : levels.length === 1
            ? sentenceCase(levels[0])
            : "No AI opponents in this build",
    },
  ];

  host.replaceChildren();
  for (const stat of stats) {
    const item = node("div", "vr-stat");
    item.appendChild(node("span", "vr-stat__value", stat.value));
    item.appendChild(node("span", "vr-stat__label", stat.label));
    item.appendChild(node("span", "vr-stat__detail", stat.detail));
    host.appendChild(item);
  }
}

function sentenceCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * One line under the strip naming whose numbers those are. It appears only on
 * a build that some other edition beats, which is exactly the case where five
 * modest figures would otherwise read as the ceiling of the product.
 */
function renderStatsScope(host: HTMLElement, spec: EditionSpec): void {
  const f = spec.features;
  const capped = EDITION_ORDER.some((id) => {
    const other = EDITIONS[id];
    return (
      other.features.maxPlayers > f.maxPlayers ||
      other.features.maxPairs > f.maxPairs ||
      editionSceneRooms(other) > editionSceneRooms(spec)
    );
  });

  host.textContent = capped
    ? `Figures for the ${editionLabel(spec.id)} build. The editions below set out what the others add.`
    : "";
  host.hidden = !capped;
}

function roomKindLabel(kind: EnvironmentKind): string {
  return kind === "passthrough" ? "Your room" : kind === "procedural" ? "Rendered" : "360 photo";
}

/** The cheapest edition that can load `envId`, or null if none can. */
function firstEditionWithRoom(envId: string): EditionId | null {
  return EDITION_ORDER.find((id) => allowsEnvironment(EDITIONS[id], envId)) ?? null;
}

/** Says whether the grid below is the whole catalogue or only this build's. */
function roomsAside(spec: EditionSpec): string {
  const all = ENVIRONMENTS.every((e) => allowsEnvironment(spec, e.id));
  return all
    ? "Your real room, a rendered one, or a photograph of yours."
    : `The whole catalogue — rooms outside the ${editionLabel(spec.id)} build are marked.`;
}

/**
 * The room catalogue, straight from the environment specs.
 *
 * The grid shows every room the product has, because that is what a buyer is
 * choosing between. Rooms this build cannot load are dimmed and badged with
 * the edition that includes them, so the catalogue never reads as an
 * inventory of what the headset in front of the visitor will offer.
 */
function renderRooms(host: HTMLElement, spec: EditionSpec): void {
  host.replaceChildren();
  for (const room of ENVIRONMENTS) {
    const included = allowsEnvironment(spec, room.id);
    const item = node("article", `vr-room${included ? "" : " is-locked"}`);
    item.dataset.kind = room.kind;

    // The tint is the scene's own colour, not a palette colour: it is what the
    // room looks like in the headset. Used as a decorative chip only, with a
    // hairline ring so a pale tint still reads on a light surface.
    const swatch = node("span", "vr-room__swatch");
    swatch.style.setProperty("--tint", room.tint);
    item.appendChild(swatch);

    const body = node("div", "vr-room__body");
    const head = node("div", "vr-room__head");
    head.appendChild(node("h3", "vr-room__name", room.name));
    if (!included) {
      const owner = firstEditionWithRoom(room.id);
      head.appendChild(
        node("span", "vr-room__tag", owner ? `In ${editionLabel(owner)}` : "Not shipped"),
      );
    }
    head.appendChild(node("span", "vr-room__kind", roomKindLabel(room.kind)));
    body.appendChild(head);
    body.appendChild(node("p", "vr-room__blurb", room.blurb));
    item.appendChild(body);

    host.appendChild(item);
  }
}

/** What "we build it for you" concretely means, with no promises attached. */
function renderTailoring(host: HTMLElement): void {
  const ent = EDITIONS.enterprise;
  const panoramas = ENVIRONMENTS.filter((e) => e.kind === "panorama").length;

  const items: readonly { icon: keyof typeof TAILOR_ICONS; title: string; body: string }[] = [
    {
      icon: "brandmark",
      title: "Your palette and logo",
      body:
        "One file defines every colour in the product, and the 2D page, the floating panels, " +
        "the card faces, the room lighting and the app icon all read from it. Hand over your " +
        "brand colours and the whole thing arrives wearing them — in both a light and a dark theme.",
    },
    {
      icon: "sphere",
      title: "Your space, in 360",
      body:
        `Any equirectangular photograph becomes a playable room. ${panoramas} slots stand in the ` +
        "catalogue as placeholders for exactly that, and an Enterprise operator can load a " +
        "further panorama from inside the headset without waiting for a new build.",
    },
    {
      icon: "code",
      title: "Your rooms and your codes",
      body:
        "Private rooms, six-character codes and an exportable leaderboard, so a tournament at " +
        "a stand or an internal league keeps its results afterwards rather than losing them " +
        "when the headset is put down.",
    },
    {
      icon: "package",
      title: "Your build",
      body:
        "A separate signed Android package, so the headset shows your app rather than a " +
        `demo of ours. ${editionLabel(ent.id)} ships from the template id ${ent.packageId} and is ` +
        `rebuilt under your own reverse-DNS id, with no ${brand.name} watermark in the headset.`,
    },
  ];

  host.replaceChildren();
  for (const item of items) {
    const card = node("article", "vr-tailor");
    card.insertAdjacentHTML("afterbegin", TAILOR_ICONS[item.icon]);
    card.appendChild(node("h3", "vr-tailor__title", item.title));
    card.appendChild(node("p", "vr-tailor__body", item.body));
    host.appendChild(card);
  }
}

// ── Pricing ─────────────────────────────────────────────────────────────────

/**
 * Money, written once, the way this page writes it everywhere: currency first,
 * thousands grouped, and no decimals on a whole franc — `CHF 4,900`, never
 * `CHF 4900`. The grouping is done here rather than by `Intl.NumberFormat`
 * because the locale a visitor's browser happens to be set to must not decide
 * how a Swiss price list is punctuated: the same figure has to read identically
 * next to the `headline` strings the edition specs already carry.
 *
 * `currency` comes off the pricing block rather than being assumed, so a second
 * currency added upstream prints correctly instead of silently saying CHF.
 */
function formatMoney(amount: number, currency: EditionPricing["currency"]): string {
  const abs = Math.abs(amount);
  const cents = Math.round(abs * 100) % 100;
  const whole = String(Math.floor(abs)).replace(/\B(?=(\d{3})+$)/g, ",");
  const tail = cents > 0 ? `.${String(cents).padStart(2, "0")}` : "";
  return `${currency} ${amount < 0 ? "-" : ""}${whole}${tail}`;
}

/**
 * The edition VRENT points a customer at by default. Marked on the card, not
 * dressed up: it is the one that fits an event, which is what most enquiries
 * turn out to be.
 */
const RECOMMENDED: EditionId = "pro";

/**
 * What the card's button says, and the subject line it arrives with. The
 * subject names the edition so a reply thread starts already scoped — an inbox
 * full of "Website enquiry" is a worse outcome than no button at all.
 */
const ASK: Record<EditionId, { label: string; subject: string }> = {
  demo: { label: "Ask about a rental", subject: "Demo edition, with a rental" },
  pro: { label: "Ask about Pro", subject: "Pro edition, per event or per year" },
  enterprise: { label: "Ask about Enterprise", subject: "Enterprise edition, custom build" },
};

/**
 * The per-event tiers, which are the whole argument: they are named and sized
 * after the hardware packages the customer is already renting, so the game
 * reads as a line on that quote rather than as a separate purchase.
 */
function renderTiers(pricing: EditionPricing): HTMLElement | null {
  const tiers: readonly PriceTier[] = pricing.tiers ?? [];
  if (tiers.length === 0) return null;

  const box = node("div", "vr-tiers");
  const unit = pricing.unit;
  box.appendChild(
    node("p", "vr-tiers__head", unit ? `${sentenceCase(unit)}, by rental package` : "By rental package"),
  );

  const list = node("dl", "vr-tiers__list");
  for (const tier of tiers) {
    const row = node("div", "vr-tier");
    const label = node("dt", "vr-tier__label");
    label.appendChild(node("span", "vr-tier__name", tier.label));
    label.appendChild(node("span", "vr-tier__detail", tier.detail));
    row.appendChild(label);
    row.appendChild(node("dd", "vr-tier__amount", formatMoney(tier.amount, pricing.currency)));
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

/**
 * The annual line. Whether it *replaces* the headline price or sits on top of
 * it is read from the shape of the pricing rather than hardcoded per edition:
 * a block with per-event tiers is offering the year as an alternative to
 * paying event by event, while a one-off setup fee is quoted plus its upkeep.
 */
function renderRecurring(pricing: EditionPricing): HTMLElement | null {
  const rec = pricing.recurring;
  if (!rec) return null;

  const box = node("div", "vr-recurring");
  const line = node("p", "vr-recurring__line");
  line.appendChild(node("span", "vr-recurring__lead", pricing.tiers?.length ? "Or" : "Plus"));
  line.appendChild(node("span", "vr-recurring__amount", formatMoney(rec.amount, pricing.currency)));
  line.appendChild(node("span", "vr-recurring__unit", rec.unit));
  box.appendChild(line);
  box.appendChild(node("p", "vr-recurring__note", rec.note));
  return box;
}

/**
 * Three cards: what each edition is, what it costs, and one button per card
 * that opens a mail already addressed and titled. Every figure comes from the
 * edition's own `pricing` block — the headline verbatim, the tiers and the
 * recurring amounts through `formatMoney`.
 */
function renderPricing(host: HTMLElement): void {
  host.replaceChildren();

  for (const id of EDITION_ORDER) {
    const spec = EDITIONS[id];
    const pricing = spec.pricing;
    const best = id === RECOMMENDED;
    const label = editionLabel(id);
    const card = node("article", `vr-price${best ? " is-recommended" : ""}`);

    const top = node("div", "vr-price__top");
    top.appendChild(node("h3", "vr-price__name", label));
    if (best) top.appendChild(node("span", "vr-price__flag", "Recommended"));
    card.appendChild(top);

    card.appendChild(node("p", "vr-price__tagline", spec.tagline));

    // The headline is printed as the spec writes it — "Included", "from CHF
    // 150" — with the unit beside it rather than folded in, so the two can be
    // sized independently and the figure stays the thing you read first.
    const figure = node("p", "vr-price__figure");
    figure.appendChild(node("span", "vr-price__amount", pricing.headline));
    if (pricing.unit) figure.appendChild(node("span", "vr-price__unit", pricing.unit));
    card.appendChild(figure);

    card.appendChild(node("p", "vr-price__note", pricing.note));

    // Both are absent on most editions, and neither is faked when it is: a
    // card with no tiers simply goes from its note to its selling points.
    const tiers = renderTiers(pricing);
    if (tiers) card.appendChild(tiers);
    const recurring = renderRecurring(pricing);
    if (recurring) card.appendChild(recurring);

    const points = node("ul", "vr-price__points");
    for (const p of spec.sellingPoints) points.appendChild(node("li", undefined, p));
    card.appendChild(points);

    const ask = ASK[id];
    const cta = document.createElement("a");
    cta.className = `vr-btn vr-price__cta${best ? " vr-btn--primary" : ""}`;
    cta.href = `mailto:${brand.contactEmail}?subject=${encodeURIComponent(
      `${brand.shortName} — ${ask.subject}`,
    )}`;
    // The visible label is short; the full sentence goes to a screen reader,
    // which would otherwise announce three near-identical links.
    cta.setAttribute("aria-label", `Email ${brand.contactEmail} about the ${label} edition`);
    cta.insertAdjacentHTML("afterbegin", ICONS.arrow);
    cta.appendChild(node("span", undefined, ask.label));
    card.appendChild(cta);

    host.appendChild(card);
  }
}

// ── Editions ────────────────────────────────────────────────────────────────

/**
 * The comparison rows. Each one is a question a buyer asks, answered by the
 * edition's own feature flags — never by a hand-maintained table that could
 * promise something the build does not do.
 */
const FEATURE_ROWS: readonly { label: string; on: (f: EditionFeatures) => boolean }[] = [
  { label: "Passthrough mixed reality", on: (f) => f.mixedReality },
  { label: "AI opponents", on: (f) => f.aiOpponents },
  { label: "Online rooms with a code", on: (f) => f.onlineMultiplayer },
  { label: "Persistent leaderboard", on: (f) => f.globalLeaderboard },
  { label: "Assistant backed by a live model", on: (f) => f.assistantLiveModel },
  { label: "Upload your own 360 rooms", on: (f) => f.custom360 },
  { label: "Your branding throughout", on: (f) => f.whiteLabel },
  { label: "No in-headset watermark", on: (f) => !f.watermark },
];

function editionSpecRows(f: EditionFeatures): readonly [string, string][] {
  const envs =
    f.environments === "all"
      ? f.custom360
        ? "All, plus your own"
        : "All"
      : `${f.environments.length} of ${ENVIRONMENTS.length}`;
  return [
    ["Players", f.onlineMultiplayer ? `Up to ${f.maxPlayers}` : "Solo, plus AI"],
    ["Board", `Up to ${f.maxPairs * 2} cards`],
    ["Rooms", envs],
    ["Session", f.sessionLimitSec > 0 ? `${Math.round(f.sessionLimitSec / 60)} min kiosk reset` : "Unlimited"],
  ];
}

/**
 * The matrix under the prices. It carries no copy of its own — the name, the
 * tagline and the selling points are said once, in the pricing card above, and
 * this reads as the specification sheet a buyer scans across.
 */
function renderEditions(host: HTMLElement, currentId: EditionId): void {
  host.replaceChildren();
  for (const id of EDITION_ORDER) {
    const spec = EDITIONS[id];
    const f = spec.features;
    const card = node("article", `vr-edition${id === currentId ? " is-current" : ""}`);

    const top = node("div", "vr-edition__top");
    top.appendChild(node("h3", "vr-edition__name", editionLabel(id)));
    if (id === currentId) top.appendChild(node("span", "vr-edition__here", "This build"));
    card.appendChild(top);

    const specs = node("dl", "vr-edition__specs");
    for (const [k, v] of editionSpecRows(f)) {
      const row = node("div");
      row.append(node("dt", undefined, k), node("dd", undefined, v));
      specs.appendChild(row);
    }
    card.appendChild(specs);

    const feats = node("ul", "vr-edition__features");
    for (const row of FEATURE_ROWS) {
      const included = row.on(f);
      const li = node("li", included ? "is-on" : "is-off");
      li.insertAdjacentHTML("afterbegin", included ? ICONS.check : ICONS.dash);
      li.appendChild(node("span", undefined, row.label));
      feats.appendChild(li);
    }
    card.appendChild(feats);

    host.appendChild(card);
  }
}

function editionLabel(id: EditionId): string {
  return id === "demo" ? "Demo" : id === "pro" ? "Pro" : "Enterprise";
}

// ── Token bridge ────────────────────────────────────────────────────────────

/**
 * `applyBrandCssVars` publishes the palette and fonts. Radii, motion, the two
 * "reads on a saturated fill" ink values and the theme's scene tokens live in
 * `tokens`, `text` and `scene`, so publish those too — then the stylesheet
 * never hardcodes a value the design system owns and never needs a light/dark
 * branch of its own: the surface, border, shadow and glow strengths are the
 * same numbers the headset renders with.
 *
 * Everything here is *derived* from mutated-in-place objects, so this must run
 * again on every theme change.
 */
function applyTokenCssVars(target: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string) => target.style.setProperty(k, v);
  set("--vr-on-primary", ink.onPrimary);
  set("--vr-on-accent", ink.onAccent);
  set("--vr-radius-sm", `${tokens.radius.sm}px`);
  set("--vr-radius-md", `${tokens.radius.md}px`);
  set("--vr-radius-lg", `${tokens.radius.lg}px`);
  set("--vr-radius-pill", `${tokens.radius.pill}px`);
  set("--vr-motion-fast", `${tokens.motion.fast}ms`);
  set("--vr-motion-base", `${tokens.motion.base}ms`);
  set("--vr-motion-slow", `${tokens.motion.slow}ms`);

  set("--vr-panel-alpha", String(scene.panelAlpha));
  set("--vr-border-alpha", String(scene.borderAlpha));
  set("--vr-rim", String(scene.rimScale));

  // A drop shadow has to be the darkest colour the theme owns, which is the
  // ink in a dark palette and the text in a light one. Asking which is darker
  // keeps a re-skinned customer palette from producing an inverted "shadow".
  const shadowBase = luminance(palette.ink) < luminance(ink.primary) ? palette.ink : ink.primary;
  set("--vr-shadow", rgba(shadowBase, scene.shadowAlpha));
}

// ── Markup ──────────────────────────────────────────────────────────────────

/**
 * Icons are inline SVG, drawn from the same geometric family as the in-headset
 * set. No icon font, no sprite sheet, no emoji.
 */
const ICONS = {
  headset:
    '<svg class="vr-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-3.2a2 2 0 0 1-1.5-.7l-1.1-1.3a1.6 1.6 0 0 0-2.4 0l-1.1 1.3a2 2 0 0 1-1.5.7H5a2 2 0 0 1-2-2z"/></svg>',
  play:
    '<svg class="vr-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5z"/></svg>',
  arrow:
    '<svg class="vr-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M12.5 6l6 6-6 6"/></svg>',
  check:
    '<svg class="vr-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>',
  dash:
    '<svg class="vr-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
} as const;

const THEME_ICONS: Record<ThemeId, string> = {
  dark:
    '<svg class="vr-theme__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z"/></svg>',
  light:
    '<svg class="vr-theme__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></svg>',
};

const TAILOR_ICONS = {
  brandmark:
    '<svg class="vr-tailor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.8" y="2.8" width="18.4" height="18.4" rx="4.4"/><path d="M12 12h9.2v4.8a4.4 4.4 0 0 1-4.4 4.4H12z" fill="currentColor" stroke="none"/></svg>',
  sphere:
    '<svg class="vr-tailor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="3.9" ry="9"/><path d="M3 12h18"/></svg>',
  code:
    '<svg class="vr-tailor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.6" y="5.4" width="18.8" height="13.2" rx="3.4"/><path d="M7 12h.01M12 12h.01M17 12h.01" stroke-width="2.6" stroke-linecap="round"/></svg>',
  package:
    '<svg class="vr-tailor__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.9 20.4 7v10L12 21.1 3.6 17V7z"/><path d="M3.6 7 12 11.2 20.4 7M12 11.2v9.9"/></svg>',
} as const;

/** Four cards, one turned — the product as a single mark. */
const BRAND_MARK = `
<svg class="vr-brand__mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="1.4" y="1.4" width="9" height="9" rx="2.3" stroke="currentColor" stroke-width="1.7"/>
  <rect x="13.6" y="1.4" width="9" height="9" rx="2.3" stroke="currentColor" stroke-width="1.7" opacity="0.45"/>
  <rect x="1.4" y="13.6" width="9" height="9" rx="2.3" stroke="currentColor" stroke-width="1.7" opacity="0.45"/>
  <rect x="13.6" y="13.6" width="9" height="9" rx="2.3" fill="var(--vr-accent)"/>
</svg>`;

/** The miniature board in the hero. Two faces up, one pair already matched. */
const ART_CARDS = [
  { cls: "is-matched", glyph: "◈" },
  { cls: "", glyph: "" },
  { cls: "", glyph: "" },
  { cls: "is-matched", glyph: "◈" },
  { cls: "", glyph: "" },
  { cls: "is-up is-turning", glyph: "◆" },
  { cls: "is-turning", glyph: "" },
  { cls: "", glyph: "" },
  { cls: "", glyph: "" },
  { cls: "", glyph: "" },
  { cls: "is-up", glyph: "◆" },
  { cls: "", glyph: "" },
]
  .map((c) => `<div class="vr-art__card ${c.cls}">${c.glyph}</div>`)
  .join("");

const SHELL = `
<div class="vr-entry__bg"></div>

<header class="vr-nav">
  <a class="vr-brand" data-brand-link rel="noreferrer">
    ${BRAND_MARK}
    <span class="vr-brand__name" data-brandname></span>
    <span class="vr-brand__sep"></span>
    <span class="vr-brand__product" data-product></span>
  </a>
  <div class="vr-nav__meta">
    <span class="vr-badge" data-edition-badge></span>
    <span class="vr-nav__version" data-version></span>
    <div class="vr-theme" data-theme role="group" aria-label="Colour theme">
      <span class="vr-theme__thumb" aria-hidden="true"></span>
    </div>
  </div>
</header>

<main class="vr-main">
  <section class="vr-hero">
    <div class="vr-hero__copy vr-rise">
      <p class="vr-eyebrow">Meta Quest 3 · Mixed reality</p>
      <h1 class="vr-title" data-title></h1>
      <p class="vr-lede" data-lede></p>

      <div class="vr-cta" data-cta></div>
      <p class="vr-status" data-status data-tone="idle" role="status" aria-live="polite">
        <span class="vr-status__dot"></span><span data-status-text></span>
      </p>
      <p class="vr-error" data-error role="alert"></p>

      <div class="vr-note" data-note>
        <div>
          <p class="vr-note__title" data-note-title></p>
          <p class="vr-note__body" data-note-body></p>
          <span class="vr-url" data-url hidden></span>
        </div>
      </div>

      <ul class="vr-points" data-points></ul>
    </div>

    <div class="vr-hero__art vr-rise">
      <div class="vr-art">
        ${ART_CARDS}
        <span class="vr-art__caption" data-art-caption></span>
      </div>
    </div>
  </section>

  <section class="vr-section">
    <div class="vr-section__head">
      <h2 class="vr-section__title">How a session runs</h2>
      <p class="vr-section__aside">From putting the headset on to the last pair.</p>
    </div>
    <div class="vr-steps" data-steps></div>
    <div class="vr-stats" data-stats></div>
    <p class="vr-scope" data-stats-note hidden></p>
  </section>

  <section class="vr-section">
    <div class="vr-section__head">
      <h2 class="vr-section__title">Where you play</h2>
      <p class="vr-section__aside" data-rooms-aside></p>
    </div>
    <div class="vr-rooms" data-rooms></div>
  </section>

  <section class="vr-section">
    <div class="vr-section__head">
      <h2 class="vr-section__title">Built for one customer at a time</h2>
      <p class="vr-section__aside">What a custom build actually changes.</p>
    </div>
    <div class="vr-tailoring" data-tailoring></div>
  </section>

  <section class="vr-section" data-pricing-section>
    <div class="vr-section__head">
      <h2 class="vr-section__title">What it costs</h2>
      <p class="vr-section__aside">Included with the rental, priced per event, or built for you.</p>
    </div>
    <div class="vr-prices" data-pricing></div>
    <p class="vr-vat" data-vat></p>
  </section>

  <section class="vr-section" data-editions-section>
    <div class="vr-section__head">
      <h2 class="vr-section__title">Feature by feature</h2>
      <p class="vr-section__aside">Three editions, one codebase. Each ships as its own signed build.</p>
    </div>
    <div class="vr-editions" data-editions></div>
  </section>

  <section class="vr-section vr-section--flush">
    <div class="vr-contact">
      <div class="vr-contact__copy">
        <h2 class="vr-contact__title">Tell us what your room looks like</h2>
        <p class="vr-contact__body">
          A build is scoped around the space it runs in. Useful things to say: where it will
          stand, how many headsets you have, what should be printed on the cards, and whether
          you already hold 360 photography of the space.
        </p>
        <ul class="vr-contact__list">
          <li>A stand, a showroom, a training room or a museum floor</li>
          <li>Your palette, logo and card artwork</li>
          <li>Your own 360 environments and private room codes</li>
        </ul>
      </div>
      <div class="vr-contact__act">
        <a class="vr-btn vr-btn--primary" data-contact-mail>
          <span data-contact-mail-label></span>
        </a>
        <p class="vr-contact__alt">
          In a headset, where mail links go nowhere:
          <span class="vr-contact__address" data-contact-address></span>
        </p>
        <a class="vr-contact__site" data-contact-site rel="noreferrer"></a>
      </div>
    </div>
  </section>
</main>

<footer class="vr-foot">
  <span data-copy></span>
  <span>
    <a data-site href="#" rel="noreferrer"></a>
    &nbsp;·&nbsp;
    <a data-mail href="#"></a>
  </span>
</footer>
`;
