/**
 * The spatial-UI primitive.
 *
 * A `Panel` is a slab of interface living in world space: a 2D canvas uploaded
 * as a texture onto a flat or cylindrically-curved plane, plus ray hit-testing
 * that turns a `PointerState` into local canvas coordinates.
 *
 * Three rules shape everything here.
 *
 *  1. **Redraw only on change.** A 1600×1000 canvas is a 6.4 MB texture upload;
 *     doing that every frame would flatten a Quest 3. Panels carry a dirty flag,
 *     redraw when something visibly changed, and throttle purely animated
 *     redraws to 30 Hz. Transitions that can be done on the *mesh* (fade, slide)
 *     never touch the canvas at all.
 *
 *  2. **One physical scale everywhere.** All widget code draws in "design pixels"
 *     at a fixed `PX_PER_METER`, and the panel scales the context to whatever
 *     canvas resolution it settled on. A 27 px body label is therefore the same
 *     physical size on every panel in the product, and a hairline is exactly one
 *     device-independent pixel.
 *
 *  3. **Immediate-mode draw, retained hit regions.** Widgets are pure functions
 *     that read interaction state for their id, draw, and register a hit region.
 *     Input resolves against the regions registered by the last draw pass, which
 *     is always current because any change that moves a region also dirties the
 *     panel.
 */

import * as THREE from "three";
import { palette, rgba, text as ink, tokens } from "../../shared/brand.ts";
import type { PointerState } from "../contracts.ts";

// ── Physical scale ──────────────────────────────────────────────────────────

/**
 * Canvas design-pixels per metre of panel. At a 1.2 m reading distance one
 * design pixel subtends ~0.03°, so the ~17 px floor for legible text sits well
 * below our smallest role (22 px) and 44 CSS-px touch targets map to ~37 px —
 * every control here is at least 64 px tall, comfortably above that.
 */
export const PX_PER_METER = 1600;

/** Hard cap per axis. Quest 3 handles 2048² textures without complaint. */
export const MAX_CANVAS = 2048;

/** Comfortable reading distance for a menu panel, in metres. */
export const READ_DISTANCE = 1.25;

// ── Geometry helpers ────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Radii = number | [number, number, number, number];

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function inset(r: Rect, top: number, right = top, bottom = top, left = right): Rect {
  return { x: r.x + left, y: r.y + top, w: r.w - left - right, h: r.h - top - bottom };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function centreRect(r: Rect, w: number, h: number): Rect {
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** Slices `h` off the top. Returns `[taken, remainder]`. */
export function cutTop(r: Rect, h: number, gap = 0): [Rect, Rect] {
  return [
    { x: r.x, y: r.y, w: r.w, h },
    { x: r.x, y: r.y + h + gap, w: r.w, h: r.h - h - gap },
  ];
}

export function cutBottom(r: Rect, h: number, gap = 0): [Rect, Rect] {
  return [
    { x: r.x, y: r.y + r.h - h, w: r.w, h },
    { x: r.x, y: r.y, w: r.w, h: r.h - h - gap },
  ];
}

export function cutLeft(r: Rect, w: number, gap = 0): [Rect, Rect] {
  return [
    { x: r.x, y: r.y, w, h: r.h },
    { x: r.x + w + gap, y: r.y, w: r.w - w - gap, h: r.h },
  ];
}

export function cutRight(r: Rect, w: number, gap = 0): [Rect, Rect] {
  return [
    { x: r.x + r.w - w, y: r.y, w, h: r.h },
    { x: r.x, y: r.y, w: r.w - w - gap, h: r.h },
  ];
}

export function colsIn(r: Rect, n: number, gap: number): Rect[] {
  const w = (r.w - gap * (n - 1)) / n;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r.x + i * (w + gap), y: r.y, w, h: r.h });
  return out;
}

export function rowsIn(r: Rect, n: number, gap: number): Rect[] {
  const h = (r.h - gap * (n - 1)) / n;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r.x, y: r.y + i * (h + gap), w: r.w, h });
  return out;
}

export function gridIn(r: Rect, cols: number, rows: number, gapX: number, gapY = gapX): Rect[] {
  const w = (r.w - gapX * (cols - 1)) / cols;
  const h = (r.h - gapY * (rows - 1)) / rows;
  const out: Rect[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      out.push({ x: r.x + i * (w + gapX), y: r.y + j * (h + gapY), w, h });
    }
  }
  return out;
}

// ── Theme ───────────────────────────────────────────────────────────────────

