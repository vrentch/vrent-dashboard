/**
 * Flat mode — the product on a monitor.
 *
 * Everything in this file is inert inside a headset. It exists because the
 * spatial UI is authored in metres for a head roughly 1.2 m away, and a default
 * perspective camera sitting at the origin renders that as a postage stamp: the
 * 1.0 m menu panel covers about 19% of a 1600×900 viewport, which puts the
 * 27 design-px body role on screen at 5 px. Nobody can read that, which is why
 * the buttons "aren't there" in a browser tab. vrent.ch has to sell the game
 * from that tab, so the flat path gets a camera that frames what the app is
 * showing, and a way to look around the room it is showing it in.
 *
 * WHY THE CAMERA, AND NOT `world.scale`
 *
 * Either would fill the viewport. The camera wins for three reasons:
 *
 *  1. Safety. A scale left on `world` — by an early return, a dispose that did
 *     not run, a session that started between two frames — is content at the
 *     wrong physical size in a headset, which is the one bug in this product
 *     that makes people ill. The camera cannot leak: `syncCameraToHead()`
 *     overwrites its pose from the XR pose every single XR frame, and Three.js
 *     renders a session through its own projection, so nothing this file
 *     touches survives one frame of a session.
 *  2. Correctness for free. The flat pointer ray is built from the camera
 *     (`rayFromNdc`), so moving the camera keeps picking exact with no
 *     compensation anywhere. Scaling `world` would also strand the two things
 *     that are deliberately *not* parented to it — the toast layer and the
 *     environment veil, both camera-relative — at the wrong relative size.
 *  3. One mechanism. "Fill the viewport" and "look around" are the same
 *     transform: an orbit around the content. Framing is just the distance term.
 *
 * WHAT IT FRAMES
 *
 * Whatever is visible under `engine.world` that is not scenery and not an
 * overlay: the menu panel, the board. Scenery (`env-*`, lights, anything larger
 * than a room) is excluded, so the framing follows the app from menu to match
 * without any screen having to announce itself. The target is re-derived at
 * 5 Hz with hysteresis and eased over ~400 ms; a large change (menu → board)
 * also re-presents the content straight on, because that is a new thing to
 * look at.
 *
 * WHAT IT COMPOSITES INSTEAD
 *
 * The HUD is not framed with the rest — it is placed against the flat camera at
 * a fixed share of the viewport, in a strip along the bottom that the framing
 * is told to keep clear.
 *
 * Framing it was wrong twice over. It is authored 1.0 m wide for a head about a
 * metre away and anchored deliberately close to the board — clear of it from a
 * standing eye, which is all XR asks of it. Fold it into a box an orbit camera
 * then fits to the viewport and the same panel is both unreadable (1.0 m is
 * 1600 design px; it landed on screen at 380 px, putting the 22 px caption role
 * at 5 px) and in the way (it is nearer than the board, so it projects across
 * the middle rows, and a press that lands on it never reaches the card the
 * pointer is visibly highlighting). Compositing fixes both at once: the strip
 * is sized in screen space, so legibility no longer depends on how big the
 * board happens to be, and the board is framed into the space above it.
 *
 * It stays pickable throughout — its gear is a control — so it is excluded from
 * the framing set only, never from the pointer set. Its authored pose is put
 * back the moment a session starts or this file is disposed, and re-read
 * whenever its owner writes a new one, so `hud.setPlacement` still decides
 * where it lives in a headset.
 *
 * THE POINTER
 *
 * Flat mode owns the mouse/touch pointer end to end (id -1) and replaces the
 * one `input.ts` synthesises. It has to: only this file knows whether a press
 * was aimed at the UI or at empty space, and press edges have to be latched
 * from DOM events rather than sampled per frame — a tap that opens and closes
 * between two frames is otherwise either collapsed into a single frame or, if
 * the pointer went inactive with it, dropped entirely. Edges here are queued
 * and released at most one per frame, so a press is always held for at least
 * one full frame before its release lands.
 *
 * No colour, texture or material is derived here, so there is nothing for
 * `onThemeChange` to rebuild — the camera is theme-independent by construction.
 */

import * as THREE from "three";
import type { Engine, PointerState } from "../contracts.ts";
import { pick, rayFromNdc } from "./raycast.ts";

// ── Tuning ──────────────────────────────────────────────────────────────────

/**
 * Vertical field of view on a monitor. 48° is ~77° horizontal at 16:9: wide
 * enough to keep the room around the content visible, narrow enough that a
 * near-screen-filling panel is not bent by perspective at its edges. The
 * engine's 60° is kept for XR, where the runtime supplies the projection
 * anyway.
 */
export const FLAT_FOV = 48;

/** Half the vertical FOV in tangent form — metres of frame per metre of depth. */
const HALF_FOV_TAN = Math.tan((FLAT_FOV * Math.PI) / 360);

/**
 * Fraction of the viewport the framed content is asked to cover. The tighter
 * of the two governs, so wide content is bounded by width and tall content by
 * height, and neither ever runs off the edge.
 */
const FILL_X = 0.84;
const FILL_Y = 0.8;

/** Anything whose bounding box is bigger than this across is scenery. */
const MAX_CONTENT_SPAN = 16;

