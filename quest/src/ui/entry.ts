/**
 * The 2D screen shown before entering XR — and the embed that runs on vrent.ch.
 *
 * It has two jobs at once, and both matter commercially:
 *
 *   • In the headset browser it is the door into the session. WebXR will only
 *     grant an immersive session from a real user gesture, so there has to be a
 *     button, and that button had better be obvious.
 *   • On a desktop it is the product page a buyer lands on. So it carries the
 *     brand mark, the pitch, the three editions and a playable flat-screen
 *     fallback rather than an apology.
 *
 * Capability detection decides which of the three faces it wears. Everything
 * visual comes from `applyBrandCssVars` plus the radius and motion values this
 * module writes from `tokens`, so a palette change re-skins the page with no
 * CSS edit and nothing is ever fetched from a font CDN.
 */

import "./entry.css";
import { applyBrandCssVars, brand, text as ink, tokens } from "../../shared/brand.ts";
import { EDITIONS } from "../../shared/editions.ts";
import type { EditionId, EditionSpec } from "../../shared/editions.ts";

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
  const editionsEl = $<HTMLDivElement>("[data-editions]");

  // Static copy that comes from the brand and edition data.
  $("[data-title]").textContent = brand.tagline;
  $("[data-lede]").textContent =
    "Up to eight people around one board, in your real room or in a rendered one. " +
    "Runs on the headset with nothing to install for guests — they join with a six-character code.";
  $("[data-product]").textContent = brand.shortName;
  $("[data-brandname]").textContent = brand.name;
  $("[data-edition-badge]").textContent = editionLabel(deps.edition.id);
  $("[data-version]").textContent = deps.version ? `v${deps.version}` : "";
  urlEl.textContent = brand.website.replace(/^https?:\/\//, "");

  $<HTMLAnchorElement>("[data-brand-link]").href = brand.website;
  const site = $<HTMLAnchorElement>("[data-site]");
  site.href = brand.website;
  site.textContent = brand.website.replace(/^https?:\/\//, "");
  const mail = $<HTMLAnchorElement>("[data-mail]");
  mail.href = `mailto:${brand.contactEmail}`;
  mail.textContent = brand.contactEmail;
  $("[data-copy]").textContent = `${brand.name} · ${deps.edition.name}`;

  for (const point of deps.edition.sellingPoints) {
    const li = document.createElement("li");
    li.textContent = point;
    pointsEl.appendChild(li);
  }

  renderEditions(editionsEl, deps.edition.id);

  // ── State ────────────────────────────────────────────────────────────────

  let caps: EntryCapabilities | null = null;
  let busy = false;
  const cleanups: (() => void)[] = [];

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
      label: "See the editions",
      onClick: () => el.querySelector("[data-editions-section]")?.scrollIntoView({ behavior: "smooth", block: "start" }),
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

// ── Editions ────────────────────────────────────────────────────────────────

function renderEditions(host: HTMLElement, currentId: EditionId): void {
  host.replaceChildren();
  for (const id of EDITION_ORDER) {
    const spec = EDITIONS[id];
    const card = document.createElement("article");
    card.className = `vr-edition${id === currentId ? " is-current" : ""}`;

    const top = document.createElement("div");
    top.className = "vr-edition__top";
    const name = document.createElement("h3");
    name.className = "vr-edition__name";
    name.textContent = editionLabel(id);
    top.appendChild(name);
    if (id === currentId) {
      const here = document.createElement("span");
      here.className = "vr-edition__here";
      here.textContent = "This build";
      top.appendChild(here);
    }
    card.appendChild(top);

    const tagline = document.createElement("p");
    tagline.className = "vr-edition__tagline";
    tagline.textContent = spec.tagline;
    card.appendChild(tagline);

    const specs = document.createElement("dl");
    specs.className = "vr-edition__specs";
    const f = spec.features;
    const rows: [string, string][] = [
      ["Players", f.onlineMultiplayer ? `Up to ${f.maxPlayers}` : "Solo"],
      ["Board", `Up to ${f.maxPairs} pairs`],
      ["Environments", f.environments === "all" ? "All, plus your own" : `${f.environments.length}`],
      ["Leaderboard", f.globalLeaderboard ? "Persistent" : "Session only"],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      row.append(dt, dd);
      specs.appendChild(row);
    }
    card.appendChild(specs);

    const points = document.createElement("ul");
    points.className = "vr-edition__points";
    for (const p of spec.sellingPoints) {
      const li = document.createElement("li");
      li.textContent = p;
      points.appendChild(li);
    }
    card.appendChild(points);

    host.appendChild(card);
  }
}

function editionLabel(id: EditionId): string {
  return id === "demo" ? "Demo" : id === "pro" ? "Pro" : "Enterprise";
}

// ── Token bridge ────────────────────────────────────────────────────────────

/**
 * `applyBrandCssVars` publishes the palette and fonts. Radii, motion and the
 * two "reads on a saturated fill" ink values live in `tokens` and `text`, so
 * publish those too — then the stylesheet never hardcodes a value the design
 * system owns, and a re-skin still needs no CSS edit.
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
    <span data-version></span>
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
        <span class="vr-art__caption">Twelve to forty-eight cards</span>
      </div>
    </div>
  </section>

  <section class="vr-section" data-editions-section>
    <div class="vr-section__head">
      <h2 class="vr-section__title">Three editions, one codebase</h2>
      <p class="vr-section__aside">Each ships as its own signed build.</p>
    </div>
    <div class="vr-editions" data-editions></div>
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