/**
 * Every colour in the in-headset UI resolves through here, and every value is
 * derived from `shared/brand.ts`. Re-skinning the product is a `palette` edit.
 */
export const theme = {
  /** Panel body, top → bottom. */
  panelTop: rgba(palette.surfaceAlt, 0.97),
  panelBottom: rgba(palette.surface, 0.98),
  panelEdge: rgba(ink.secondary, 0.22),
  panelHighlight: rgba(ink.primary, 0.1),
  scrim: rgba(palette.ink, 0.72),

  /** Raised surfaces on top of the panel. */
  card: rgba(palette.ink, 0.42),
  cardHover: rgba(palette.surfaceAlt, 0.9),
  cardActive: rgba(palette.ink, 0.66),
  cardSelected: rgba(palette.primary, 0.16),

  line: rgba(ink.secondary, 0.18),
  lineStrong: rgba(ink.secondary, 0.34),
  lineFaint: rgba(ink.secondary, 0.1),

  fg: ink.primary,
  fg2: ink.secondary,
  fgMuted: ink.muted,
  onPrimary: ink.onPrimary,
  onAccent: ink.onAccent,

  primary: palette.primary,
  accent: palette.accent,
  reward: palette.reward,
  danger: palette.danger,

  focusRing: palette.accent,
  disabledFg: rgba(ink.muted, 0.55),

  /** One device-independent pixel. */
  hairline: 1,
  radius: tokens.radius,
} as const;

// ── Type scale ──────────────────────────────────────────────────────────────

export type TypeRole =
  | "hero"
  | "display"
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "bodyStrong"
  | "label"
  | "caption"
  | "mono"
  | "monoBig";

interface TypeSpec {
  size: number;
  weight: number;
  family: "display" | "body" | "mono";
  tracking: number;
  line: number;
}

const FAMILY = {
  display: tokens.font.display,
  body: tokens.font.body,
  mono: tokens.font.mono,
} as const;

/**
 * Six steps and two monos. Sizes are design px; the jumps are large enough that
 * two adjacent roles are never mistakable for each other across a room.
 */
const TYPE: Record<TypeRole, TypeSpec> = {
  hero: { size: 200, weight: 700, family: "display", tracking: 4, line: 1.0 },
  display: { size: 92, weight: 700, family: "display", tracking: -1.5, line: 1.05 },
  h1: { size: 58, weight: 700, family: "display", tracking: -0.8, line: 1.12 },
  h2: { size: 40, weight: 600, family: "display", tracking: -0.2, line: 1.2 },
  h3: { size: 31, weight: 600, family: "body", tracking: 0, line: 1.28 },
  body: { size: 27, weight: 400, family: "body", tracking: 0, line: 1.46 },
  bodyStrong: { size: 27, weight: 600, family: "body", tracking: 0, line: 1.46 },
  label: { size: 23, weight: 600, family: "body", tracking: 2.4, line: 1.2 },
  caption: { size: 22, weight: 400, family: "body", tracking: 0, line: 1.36 },
  mono: { size: 28, weight: 500, family: "mono", tracking: 1.4, line: 1.3 },
  monoBig: { size: 62, weight: 600, family: "mono", tracking: 5, line: 1.1 },
};

export function typeSpec(role: TypeRole): Readonly<TypeSpec> {
  return TYPE[role];
}

export interface TextOptions {
  role?: TypeRole;
  color?: string;
  align?: "left" | "centre" | "right";
  baseline?: "top" | "middle" | "alphabetic" | "bottom";
  tracking?: number;
  size?: number;
  weight?: number;
  alpha?: number;
  upper?: boolean;
  /** Ellipsise past this width. */
  maxWidth?: number;
}

// ── Interaction ─────────────────────────────────────────────────────────────

export interface WidgetState {
  hover: boolean;
  active: boolean;
  focus: boolean;
}

export interface HitSpec {
  id: string;
  rect: Rect;
  disabled?: boolean;
  /** Set false to keep it out of the focus ring cycle. Default true. */
  focusable?: boolean;
}

/** Registered when a press lands on the panel but not on any control. */
export const BACKDROP_ID = "__backdrop";

export type Easing = (t: number) => number;

// ── Gfx: the drawing surface handed to widgets ──────────────────────────────

export interface Gfx {
  /** Raw context, already transformed into design-pixel space. */
  readonly ctx: CanvasRenderingContext2D;
  /** Full panel in design px, including the padding the panel reserves. */
  readonly bounds: Rect;
  /** Content area, inside the panel padding. Widgets lay out in here. */
  readonly area: Rect;
  readonly theme: typeof theme;