/**
 * Cap on the individual mesh boxes the span solver projects. Past it the tail
 * is merged into the last box rather than dropped — coarser still contains the
 * geometry, where dropping it would frame content off the edge of the screen.
 */
const MAX_FRAME_BOXES = 192;

/** Seconds between framing re-derivations. Cheap, but not worth doing at 90 Hz. */
const RETARGET_INTERVAL = 0.2;
/** How soon to try again after a re-derivation was held back. */
const RETARGET_RETRY = 0.05;
/**
 * Consecutive re-derivations that may be held while content fades back in.
 * Six at the retry interval is 0.3 s: longer than the 220 ms panel transition,
 * short enough that a genuine disappearance is never followed for long.
 */
const MAX_HELD_RETARGETS = 6;

/** Ease rates, 1/s. ~400 ms to settle: deliberate, not floaty. */
const FRAME_EASE = 6;
const ORBIT_EASE = 5;
const ZOOM_EASE = 12;

/** Framing hysteresis — below this the target has not really moved. */
const MOVE_EPS = 0.02;
const SIZE_EPS = 0.03;
/** Above this the app is showing something else; present it straight on. */
const RESET_MOVE = 0.4;
const RESET_SIZE = 0.25;

/** CSS px of travel before a press on empty space becomes a look. */
const DRAG_THRESHOLD_PX = 4;
/** Radians of orbit per viewport height dragged. */
const ORBIT_SPAN = Math.PI;
/** Hard limit on how far above or below the content the camera may swing. */
const PITCH_LIMIT = 0.7;
/** The camera never drops below this height, so it cannot go under the floor. */
const FLOOR_CLEARANCE = 0.15;

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.4;
const ZOOM_STEP = 0.1;

const MIN_DISTANCE = 0.28;
const MAX_DISTANCE = 40;

/** Far enough for anything flat mode can frame, plus the zoom-out headroom. */
const PICK_FAR = 60;

/** A material this transparent is on its way out; do not frame it. */
const MIN_DRAWN_OPACITY = 0.06;

// ── Overlay ─────────────────────────────────────────────────────────────────

/** Name of the one overlay the app ships. Anything may opt in via userData. */
const OVERLAY_NAME = "vr-hud";

/**
 * Share of the viewport width the overlay is composited at.
 *
 * The HUD is 1.0 m of panel carrying 1600 design px, so this fraction *is* the
 * design-to-screen ratio: 0.6 puts its 22 px caption role on screen at 13 px
 * and its 27 px body role at 16 px. The menu panel resolves at about 0.69 on
 * the same viewport, which is the bar this is set against.
 */
const OVERLAY_FILL_X = 0.6;
/** Ceiling for the widening below — an overlay never spans the whole frame. */
const OVERLAY_MAX_FILL_X = 0.94;
/**
 * ...and the height it is allowed to take, which is what actually bounds it.
 * The HUD is 4.3:1, so on a wide viewport the preferred width would eat a third
 * of the screen; on a tall one it would shrink to a ribbon. Both are corrected
 * by trading width against these.
 */
const OVERLAY_MIN_FILL_Y = 0.15;
const OVERLAY_MAX_FILL_Y = 0.28;

/** Clear space under the overlay, and between it and the framed content. */
const OVERLAY_MARGIN = 0.03;
const OVERLAY_GAP = 0.03;

/**
 * How far in front of the camera the overlay sits, as a share of the framing
 * distance. Its screen size is solved for, so depth only decides what it draws
 * in front of — and it has to be everything, or a card would occlude the HUD.
 */
const OVERLAY_DEPTH = 0.45;
const OVERLAY_NEAR = 0.18;
const OVERLAY_FAR = 0.7;

/** `contracts.ts`: -1 is the mouse. */
const MOUSE_ID = -1;

const EDGE_DOWN = 1;
const EDGE_UP = 0;
/** A queue longer than this means events are arriving faster than frames. */
const MAX_QUEUED_EDGES = 8;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * What the framed content actually occupies. Measured from the geometry that
 * is on screen, not from a box around it, so it can be trusted as the
 * design-to-screen ratio: a 1.0 m panel carries 1600 design px, so `width` of
 * 0.69 puts a 22 design-px caption on screen at 15 px. Composited overlays are
 * not included — they are sized in screen space and need no checking.
 */
export interface FlatCoverage {
  /** Fraction of the viewport width the framed content spans, 0-1. */
  width: number;
  /** Fraction of the viewport height, 0-1. */
  height: number;
  /** That width in CSS pixels — the number to sanity-check text sizes against. */
  pixels: number;
}

export interface FlatMode {
  /** True when the app is on a screen rather than in a session. */
  isFlat(): boolean;
  /**
   * Re-frames and applies the camera. The engine calls this once per frame,
   * before pointer rays are built. A no-op in XR.
   */
  update(dt: number): void;
  /**
   * Merges the flat pointer into this frame's snapshot, dropping the one
   * `input.ts` produced. The engine calls this straight after `input.update`.
   */
  syncPointers(source: PointerState[]): PointerState[];
  /** This frame's snapshot, as returned by the last `syncPointers`. */
  pointers(): PointerState[];
  /** The viewport changed shape: re-solve the framing distance immediately. */
  resize(): void;
  /** Cancel any orbit and zoom, easing back to a straight-on view. */
  resetView(): void;
  /** Frame this object alone. Pass null to go back to framing everything. */
  setFocus(object: THREE.Object3D | null): void;
  /** How much of the viewport the framed content currently covers. */
  coverage(): FlatCoverage;
  dispose(): void;
}