  // Typography
  font(role: TypeRole, weight?: number, size?: number): string;
  text(s: string, x: number, y: number, o?: TextOptions): number;
  measure(s: string, o?: TextOptions): number;
  /** Word-wrapped block. Returns the height consumed. */
  paragraph(s: string, r: Rect, o?: TextOptions & { lines?: number }): number;

  // Shapes
  round(r: Rect, radius: Radii): void;
  fillRound(r: Rect, radius: Radii, color: string): void;
  strokeRound(r: Rect, radius: Radii, color: string, width?: number): void;
  hairline(x0: number, y0: number, x1: number, y1: number, color?: string): void;
  circle(cx: number, cy: number, r: number, color: string): void;
  ring(cx: number, cy: number, r: number, color: string, width?: number): void;
  /** Stroked polyline through `[x,y,...]` pairs. */
  path(pts: readonly number[], color: string, width?: number, closed?: boolean): void;

  save(): void;
  restore(): void;
  clip(r: Rect, radius?: Radii): void;
  alpha(a: number): void;

  // Interaction
  state(id: string): WidgetState;
  hit(spec: HitSpec): void;
  /** True exactly once, on the draw pass after the click resolved. */
  clicked(id: string): boolean;
  /** Live drag point in design px while a pointer holds this id. */
  drag(id: string): { x: number; y: number } | null;
  focus(id: string): void;
  /**
   * Eased scalar keyed by id. First call snaps to `target`; later target
   * changes animate. Drives every motion inside the canvas.
   */
  anim(id: string, target: number, ms?: number): number;
  /**
   * Everything registered from here on is modal: hits below it are ignored and
   * a press on empty space registers as `BACKDROP_ID`.
   */
  beginModal(): void;
}

// ── Panel ───────────────────────────────────────────────────────────────────

export interface PanelOptions {
  /** Metres. */
  width: number;
  /** Metres. */
  height: number;
  /**
   * Cylindrical bend radius in metres — set it to the intended viewing distance
   * and every point of the panel sits the same distance from the eye. 0 = flat.
   */
  curveRadius?: number;
  /** Design px of padding reserved inside the panel edge. */
  padding?: number;
  /**
   * Draw the slab background, edge and shadow. Off for overlays that supply
   * their own shape — the toast stack and the emote wheel.
   */
  chrome?: boolean;
  name?: string;
  renderOrder?: number;
  /** Draw a small reticle where the ray meets the panel. Default true. */
  reticle?: boolean;
  anisotropy?: number;
  /** Fired when the hovered control changes — hook up haptics here. */
  onHoverChange?: (id: string | null, pointerId: number) => void;
  /** Fired the moment a press lands on a control. */
  onPress?: (id: string, pointerId: number) => void;
}

interface AnimEntry {
  v: number;
  target: number;
  rate: number;
}

const PANEL_MARGIN = 14; // design px of canvas kept clear for the soft shadow
const DEFAULT_PADDING = 44;
const ANIM_REDRAW_INTERVAL = 1 / 30;

export class Panel {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  readonly widthMeters: number;
  readonly heightMeters: number;
  /** Design-pixel size of the drawable area. */
  readonly designW: number;
  readonly designH: number;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scale: number;
  private readonly padding: number;
  private readonly opts: PanelOptions;

  private renderer: ((g: Gfx) => void) | null = null;
  private readonly gfx: GfxImpl;

  private dirty = true;
  private animDirty = false;
  private sinceDraw = 0;

  private regions: HitSpec[] = [];
  private modalFrom = 0;
  private hoverId: string | null = null;
  private activeId: string | null = null;
  private focusId: string | null = null;
  private highlightId: string | null = null;
  private watermark: string | null = null;
  private readonly pendingClicks = new Set<string>();
  private readonly anims = new Map<string, AnimEntry>();
  private dragPoint: { x: number; y: number } | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private capturedPointer = -99;

  private readonly raycaster = new THREE.Raycaster();
  private reticle: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;

  /** Mesh-level transition state — cheaper than animating the canvas. */
  private targetOpacity = 1;
  private opacity = 1;
  private slide = 0;
  private targetSlide = 0;
  private hidden = false;