// ── Module-level access ─────────────────────────────────────────────────────

/**
 * One engine per page, so one flat mode. Exported free of the engine so any
 * module can branch on the flat path without being handed a reference.
 */
let activeMode: FlatMode | null = null;

/** True when the app is running on a screen rather than in a headset. */
export function isFlat(): boolean {
  return activeMode ? activeMode.isFlat() : true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Signed shortest way round from `from` to `to`. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Largest per-axis change between two sizes, relative to the old one. */
function sizeChange(next: THREE.Vector3, prev: THREE.Vector3): number {
  const axis = (a: number, b: number) => Math.abs(a - b) / Math.max(b, 0.05);
  return Math.max(axis(next.x, prev.x), axis(next.y, prev.y), axis(next.z, prev.z));
}

function isScenery(o: THREE.Object3D): boolean {
  if (o.userData.flatIgnore === true) return true;
  if ((o as Partial<THREE.Light>).isLight === true) return true;
  const name = o.name;
  return name === "env" || name.startsWith("env-");
}

/**
 * True for content composited at a fixed screen size instead of being framed.
 *
 * Only the HUD qualifies today. It is excluded from the framing set and from
 * nothing else: it stays pickable, and it is still drawn by the same renderer
 * on the same frame — this file only decides where it lands on screen.
 */
function isOverlay(o: THREE.Object3D): boolean {
  return o.userData.flatOverlay === true || o.name === OVERLAY_NAME;
}

/** False for something that is fully faded out — it is leaving, not content. */
function isDrawn(o: THREE.Object3D): boolean {
  const material = (o as Partial<THREE.Mesh>).material;
  if (!material) return true;
  if (Array.isArray(material)) {
    for (const m of material) if (!m.transparent || m.opacity > MIN_DRAWN_OPACITY) return true;
    return false;
  }
  return !material.transparent || material.opacity > MIN_DRAWN_OPACITY;
}

// ── Implementation ──────────────────────────────────────────────────────────

export function createFlatMode(engine: Engine): FlatMode {
  const { camera, renderer, world } = engine;
  const dom = renderer.domElement;

  /** The engine's authored FOV, restored whenever a session takes over. */
  const sessionFov = camera.fov;

  // Framing -----------------------------------------------------------------

  const targetCentre = new THREE.Vector3();
  const targetSize = new THREE.Vector3();
  const curCentre = new THREE.Vector3();
  let targetDistance = 1;
  let curDistance = 1;
  let hasTarget = false;
  let snapFrame = true;
  let sinceRetarget = Number.POSITIVE_INFINITY;

  /**
   * World AABBs of the individual meshes the framing was solved from, and the
   * pool the next pass is built in. `spanAt` projects these rather than the
   * eight corners of their union: once the framed set has any depth, most of
   * those corners sit in front of geometry that is not there.
   */
  let frameBoxes: THREE.Box3[] = [];
  let stageBoxes: THREE.Box3[] = [];
  let frameBoxCount = 0;
  let stageCount = 0;

  /** Roots that drew into the last accepted framing, and into the pass in hand. */
  const framedRoots = new Set<THREE.Object3D>();
  const contributing = new Set<THREE.Object3D>();
  let heldRetargets = 0;

  // Orbit -------------------------------------------------------------------

  let yaw = 0;
  let pitch = 0;
  let zoom = 1;
  let wantYaw = 0;
  let wantPitch = 0;
  let wantZoom = 1;

  // Scratch -----------------------------------------------------------------

  /** Everything a pointer may hit, and the subset the camera frames. */
  const roots: THREE.Object3D[] = [];
  const frameRoots: THREE.Object3D[] = [];
  const stack: THREE.Object3D[] = [];
  const scratchBox = new THREE.Box3();
  const meshBox = new THREE.Box3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const span2 = new THREE.Vector2();
  const corner = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3();
  const probe = new THREE.PerspectiveCamera();
  const probeRay = new THREE.Ray();
  let focus: THREE.Object3D | null = null;

  // Overlay -----------------------------------------------------------------

  /** The overlay's extent in its own object space, i.e. before its transform. */
  const overlayBox = new THREE.Box3();
  const overlaySize = new THREE.Vector3();
  const overlayCentre = new THREE.Vector3();
  /** Share of the viewport it is composited at, and the strip it reserves. */
  let overlayFillX = 0;
  let overlayFillY = 0;
  let overlayBand = 0;
  let overlayRoot: THREE.Object3D | null = null;

  /** The pose its owner authored, restored the moment this file lets go. */
  let overlayHeld: THREE.Object3D | null = null;
  const homePosition = new THREE.Vector3();
  const homeQuaternion = new THREE.Quaternion();
  const homeScale = new THREE.Vector3();
  /** What was last written, so a pose from anywhere else is recognisable. */
  const wrotePosition = new THREE.Vector3();
  const wroteQuaternion = new THREE.Quaternion();
  const wroteScale = new THREE.Vector3();

  const camPosition = new THREE.Vector3();
  const camQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const m1 = new THREE.Matrix4();
  const m2 = new THREE.Matrix4();

  // Pointer -----------------------------------------------------------------

  const ndc = new THREE.Vector2();
  const flatPointer: PointerState = {
    id: MOUSE_ID,
    ray: new THREE.Ray(),
    pressed: false,
    held: false,
    released: false,
    isHand: false,
  };
  const queue: number[] = [];
  let held = false;
  let active = false;
  let snapshot: PointerState[] = [];
  const merged: PointerState[] = [];

  let gesture: "none" | "ui" | "look" = "none";
  let gesturePointer = -1;
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;

  let disposed = false;

  function isFlatNow(): boolean {
    return !renderer.xr.isPresenting && engine.mode === "none";
  }

  // ── Framing ───────────────────────────────────────────────────────────────

  /**
   * Top-level things worth pointing at, and the subset worth framing.
   *
   * They are deliberately different sets. An overlay has to keep receiving
   * pointers — the HUD's gear is a control — but it must not be inside the box
   * the framing solver fits to the viewport, because its size on screen is
   * decided separately.
   */
  function collectRoots(): void {
    roots.length = 0;
    frameRoots.length = 0;
    overlayRoot = null;
    if (focus) {
      // An explicit focus overrides everything, overlay included: the caller
      // asked for that object and nothing else.
      if (focus.visible) {
        roots.push(focus);
        frameRoots.push(focus);
      }
      return;
    }
    for (const child of world.children) {
      if (!child.visible || isScenery(child)) continue;
      roots.push(child);
      if (isOverlay(child)) {
        if (overlayRoot === null) overlayRoot = child;
      } else {
        frameRoots.push(child);
      }
    }
  }

  /** Adds one mesh box to the staging pool, merging past the cap. */
  function stageBox(src: THREE.Box3): void {
    if (stageCount < MAX_FRAME_BOXES) {
      const slot = stageBoxes[stageCount];
      if (slot) slot.copy(src);
      else stageBoxes.push(src.clone());
      stageCount++;
      return;
    }
    stageBoxes[MAX_FRAME_BOXES - 1].union(src);
  }

  /**
   * World-space union of everything drawn under `list`, into `box`.
   *
   * Also records which roots drew anything, and — when `capture` is set — the
   * individual mesh boxes, which is what the span solver reads.
   */
  function unionContent(list: readonly THREE.Object3D[], box: THREE.Box3, capture: boolean): boolean {
    box.makeEmpty();
    contributing.clear();
    if (capture) stageCount = 0;
    let found = false;

    for (const root of list) {
      let drew = false;
      stack.length = 0;
      stack.push(root);
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || !node.visible || isScenery(node)) continue;

        const geometry = (node as Partial<THREE.Mesh>).geometry;
        if (geometry && isDrawn(node)) {
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const bounds = geometry.boundingBox;
          if (bounds && bounds.min.x <= bounds.max.x) {
            meshBox.copy(bounds).applyMatrix4(node.matrixWorld);
            // A room shell parented under `world` is scenery whatever it is called.
            if (meshBox.getSize(v3).length() <= MAX_CONTENT_SPAN) {
              box.union(meshBox);
              if (capture) stageBox(meshBox);
              drew = true;
            }
          }
        }

        for (const child of node.children) stack.push(child);
      }
      if (drew) {
        contributing.add(root);
        found = true;
      }
    }

    return found;
  }

  /**
   * True when something that was in the frame a moment ago is still on screen
   * but drew nothing this pass.
   *
   * `Panel.transition()` zeroes a panel's opacity synchronously and lets the
   * fade tick it back up from the frame callbacks, which run *after* this file.
   * A re-derivation landing in that window sees the menu as gone and frames
   * whatever is left — often a fraction of the content, and the camera dives at
   * it before easing back. Anything still parented and still visible is on its
   * way in, not out; wait for it rather than reframing around a hole.
   */
  function lostContent(): boolean {
    for (const root of framedRoots) {
      if (contributing.has(root)) continue;
      if (root.parent !== null && root.visible) return true;
    }
    return false;
  }

  /** The yaw content is authored to be seen from — `world`'s own facing. */
  function baseYaw(): number {
    return world.rotation.y;
  }

  function place(
    cam: THREE.PerspectiveCamera,
    centre: THREE.Vector3,
    distance: number,
    yawTotal: number,
    pitchAngle: number,
    panNdc: number,
  ): void {
    const cp = Math.cos(pitchAngle);
    dir.set(Math.sin(yawTotal) * cp, Math.sin(pitchAngle), Math.cos(yawTotal) * cp);
    cam.position.copy(centre).addScaledVector(dir, distance);
    cam.up.set(0, 1, 0);
    cam.lookAt(centre);
    if (panNdc <= 0) return;

    // Carving the overlay's strip out of the bottom of the frame is a pan, not
    // a tilt: drop the eye along its own up axis and the content rides up the
    // frame with the view direction untouched, so nothing is foreshortened.
    up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    let pan = panNdc * distance * HALF_FOV_TAN;
    if (up.y > 1e-4) pan = Math.min(pan, Math.max(0, (cam.position.y - FLOOR_CLEARANCE) / up.y));
    cam.position.addScaledVector(up, -pan);
  }

  /** Fraction of the viewport height left for framed content by the overlay. */
  function contentFillY(): number {
    return FILL_Y * (1 - overlayBand);
  }

  /**
   * Fraction of the viewport the framed content would span, seen straight on
   * from `distance`.
   *
   * Measured by projecting the per-mesh boxes rather than the eight corners of
   * their union. The union's corners are mostly empty space the moment the
   * framed set has depth — a curved panel and a tilted board a third of a metre
   * apart put synthetic near corners 0.3 m in front of anything real, which had
   * this reporting a fifth more width than the panel actually had, in exactly
   * the case `coverage()` exists to catch.
   */
  function spanAt(distance: number, out: THREE.Vector2): THREE.Vector2 {
    probe.fov = FLAT_FOV;
    probe.aspect = camera.aspect || 1;
    probe.near = camera.near;
    probe.far = camera.far;
    probe.updateProjectionMatrix();
    place(probe, targetCentre, distance, baseYaw(), 0, overlayBand);
    probe.updateMatrixWorld(true);

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let b = 0; b < frameBoxCount; b++) {
      const box = frameBoxes[b];
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        );
        corner.project(probe);
        if (corner.x < minX) minX = corner.x;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.y > maxY) maxY = corner.y;
      }
    }
    if (minX > maxX) return out.set(0, 0);
    // Clip space spans 2 units across the viewport.
    return out.set((maxX - minX) / 2, (maxY - minY) / 2);
  }

  /**
   * Distance at which the content covers the fill targets. Seeded with the
   * closed form, then corrected against a real projection — span is inversely
   * proportional to distance, so one pass converges and two settle it.
   */
  function solveDistance(): number {
    const aspect = camera.aspect || 1;
    const fillY = contentFillY();
    const byHeight = targetSize.y / 2 / (HALF_FOV_TAN * fillY);
    const byWidth = targetSize.x / 2 / (HALF_FOV_TAN * aspect * FILL_X);
    let distance = clamp(Math.max(byHeight, byWidth) + targetSize.z / 2, MIN_DISTANCE, MAX_DISTANCE);

    for (let i = 0; i < 2; i++) {
      const span = spanAt(distance, span2);
      const k = Math.max(span.x / FILL_X, span.y / fillY);
      if (!Number.isFinite(k) || k <= 0) break;
      distance = clamp(distance * k, MIN_DISTANCE, MAX_DISTANCE);
    }
    return distance;
  }

  /** Re-derives the framing. False when the last one was kept instead. */
  function retarget(): boolean {
    // Nothing on screen — a fade between screens, or the entry page still up.
    // Hold the last framing rather than lurching to the origin.
    if (!unionContent(frameRoots, scratchBox, true)) return false;

    if (hasTarget && heldRetargets < MAX_HELD_RETARGETS && lostContent()) {
      heldRetargets++;
      return false;
    }
    heldRetargets = 0;

    // Publish this pass's mesh boxes by swapping the pools, so a held pass
    // never leaves the span solver reading a half-rebuilt set.
    const previous = frameBoxes;
    frameBoxes = stageBoxes;
    stageBoxes = previous;
    frameBoxCount = stageCount;

    framedRoots.clear();
    for (const root of contributing) framedRoots.add(root);

    scratchBox.getCenter(v1);
    scratchBox.getSize(v2);

    const moved = hasTarget ? v1.distanceTo(targetCentre) : Number.POSITIVE_INFINITY;
    const grew = hasTarget ? sizeChange(v2, targetSize) : Number.POSITIVE_INFINITY;

    if (!hasTarget || moved >= MOVE_EPS || grew >= SIZE_EPS) {
      if (hasTarget && (moved > RESET_MOVE || grew > RESET_SIZE)) {
        // A different thing to look at. Show it the way it was authored.
        wantYaw = 0;
        wantPitch = 0;
        wantZoom = 1;
      }
      targetCentre.copy(v1);
      targetSize.copy(v2);
      if (!hasTarget) curCentre.copy(v1);
    }

    // Always re-solved: the distance depends on the aspect ratio as well as on
    // the content, and the window can change shape without the content moving.
    targetDistance = solveDistance();
    hasTarget = true;
    return true;
  }

  /** Lowest pitch that keeps the camera off the floor. */
  function pitchFloor(distance: number): number {
    const sin = clamp((FLOOR_CLEARANCE - curCentre.y) / Math.max(distance, 1e-3), -1, 1);
    return Math.max(-PITCH_LIMIT, Math.asin(sin));
  }

  function appliedDistance(): number {
    return clamp(curDistance * zoom, MIN_DISTANCE, MAX_DISTANCE);
  }

  // ── Overlay ───────────────────────────────────────────────────────────────

  /**
   * The overlay's extent in its own object space — everything under it with its
   * own transform divided out, so the measurement never depends on the scale
   * this file last gave it.
   *
   * Visibility is the test here, not opacity. The HUD's turn pulse is a plane
   * that breathes in and out over three seconds and is a shade wider than the
   * panel; dropping it from the box each time it crossed the drawn threshold
   * would pump the whole overlay's size along with it.
   */
  function measureOverlay(root: THREE.Object3D): boolean {
    overlayBox.makeEmpty();
    m2.copy(root.matrixWorld).invert();
    stack.length = 0;
    stack.push(root);
    let found = false;

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || !node.visible) continue;
      const geometry = (node as Partial<THREE.Mesh>).geometry;
      if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (bounds && bounds.min.x <= bounds.max.x) {
          m1.multiplyMatrices(m2, node.matrixWorld);
          meshBox.copy(bounds).applyMatrix4(m1);
          overlayBox.union(meshBox);
          found = true;
        }
      }
      for (const child of node.children) stack.push(child);
    }

    return found;
  }

  /**
   * Works out the strip of screen the overlay will take, before the framing is
   * solved — the two have to agree, and the framing is what has to give way.
   * Leaves the band at zero when there is nothing to composite, which puts the
   * framing back to using the whole viewport.
   */
  function measureBand(): void {
    overlayBand = 0;
    overlayFillX = 0;
    overlayFillY = 0;
    if (overlayRoot === null || !measureOverlay(overlayRoot)) return;

    overlayBox.getSize(overlaySize);
    if (overlaySize.x <= 1e-4 || overlaySize.y <= 1e-4) return;

    const aspect = camera.aspect || 1;
    const shape = overlaySize.x / overlaySize.y;
    let fillX = OVERLAY_FILL_X;
    let fillY = (fillX / shape) * aspect;
    // Width is the preference, height is the constraint: a 4.3:1 bar at a fixed
    // share of a very wide viewport would eat a third of the screen, and on a
    // narrow one it would shrink below reading size. Trade one for the other.
    if (fillY > OVERLAY_MAX_FILL_Y) {
      fillY = OVERLAY_MAX_FILL_Y;
      fillX = (fillY * shape) / aspect;
    } else if (fillY < OVERLAY_MIN_FILL_Y) {
      fillX = Math.min(OVERLAY_MAX_FILL_X, (OVERLAY_MIN_FILL_Y * shape) / aspect);
      fillY = (fillX / shape) * aspect;
    }

    overlayFillX = fillX;
    overlayFillY = fillY;
    overlayBand = OVERLAY_MARGIN + fillY + OVERLAY_GAP;
  }

  function rememberHome(root: THREE.Object3D): void {
    homePosition.copy(root.position);
    homeQuaternion.copy(root.quaternion);
    homeScale.copy(root.scale);
  }

  /** Hands the overlay back to its owner, exactly as it was authored. */
  function releaseOverlay(): void {
    const root = overlayHeld;
    if (root === null) return;
    overlayHeld = null;
    root.position.copy(homePosition);
    root.quaternion.copy(homeQuaternion);
    root.scale.copy(homeScale);
    root.updateMatrix();
    if (root.parent) root.updateMatrixWorld(true);
  }

  /**
   * Pins the overlay across the bottom of the frame at the share of the
   * viewport `measureBand` settled on, facing the camera square on.
   *
   * Called after the camera has been placed, because it is placed against it.
   */
  function placeOverlay(framingDistance: number): void {
    const root = overlayRoot;
    if (root === null || overlayBand <= 0 || root.parent === null) {
      releaseOverlay();
      return;
    }

    if (overlayHeld !== root) {
      releaseOverlay();
      overlayHeld = root;
      rememberHome(root);
    } else if (
      !root.position.equals(wrotePosition) ||
      !root.quaternion.equals(wroteQuaternion) ||
      !root.scale.equals(wroteScale)
    ) {
      // Its owner re-posed it — a placement change, say. That is the pose to
      // hand back, not the one from before the change.
      rememberHome(root);
    }

    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(camPosition, camQuaternion, scratchScale);

    const aspect = camera.aspect || 1;
    // Depth is free — the screen size is solved for — so it is chosen purely to
    // keep the overlay in front of everything it might otherwise be buried in.
    const depth = clamp(framingDistance * OVERLAY_DEPTH, OVERLAY_NEAR, OVERLAY_FAR);
    const halfH = depth * HALF_FOV_TAN;
    const scale = (2 * overlayFillX * halfH * aspect) / overlaySize.x;

    // Where the overlay's own centre has to land: bottom of the frame, centred.
    v1.set(0, 0, -1).applyQuaternion(camQuaternion);
    v2.set(0, 1, 0).applyQuaternion(camQuaternion);
    anchor
      .copy(camPosition)
      .addScaledVector(v1, depth)
      .addScaledVector(v2, (-1 + 2 * OVERLAY_MARGIN + overlayFillY) * halfH);
    // ...and the origin that puts it there, since the two rarely coincide.
    overlayBox.getCenter(overlayCentre);
    anchor.sub(overlayCentre.multiplyScalar(scale).applyQuaternion(camQuaternion));

    m1.compose(anchor, camQuaternion, scratchScale.setScalar(scale));
    m2.copy(root.parent.matrixWorld).invert();
    m1.premultiply(m2).decompose(root.position, root.quaternion, root.scale);
    root.updateMatrix();
    root.updateMatrixWorld(true);

    wrotePosition.copy(root.position);
    wroteQuaternion.copy(root.quaternion);
    wroteScale.copy(root.scale);
  }

  function update(dt: number): void {
    if (disposed || !isFlatNow()) return;

    if (camera.fov !== FLAT_FOV) {
      camera.fov = FLAT_FOV;
      camera.updateProjectionMatrix();
    }

    // Both sets are wanted every frame: the framing reads one, the pointer the
    // other, and the overlay's strip has to be known before the framing solves.
    collectRoots();
    measureBand();

    sinceRetarget += dt;
    if (sinceRetarget >= RETARGET_INTERVAL) {
      sinceRetarget = retarget() ? 0 : RETARGET_INTERVAL - RETARGET_RETRY;
    }
    if (!hasTarget) {
      releaseOverlay();
      return;
    }

    const kf = snapFrame ? 1 : 1 - Math.exp(-dt * FRAME_EASE);
    curCentre.lerp(targetCentre, kf);
    curDistance += (targetDistance - curDistance) * kf;
    snapFrame = false;

    if (dragging) {
      // Direct manipulation is never eased: the view tracks the hand 1:1.
      yaw = wantYaw;
      pitch = wantPitch;
    } else {
      const ko = 1 - Math.exp(-dt * ORBIT_EASE);
      yaw += angleDelta(yaw, wantYaw) * ko;
      pitch += (wantPitch - pitch) * ko;
    }
    zoom += (wantZoom - zoom) * (1 - Math.exp(-dt * ZOOM_EASE));

    const distance = appliedDistance();
    place(
      camera,
      curCentre,
      distance,
      baseYaw() + yaw,
      clamp(pitch, pitchFloor(distance), PITCH_LIMIT),
      overlayBand,
    );
    placeOverlay(distance);
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  function trackNdc(event: PointerEvent): boolean {
    const rect = dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    active = true;
    return true;
  }

  /** True when the pointer is aimed at the UI or the board rather than the room. */
  function overContent(): boolean {
    collectRoots();
    if (roots.length === 0) return false;
    rayFromNdc(camera, ndc.x, ndc.y, probeRay);
    return pick(probeRay, roots, { far: PICK_FAR }) !== null;
  }

  function queueEdge(edge: number): void {
    // A release is never dropped: losing one would strand the latch held down
    // for the rest of the session.
    if (edge === EDGE_DOWN && queue.length >= MAX_QUEUED_EDGES) return;
    queue.push(edge);
  }

  /**
   * Promotes at most one queued edge per frame, so every press is held for a
   * full frame before its release is delivered. Without that, a tap that both
   * opens and closes between two frames arrives as a single frame carrying
   * `pressed` and `released` together — which consumers that arm on press and
   * fire on release can miss entirely.
   */
  function resolvePointer(): PointerState | null {
    // A live look drag withdraws the pointer entirely, so the ray sweeping
    // across the UI cannot light controls up on its way past.
    if (dragging) return null;

    let pressed = false;
    let released = false;

    while (queue.length > 0) {
      const edge = queue[0];
      if (edge === EDGE_DOWN) {
        if (held) {
          queue.shift();
          continue;
        }
        queue.shift();
        held = true;
        pressed = true;
        break;
      }
      if (!held) {
        queue.shift();
        continue;
      }
      queue.shift();
      held = false;
      released = true;
      break;
    }

    if (!active && !held && !pressed && !released) return null;

    flatPointer.pressed = pressed;
    flatPointer.released = released;
    flatPointer.held = held;
    rayFromNdc(camera, ndc.x, ndc.y, flatPointer.ray);
    return flatPointer;
  }

  function syncPointers(source: PointerState[]): PointerState[] {
    if (!isFlatNow()) {
      snapshot = source;
      return source;
    }
    merged.length = 0;
    // The mouse slot `input.ts` keeps is replaced, not augmented: press edges
    // and drag arbitration both have to come from one place.
    for (const p of source) if (p.id !== MOUSE_ID) merged.push(p);
    const flat = resolvePointer();
    if (flat) merged.push(flat);
    snapshot = merged;
    return merged;
  }

  // ── Look controls ─────────────────────────────────────────────────────────

  function orbitBy(dx: number, dy: number): void {
    const rect = dom.getBoundingClientRect();
    const span = Math.max(1, rect.height);
    wantYaw -= (dx / span) * ORBIT_SPAN;
    const floor = pitchFloor(appliedDistance());
    wantPitch = clamp(wantPitch + (dy / span) * ORBIT_SPAN, floor, PITCH_LIMIT);
  }

  function endGesture(): void {
    // Queued unconditionally: a down may still be waiting its turn, and a lone
    // up with nothing held is dropped by the resolver anyway.
    if (gesture === "ui") queueEdge(EDGE_UP);
    if (gesture === "look" && dragging) dom.style.cursor = "";
    if (gesturePointer >= 0 && dom.hasPointerCapture?.(gesturePointer)) {
      try {
        dom.releasePointerCapture(gesturePointer);
      } catch {
        // Capture already lost with the pointer; nothing to release.
      }
    }
    gesture = "none";
    gesturePointer = -1;
    dragging = false;
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!isFlatNow() || !event.isPrimary) return;
    if (gesture !== "none") endGesture();
    if (!trackNdc(event)) return;

    gesturePointer = event.pointerId;
    try {
      dom.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable (synthetic events in tests); the gesture still works,
      // it just ends early if the pointer leaves the canvas.
    }

    if (overContent()) {
      gesture = "ui";
      queueEdge(EDGE_DOWN);
      return;
    }

    // Empty space: a look, never a click. Nothing is delivered to the UI for
    // this gesture at all, so no press can survive the drag and fire on release.
    gesture = "look";
    dragging = false;
    downX = lastX = event.clientX;
    downY = lastY = event.clientY;
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!isFlatNow() || !event.isPrimary) return;
    trackNdc(event);
    if (gesture !== "look" || event.pointerId !== gesturePointer) return;

    if (!dragging) {
      if (
        Math.abs(event.clientX - downX) < DRAG_THRESHOLD_PX &&
        Math.abs(event.clientY - downY) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging = true;
      dom.style.cursor = "grabbing";
      // Measure from the press, not from here: a flick can cross the threshold
      // in one event, and throwing that event away would lose the whole flick.
      lastX = downX;
      lastY = downY;
    }

    orbitBy(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== gesturePointer) return;
    if (gesture === "ui") queueEdge(EDGE_UP);
    if (gesture === "look" && dragging) dom.style.cursor = "";
    if (dom.hasPointerCapture?.(event.pointerId)) {
      try {
        dom.releasePointerCapture(event.pointerId);
      } catch {
        // Released with the pointer itself.
      }
    }
    gesture = "none";
    gesturePointer = -1;
    dragging = false;
    // A finger that has lifted is no longer hovering anything; a mouse still is.
    if (event.pointerType !== "mouse") active = false;
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== gesturePointer) return;
    endGesture();
    active = false;
  };

  const onPointerLeave = (): void => {
    // Only fires when nothing is captured, so it cannot interrupt a drag.
    active = false;
  };

  const onWheel = (event: WheelEvent): void => {
    if (!isFlatNow() || event.ctrlKey) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    wantZoom = clamp(wantZoom * Math.exp(Math.sign(event.deltaY) * ZOOM_STEP), ZOOM_MIN, ZOOM_MAX);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (!isFlatNow()) return;
    const rect = dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    // Double-clicking a control is a control interaction, not a view reset.
    if (overContent()) return;
    resetView();
  };

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove, { passive: true });
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerCancel);
  dom.addEventListener("pointerleave", onPointerLeave);
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("dblclick", onDoubleClick);

  const offMode = engine.onModeChange((mode) => {
    endGesture();
    queue.length = 0;
    held = false;
    active = false;
    // Unconditional, and first: content composited against a *flat* camera is
    // content at the wrong size and place in a headset, and the pose has to be
    // back before the session's first frame either way.
    releaseOverlay();
    overlayBand = 0;
    if (mode === "none") {
      // Back from a session: re-frame from scratch and show it straight on.
      // Easing in from wherever the headset left the camera would read as drift.
      yaw = wantYaw = 0;
      pitch = wantPitch = 0;
      zoom = wantZoom = 1;
      hasTarget = false;
      snapFrame = true;
      sinceRetarget = Number.POSITIVE_INFINITY;
      framedRoots.clear();
      heldRetargets = 0;
      frameBoxCount = 0;
    } else if (camera.fov !== sessionFov) {
      camera.fov = sessionFov;
      camera.updateProjectionMatrix();
    }
  });

  // ── Public surface ────────────────────────────────────────────────────────

  function resetView(): void {
    wantYaw = 0;
    wantPitch = 0;
    wantZoom = 1;
  }

  const mode: FlatMode = {
    isFlat: isFlatNow,
    update,
    syncPointers,

    pointers(): PointerState[] {
      return snapshot;
    },

    resize(): void {
      // Re-solve now and follow the window tightly while it is being dragged.
      sinceRetarget = Number.POSITIVE_INFINITY;
      snapFrame = true;
    },

    resetView,

    setFocus(object: THREE.Object3D | null): void {
      focus = object;
      sinceRetarget = Number.POSITIVE_INFINITY;
    },

    coverage(): FlatCoverage {
      if (!hasTarget || frameBoxCount === 0) return { width: 0, height: 0, pixels: 0 };
      const span = spanAt(appliedDistance(), span2);
      const width = dom.clientWidth || 0;
      return { width: span.x, height: span.y, pixels: span.x * width };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      endGesture();
      releaseOverlay();
      offMode();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerCancel);
      dom.removeEventListener("pointerleave", onPointerLeave);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("dblclick", onDoubleClick);
      dom.style.cursor = "";
      queue.length = 0;
      roots.length = 0;
      frameRoots.length = 0;
      stack.length = 0;
      merged.length = 0;
      snapshot = [];
      frameBoxes.length = 0;
      stageBoxes.length = 0;
      frameBoxCount = 0;
      stageCount = 0;
      framedRoots.clear();
      contributing.clear();
      if (activeMode === mode) activeMode = null;
    },
  };

  activeMode = mode;
  return mode;
}