  constructor(options: PanelOptions) {
    this.opts = options;
    this.widthMeters = options.width;
    this.heightMeters = options.height;
    this.padding = options.padding ?? DEFAULT_PADDING;

    this.designW = options.width * PX_PER_METER;
    this.designH = options.height * PX_PER_METER;

    const rawW = Math.round(this.designW);
    const rawH = Math.round(this.designH);
    this.scale = Math.min(1, MAX_CANVAS / rawW, MAX_CANVAS / rawH);

    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(2, Math.round(this.designW * this.scale));
    this.canvas.height = Math.max(2, Math.round(this.designH * this.scale));

    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Panel: 2D canvas context unavailable");
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Panels are read roughly head-on at ~1:1 texel density, so mipmaps buy
    // nothing and would add a pyramid rebuild to every upload.
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = options.anisotropy ?? 1;

    const geometry = buildPanelGeometry(options.width, options.height, options.curveRadius ?? 0);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = options.name ?? "panel";
    this.mesh.renderOrder = options.renderOrder ?? 10;
    this.group.add(this.mesh);

    if (options.reticle !== false) this.buildReticle();

    this.gfx = new GfxImpl(this);
  }

  // ── Placement ─────────────────────────────────────────────────────────────

  /** Positions the panel and tilts it so its face aims at eye height. */
  setPose(x: number, y: number, z: number, tiltX = 0, yaw = 0): void {
    this.group.position.set(x, y, z);
    this.group.rotation.set(tiltX, yaw, 0);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  setRenderer(fn: (g: Gfx) => void): void {
    this.renderer = fn;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  setWatermark(mark: string | null): void {
    if (this.watermark === mark) return;
    this.watermark = mark;
    this.dirty = true;
  }

  /** Draws an attention ring around a named region — used by the assistant. */
  setHighlight(id: string | null): void {
    if (this.highlightId === id) return;
    this.highlightId = id;
    this.dirty = true;
  }

  setVisible(visible: boolean, animate = true): void {
    if (this.hidden === !visible) return;
    this.hidden = !visible;
    this.targetOpacity = visible ? 1 : 0;
    this.targetSlide = visible ? 0 : -0.03;
    if (!animate) {
      this.opacity = this.targetOpacity;
      this.slide = this.targetSlide;
      this.applyMeshTransition();
    }
    if (visible) this.group.visible = true;
  }

  get visible(): boolean {
    return !this.hidden;
  }

  /**
   * A screen swap: fade the mesh down, run `swap`, fade it back with a small
   * rise. No canvas redraw is spent on the transition itself.
   */
  transition(swap: () => void): void {
    swap();
    this.dirty = true;
    this.opacity = 0;
    this.slide = -0.022;
    this.targetOpacity = this.hidden ? 0 : 1;
    this.targetSlide = 0;
    this.applyMeshTransition();
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  update(dt: number, pointers: readonly PointerState[]): void {
    this.tickAnims(dt);
    this.tickTransition(dt);

    if (!this.hidden && this.opacity > 0.05) this.resolveInput(pointers);
    else this.clearInput();

    this.sinceDraw += dt;
    if (this.dirty) {
      this.redraw();
    } else if (this.animDirty && this.sinceDraw >= ANIM_REDRAW_INTERVAL) {
      this.redraw();
    }
  }

  private tickAnims(dt: number): void {
    if (this.anims.size === 0) return;
    let moved = false;
    for (const a of this.anims.values()) {
      if (a.v === a.target) continue;
      const k = 1 - Math.exp(-dt * a.rate);
      a.v += (a.target - a.v) * k;
      if (Math.abs(a.target - a.v) < 0.0015) a.v = a.target;
      moved = true;
    }
    if (moved) this.animDirty = true;
  }

  private tickTransition(dt: number): void {
    const rate = 1 - Math.exp(-dt * (5000 / tokens.motion.base));
    let changed = false;
    if (this.opacity !== this.targetOpacity) {
      this.opacity += (this.targetOpacity - this.opacity) * rate;
      if (Math.abs(this.targetOpacity - this.opacity) < 0.004) this.opacity = this.targetOpacity;
      changed = true;
    }
    if (this.slide !== this.targetSlide) {
      this.slide += (this.targetSlide - this.slide) * rate;
      if (Math.abs(this.targetSlide - this.slide) < 0.0004) this.slide = this.targetSlide;
      changed = true;
    }
    if (changed) this.applyMeshTransition();
    if (this.hidden && this.opacity === 0) this.group.visible = false;
  }

  private applyMeshTransition(): void {
    this.mesh.material.opacity = this.opacity;
    this.mesh.position.y = this.slide;
    if (this.reticle) this.reticle.material.opacity = this.opacity * 0.9;
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private clearInput(): void {
    if (this.hoverId !== null || this.activeId !== null) {
      this.hoverId = null;
      this.activeId = null;
      this.dirty = true;
    }
    this.dragPoint = null;
    this.lastPoint = null;
    this.capturedPointer = -99;
    if (this.reticle) this.reticle.visible = false;
  }

  private resolveInput(pointers: readonly PointerState[]): void {
    this.group.updateWorldMatrix(true, true);

    let driver: PointerState | null = null;
    let point: { x: number; y: number } | null = null;
    let local: THREE.Vector3 | null = null;
    let best = Number.POSITIVE_INFINITY;

    const captured =
      this.capturedPointer !== -99
        ? pointers.find((p) => p.id === this.capturedPointer) ?? null
        : null;

    const candidates = captured ? [captured] : pointers;
    for (const p of candidates) {
      const hit = this.raycast(p);
      if (!hit) continue;
      if (hit.distance < best) {
        best = hit.distance;
        driver = p;
        point = hit.point;
        local = hit.local;
      }
    }

    // A captured pointer keeps control even if its ray slips off the edge, so a
    // slider drag does not snap back the moment you overshoot.
    if (captured && !point) {
      driver = captured;
      point = this.dragPoint;
    }

    if (this.reticle) {
      if (local) this.placeReticle(local, captured?.held ?? false);
      else this.reticle.visible = false;
    }

    this.lastPoint = point;
    const region = point ? this.regionAt(point.x, point.y) : null;
    const hoverId = region && !region.disabled ? region.id : null;
    if (hoverId !== this.hoverId) {
      this.hoverId = hoverId;
      this.dirty = true;
      if (driver) this.opts.onHoverChange?.(hoverId, driver.id);
    }

    if (!driver) {
      this.dragPoint = null;
      return;
    }

    if (driver.pressed) {
      if (hoverId) {
        this.activeId = hoverId;
        this.focusId = hoverId;
        this.capturedPointer = driver.id;
        this.dragPoint = point;
        this.dirty = true;
        this.opts.onPress?.(hoverId, driver.id);
      } else if (point) {
        // Press on empty panel space — screens use this to dismiss overlays.
        this.pendingClicks.add(BACKDROP_ID);
        this.dirty = true;
      }
    }

    if (driver.held && this.activeId) {
      if (point && (point.x !== this.dragPoint?.x || point.y !== this.dragPoint?.y)) {
        this.dragPoint = point;
        // Only the widget knows whether the new position changed anything, so
        // it dirties the panel itself by way of a changed anim target.
      }
    }

    if (driver.released) {
      if (this.activeId && this.activeId === hoverId) {
        this.pendingClicks.add(this.activeId);
      }
      if (this.activeId) this.dirty = true;
      this.activeId = null;
      this.capturedPointer = -99;
      this.dragPoint = null;
    }
  }

  private raycast(
    p: PointerState,
  ): { distance: number; point: { x: number; y: number }; local: THREE.Vector3 } | null {
    this.raycaster.ray.copy(p.ray);
    this.raycaster.near = 0;
    this.raycaster.far = 12;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const hit = hits[0];
    if (!hit || !hit.uv) return null;
    return {
      distance: hit.distance,
      point: { x: hit.uv.x * this.designW, y: (1 - hit.uv.y) * this.designH },
      local: this.mesh.worldToLocal(hit.point.clone()),
    };
  }

  private regionAt(x: number, y: number): HitSpec | null {
    for (let i = this.regions.length - 1; i >= this.modalFrom; i--) {
      const r = this.regions[i];
      if (contains(r.rect, x, y)) return r;
    }
    return null;
  }

  /** Moves focus through focusable controls — for thumbstick navigation. */
  focusStep(delta: number): string | null {
    const list = this.regions.filter((r) => !r.disabled && r.focusable !== false);
    if (list.length === 0) return null;
    const at = list.findIndex((r) => r.id === this.focusId);
    const next = list[(((at < 0 ? 0 : at + delta) % list.length) + list.length) % list.length];
    this.focusId = next.id;
    this.dirty = true;
    return next.id;
  }

  /** Activates whatever currently has focus — for an "A button" confirm. */
  activateFocused(): string | null {
    if (!this.focusId) return null;
    this.pendingClicks.add(this.focusId);
    this.dirty = true;
    return this.focusId;
  }

  /**
   * Where the driving ray last met the panel, in design px, or null. Radial
   * controls hit-test themselves against this rather than against rectangles.
   */
  hitPoint(): { x: number; y: number } | null {
    return this.lastPoint;
  }

  setFocus(id: string | null): void {
    if (this.focusId === id) return;
    this.focusId = id;
    this.dirty = true;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  private redraw(): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    this.regions = [];
    this.modalFrom = 0;

    const chrome = this.opts.chrome !== false;
    const full: Rect = { x: 0, y: 0, w: this.designW, h: this.designH };
    const body = chrome ? inset(full, PANEL_MARGIN) : full;
    if (chrome) this.drawChrome(body);

    if (this.renderer) {
      const area = inset(body, this.padding);
      this.gfx.begin(body, area);
      ctx.save();
      this.renderer(this.gfx);
      ctx.restore();
    }

    if (this.watermark) this.drawWatermark(body);
    if (this.highlightId) this.drawHighlight();

    this.pendingClicks.clear();
    this.dirty = false;
    this.animDirty = false;
    this.sinceDraw = 0;
    this.texture.needsUpdate = true;
  }

  private drawChrome(body: Rect): void {
    const { ctx } = this;
    const r = tokens.radius.lg;

    // A single soft shadow, low and wide. Depth, not drama.
    ctx.save();
    ctx.shadowColor = rgba(palette.ink, 0.55);
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 6;
    pathRound(ctx, body, r);
    ctx.fillStyle = theme.panelBottom;
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(0, body.y, 0, body.y + body.h);
    grad.addColorStop(0, theme.panelTop);
    grad.addColorStop(1, theme.panelBottom);
    pathRound(ctx, body, r);
    ctx.fillStyle = grad;
    ctx.fill();

    // Edge hairline, plus a brighter top lip so the slab reads as lit from above.
    pathRound(ctx, inset(body, 0.5), r);
    ctx.strokeStyle = theme.panelEdge;
    ctx.lineWidth = theme.hairline;
    ctx.stroke();

    ctx.save();
    pathRound(ctx, body, r);
    ctx.clip();
    ctx.strokeStyle = theme.panelHighlight;
    ctx.lineWidth = theme.hairline;
    ctx.beginPath();
    ctx.moveTo(body.x + r, body.y + 0.5);
    ctx.lineTo(body.x + body.w - r, body.y + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  private drawWatermark(body: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.42;
    const spec = TYPE.label;
    ctx.font = `${spec.weight} ${spec.size * 0.85}px ${FAMILY.body}`;
    ctx.fillStyle = theme.fgMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    drawTracked(ctx, this.watermark ?? "", body.x + body.w - 26, body.y + body.h - 20, 2.6, "right");
    ctx.restore();
  }

  private drawHighlight(): void {
    const region = this.regions.find((r) => r.id === this.highlightId);
    if (!region) return;
    const { ctx } = this;
    const box = inset(region.rect, -10);
    ctx.save();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    pathRound(ctx, box, tokens.radius.md + 6);
    ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.restore();
  }

  // ── Reticle ───────────────────────────────────────────────────────────────

  private buildReticle(): void {
    const geo = new THREE.RingGeometry(0.0035, 0.006, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(theme.accent),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.reticle = new THREE.Mesh(geo, mat);
    this.reticle.renderOrder = (this.opts.renderOrder ?? 10) + 2;
    this.reticle.visible = false;
    this.group.add(this.reticle);
  }

  private placeReticle(local: THREE.Vector3, pressed: boolean): void {
    const ret = this.reticle;
    if (!ret) return;
    const n = this.localNormalAt(local);
    ret.position.copy(local).addScaledVector(n, 0.004);
    ret.position.y += this.slide;
    ret.lookAt(ret.position.clone().add(n));
    const s = pressed ? 0.62 : 1;
    ret.scale.setScalar(s);
    ret.visible = true;
  }

  private localNormalAt(local: THREE.Vector3): THREE.Vector3 {
    const R = this.opts.curveRadius ?? 0;
    if (R <= 0) return new THREE.Vector3(0, 0, 1);
    // Surface points sit on a circle centred at (0, y, R); the outward normal
    // is the direction back towards that centre.
    return new THREE.Vector3(-local.x, 0, R - local.z).normalize();
  }

  // ── Internals used by Gfx ─────────────────────────────────────────────────

  /** @internal */
  _ctx(): CanvasRenderingContext2D {
    return this.ctx;
  }
  /** @internal */
  _state(id: string): WidgetState {
    return {
      hover: this.hoverId === id,
      active: this.activeId === id,
      focus: this.focusId === id,
    };
  }
  /** @internal */
  _hit(spec: HitSpec): void {
    this.regions.push(spec);
  }
  /** @internal */
  _clicked(id: string): boolean {
    return this.pendingClicks.has(id);
  }
  /** @internal */
  _drag(id: string): { x: number; y: number } | null {
    return this.activeId === id ? this.dragPoint : null;
  }
  /** @internal */
  _focus(id: string): void {
    if (this.focusId !== id) {
      this.focusId = id;
      this.dirty = true;
    }
  }
  /** @internal */
  _modal(): void {
    this.modalFrom = this.regions.length;
  }
  /** @internal */
  _anim(id: string, target: number, ms: number): number {
    const rate = 5000 / Math.max(40, ms);
    const cur = this.anims.get(id);
    if (!cur) {
      this.anims.set(id, { v: target, target, rate });
      return target;
    }
    cur.rate = rate;
    if (cur.target !== target) {
      cur.target = target;
      this.animDirty = true;
    }
    return cur.v;
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    if (this.reticle) {
      this.reticle.geometry.dispose();
      this.reticle.material.dispose();
      this.reticle.removeFromParent();
    }
    this.anims.clear();
    this.regions = [];
    this.renderer = null;
  }
}

export function createPanel(options: PanelOptions): Panel {
  return new Panel(options);
}

// ── Gfx implementation ──────────────────────────────────────────────────────

class GfxImpl implements Gfx {
  bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  area: Rect = { x: 0, y: 0, w: 0, h: 0 };
  readonly theme = theme;

  constructor(private readonly panel: Panel) {}

  get ctx(): CanvasRenderingContext2D {
    return this.panel._ctx();
  }

  begin(bounds: Rect, area: Rect): void {
    this.bounds = bounds;
    this.area = area;
  }

  // Typography ---------------------------------------------------------------

  font(role: TypeRole, weight?: number, size?: number): string {
    const s = TYPE[role];
    return `${weight ?? s.weight} ${size ?? s.size}px ${FAMILY[s.family]}`;
  }

  private applyFont(o: TextOptions | undefined): TypeSpec {
    const spec = TYPE[o?.role ?? "body"];
    const size = o?.size ?? spec.size;
    const weight = o?.weight ?? spec.weight;
    this.ctx.font = `${weight} ${size}px ${FAMILY[spec.family]}`;
    return { ...spec, size, weight };
  }

  measure(s: string, o?: TextOptions): number {
    const spec = this.applyFont(o);
    const tracking = o?.tracking ?? spec.tracking;
    const str = o?.upper ? s.toUpperCase() : s;
    return measureTracked(this.ctx, str, tracking);
  }

  text(s: string, x: number, y: number, o?: TextOptions): number {
    const ctx = this.ctx;
    const spec = this.applyFont(o);
    const tracking = o?.tracking ?? spec.tracking;
    let str = o?.upper ? s.toUpperCase() : s;
    if (o?.maxWidth !== undefined) str = ellipsise(ctx, str, tracking, o.maxWidth);

    ctx.save();
    if (o?.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o?.color ?? theme.fg;
    ctx.textBaseline = o?.baseline ?? "middle";
    const w = drawTracked(ctx, str, x, y, tracking, o?.align ?? "left");
    ctx.restore();
    return w;
  }

  paragraph(s: string, r: Rect, o?: TextOptions & { lines?: number }): number {
    const ctx = this.ctx;
    const spec = this.applyFont(o);
    const tracking = o?.tracking ?? spec.tracking;
    const lh = spec.size * spec.line;
    const maxLines = o?.lines ?? Math.max(1, Math.floor(r.h / lh));
    const lines = wrap(ctx, s, tracking, r.w, maxLines);

    ctx.save();
    if (o?.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o?.color ?? theme.fg2;
    ctx.textBaseline = "middle";
    const align = o?.align ?? "left";
    const ax = align === "centre" ? r.x + r.w / 2 : align === "right" ? r.x + r.w : r.x;
    lines.forEach((line, i) => {
      drawTracked(ctx, line, ax, r.y + lh * (i + 0.5), tracking, align);
    });
    ctx.restore();
    return lines.length * lh;
  }

  // Shapes -------------------------------------------------------------------

  round(r: Rect, radius: Radii): void {
    pathRound(this.ctx, r, radius);
  }

  fillRound(r: Rect, radius: Radii, color: string): void {
    pathRound(this.ctx, r, radius);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  strokeRound(r: Rect, radius: Radii, color: string, width = theme.hairline): void {
    pathRound(this.ctx, inset(r, width / 2), radius);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.stroke();
  }

  hairline(x0: number, y0: number, x1: number, y1: number, color = theme.line): void {
    const ctx = this.ctx;
    ctx.beginPath();
    // Half-pixel offsets keep a 1px rule from smearing across two texels.
    ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
    ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = theme.hairline;
    ctx.stroke();
  }

  circle(cx: number, cy: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ring(cx: number, cy: number, r: number, color: string, width = 2): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  path(pts: readonly number[], color: string, width = 3, closed = false): void {
    const ctx = this.ctx;
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (closed) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  save(): void {
    this.ctx.save();
  }
  restore(): void {
    this.ctx.restore();
  }
  clip(r: Rect, radius: Radii = 0): void {
    pathRound(this.ctx, r, radius);
    this.ctx.clip();
  }
  alpha(a: number): void {
    this.ctx.globalAlpha *= a;
  }

  // Interaction --------------------------------------------------------------

  state(id: string): WidgetState {
    return this.panel._state(id);
  }
  hit(spec: HitSpec): void {
    this.panel._hit(spec);
  }
  clicked(id: string): boolean {
    return this.panel._clicked(id);
  }
  drag(id: string): { x: number; y: number } | null {
    return this.panel._drag(id);
  }
  focus(id: string): void {
    this.panel._focus(id);
  }
  anim(id: string, target: number, ms = tokens.motion.fast): number {
    return this.panel._anim(id, target, ms);
  }
  beginModal(): void {
    this.panel._modal();
  }
}

// ── Canvas primitives ───────────────────────────────────────────────────────

function normRadii(radius: Radii, r: Rect): [number, number, number, number] {
  const lim = Math.min(r.w, r.h) / 2;
  const c = (n: number) => Math.max(0, Math.min(n, lim));
  return Array.isArray(radius)
    ? [c(radius[0]), c(radius[1]), c(radius[2]), c(radius[3])]
    : [c(radius), c(radius), c(radius), c(radius)];
}

/** `roundRect` by hand — no reliance on a Chromium-version-dependent method. */
export function pathRound(ctx: CanvasRenderingContext2D, r: Rect, radius: Radii): void {
  const [tl, tr, br, bl] = normRadii(radius, r);
  const { x, y, w, h } = r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/**
 * Letter-spacing drawn by hand. `ctx.letterSpacing` is newer than some of the
 * browsers this has to survive, and per-character placement is exactly what the
 * room code needs anyway.
 */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "centre" | "right",
): number {
  const total = measureTracked(ctx, s, tracking);
  let cx = align === "centre" ? x - total / 2 : align === "right" ? x - total : x;
  if (tracking === 0) {
    ctx.textAlign = "left";
    ctx.fillText(s, cx, y);
    return total;
  }
  ctx.textAlign = "left";
  for (const ch of s) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return total;
}

function measureTracked(ctx: CanvasRenderingContext2D, s: string, tracking: number): number {
  if (tracking === 0) return ctx.measureText(s).width;
  let w = 0;
  let n = 0;
  for (const ch of s) {
    w += ctx.measureText(ch).width;
    n++;
  }
  return w + Math.max(0, n - 1) * tracking;
}

function ellipsise(
  ctx: CanvasRenderingContext2D,
  s: string,
  tracking: number,
  maxWidth: number,
): string {
  if (measureTracked(ctx, s, tracking) <= maxWidth) return s;
  const dots = "…";
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureTracked(ctx, s.slice(0, mid) + dots, tracking) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + dots;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  s: string,
  tracking: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureTracked(ctx, next, tracking) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && line && lines[lines.length - 1] !== line) {
    lines[lines.length - 1] = ellipsise(ctx, `${lines[lines.length - 1]} ${line}`, tracking, maxWidth);
  } else if (lines.length === maxLines) {
    lines[lines.length - 1] = ellipsise(ctx, lines[lines.length - 1], tracking, maxWidth);
  }
  return lines;
}

// ── Panel geometry ──────────────────────────────────────────────────────────

/**
 * A flat plane, or a cylindrical section wrapped around the viewer. With
 * `radius` set to the viewing distance, every point of the panel is equidistant
 * from the eye — text stays the same size and in focus corner to corner.
 */
function buildPanelGeometry(w: number, h: number, radius: number): THREE.BufferGeometry {
  if (radius <= 0) return new THREE.PlaneGeometry(w, h, 1, 1);

  const segs = Math.max(8, Math.min(48, Math.ceil((w / radius) * 36)));
  const arc = w / radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= 1; j++) {
    const y = (j === 0 ? -0.5 : 0.5) * h;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = (t - 0.5) * arc;
      positions.push(radius * Math.sin(a), y, radius * (1 - Math.cos(a)));
      normals.push(-Math.sin(a), 0, Math.cos(a));
      uvs.push(t, j);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i;
    const b = i + 1;
    const c = i + segs + 1;
    const d = i + segs + 2;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
