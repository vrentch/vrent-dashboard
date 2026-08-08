/**
 * Pointer input: Quest controllers, hand tracking, and a flat-screen fallback.
 *
 * Everything upstream sees the same `PointerState`, so the board and the UI
 * never branch on whether the player is holding a controller, pinching, or
 * clicking a mouse on the marketing site.
 *
 * Two behaviours are worth knowing about:
 *
 *  - The snapshot is computed once per frame and handed to every consumer, so
 *    a press is seen by exactly one frame's worth of logic no matter how many
 *    subsystems ask for it.
 *  - The visible ray is deliberately not a laser. It is a tapered cone that
 *    fades out before it reaches the surface, with a soft tip resting just
 *    short of the hit. A hard-edged beam reads as a sight, which invites
 *    people to aim rather than point, and aiming in VR is tiring.
 */

import * as THREE from "three";
import type { PointerState } from "../contracts.ts";
import { hex, palette, rgba } from "../../shared/brand.ts";
import { pickScene, rayFromNdc, rayFromObject } from "./raycast.ts";

type TargetRaySpace = ReturnType<THREE.WebXRManager["getController"]>;
type HandSpace = ReturnType<THREE.WebXRManager["getHand"]>;

/** WebXR Gamepads Module; `hapticActuators` is absent on hands and on desktop. */
type MaybeHaptic = { readonly hapticActuators?: readonly GamepadHapticActuator[] };

export interface InputOptions {
  renderer: THREE.WebGLRenderer;
  /** Rays are parented here, not under `world` — they live in real space. */
  scene: THREE.Scene;
  /** Used for the flat-screen fallback ray. */
  camera: THREE.Camera;
  /** Receives mouse and touch events. Normally the WebGL canvas. */
  domElement: HTMLElement;
}

export interface InputSystem {
  /** Rebuilds this frame's snapshot. The engine calls it before any consumer. */
  update(dt: number): void;
  /** Stable for the whole frame; the array and its entries are reused. */
  pointers(): PointerState[];
  /** Short rumble. Silently ignored for hands and for the mouse. */
  haptic(pointerId: number, intensity: number, ms: number): void;
  dispose(): void;
}

// Ray geometry, in metres.
const BASE_RADIUS = 0.0042;
const TIP_RADIUS = 0.0011;
const IDLE_LENGTH = 1.25;
const MIN_LENGTH = 0.12;
const MAX_LENGTH = 3;
/** The tip sits just short of the surface so it cannot z-fight with it. */
const TIP_INSET = 0.006;

// Finger separation, in metres, over which a pinch reads as "about to select".
const PINCH_OPEN = 0.05;
const PINCH_CLOSED = 0.018;

const RAY_OPACITY_IDLE = 0.4;
const RAY_OPACITY_HOVER = 0.62;
const RAY_OPACITY_HELD = 0.92;

/** Exponential smoothing that behaves the same at 72Hz and 90Hz. */
function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// ── Ray visual ──────────────────────────────────────────────────────────────

interface RayAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  tipTexture: THREE.CanvasTexture;
  tipMaterial: THREE.SpriteMaterial;
}

function createRayAssets(): RayAssets {
  const geometry = new THREE.CylinderGeometry(TIP_RADIUS, BASE_RADIUS, 1, 8, 14, true);
  // Cylinders are built along +Y; every XR target ray points down -Z.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -0.5);

  const position = geometry.attributes.position;
  const accent = new THREE.Color(hex(palette.accent));
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(-position.getZ(i), 0, 1);
    // Fade in off the controller so the ray does not appear to pierce the hand,
    // and fade to nothing well before the tip so there is no hard end.
    const root = THREE.MathUtils.smoothstep(t, 0, 0.09);
    const taper = Math.pow(1 - t, 1.7);
    colors[i * 4 + 0] = accent.r;
    colors[i * 4 + 1] = accent.g;
    colors[i * 4 + 2] = accent.b;
    colors[i * 4 + 3] = root * taper;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The accent is a brand colour; tone mapping would shift it.
    toneMapped: false,
  });

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, rgba(palette.accent, 0.85));
    gradient.addColorStop(0.4, rgba(palette.accent, 0.28));
    gradient.addColorStop(1, rgba(palette.accent, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const tipTexture = new THREE.CanvasTexture(canvas);
  tipTexture.colorSpace = THREE.SRGBColorSpace;

  const tipMaterial = new THREE.SpriteMaterial({
    map: tipTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  return { geometry, material, tipTexture, tipMaterial };
}

interface RayVisual {
  group: THREE.Group;
  setState(length: number, opacity: number): void;
  dispose(): void;
}

function createRayVisual(assets: RayAssets): RayVisual {
  const group = new THREE.Group();
  group.name = "pointer-ray";

  const beamMaterial = assets.material.clone();
  const beam = new THREE.Mesh(assets.geometry, beamMaterial);
  beam.frustumCulled = false;
  group.add(beam);

  const tipMaterial = assets.tipMaterial.clone();
  const tip = new THREE.Sprite(tipMaterial);
  tip.scale.setScalar(0.019);
  group.add(tip);

  return {
    group,
    setState(length, opacity) {
      beam.scale.z = length;
      beamMaterial.opacity = opacity;
      tip.position.z = -Math.max(0, length - TIP_INSET);
      tipMaterial.opacity = opacity * 0.8;
    },
    dispose() {
      beamMaterial.dispose();
      tipMaterial.dispose();
    },
  };
}

// ── Pointer slots ───────────────────────────────────────────────────────────

interface Slot {
  state: PointerState;
  down: boolean;
  queuedDown: number;
  queuedUp: number;
}

interface XrSlot extends Slot {
  space: TargetRaySpace;
  hand: HandSpace;
  source: XRInputSource | null;
  visual: RayVisual;
  length: number;
  opacity: number;
  detach: () => void;
}

interface MouseSlot extends Slot {
  ndc: THREE.Vector2;
  /** False until the user has actually moved or tapped — a still page has no pointer. */
  active: boolean;
}

function newState(id: number): PointerState {
  return {
    id,
    ray: new THREE.Ray(),
    pressed: false,
    held: false,
    released: false,
    isHand: false,
  };
}

/** Promotes queued XR/DOM events into this frame's edge flags. */
function applyEdges(slot: Slot): void {
  slot.state.pressed = slot.queuedDown > 0;
  slot.state.released = slot.queuedUp > 0;
  if (slot.queuedDown > 0) slot.down = true;
  // A tap that opened and closed inside one frame still reports both edges,
  // and ends released — the press must not leak into the next frame.
  if (slot.queuedUp > 0) slot.down = false;
  slot.queuedDown = 0;
  slot.queuedUp = 0;
  slot.state.held = slot.down;
}

function clearSlot(slot: Slot): void {
  slot.down = false;
  slot.queuedDown = 0;
  slot.queuedUp = 0;
  slot.state.pressed = false;
  slot.state.held = false;
  slot.state.released = false;
}

/** 0 when the fingers are open, 1 at the pinch threshold. */
function pinchAmount(hand: HandSpace): number {
  const index = hand.joints["index-finger-tip"];
  const thumb = hand.joints["thumb-tip"];
  if (!index || !thumb || !index.visible || !thumb.visible) return 0;
  const distance = index.position.distanceTo(thumb.position);
  return THREE.MathUtils.clamp(
    (PINCH_OPEN - distance) / (PINCH_OPEN - PINCH_CLOSED),
    0,
    1,
  );
}

export function createInput(options: InputOptions): InputSystem {
  const { renderer, scene, camera, domElement } = options;
  const assets = createRayAssets();
  const snapshot: PointerState[] = [];

  const xrSlots: XrSlot[] = [0, 1].map((index) => {
    const space = renderer.xr.getController(index);
    const visual = createRayVisual(assets);
    visual.group.visible = false;
    space.add(visual.group);
    // The ray belongs to the room, not to the recentred content, so it hangs
    // off the scene rather than off `world`.
    scene.add(space);

    const slot: XrSlot = {
      state: newState(index),
      down: false,
      queuedDown: 0,
      queuedUp: 0,
      space,
      // Requesting the hand space makes Three.js track joints for this slot,
      // which is what gives us pinch distance.
      hand: renderer.xr.getHand(index),
      source: null,
      visual,
      length: IDLE_LENGTH,
      opacity: RAY_OPACITY_IDLE,
      detach: () => {},
    };

    const onConnected = (event: { data: XRInputSource }) => {
      slot.source = event.data;
      slot.state.isHand = event.data.hand != null;
      clearSlot(slot);
    };
    const onDisconnected = () => {
      slot.source = null;
      clearSlot(slot);
    };
    const onSelectStart = () => {
      slot.queuedDown++;
    };
    const onSelectEnd = () => {
      slot.queuedUp++;
    };

    space.addEventListener("connected", onConnected);
    space.addEventListener("disconnected", onDisconnected);
    space.addEventListener("selectstart", onSelectStart);
    space.addEventListener("selectend", onSelectEnd);
    slot.detach = () => {
      space.removeEventListener("connected", onConnected);
      space.removeEventListener("disconnected", onDisconnected);
      space.removeEventListener("selectstart", onSelectStart);
      space.removeEventListener("selectend", onSelectEnd);
    };

    return slot;
  });

  const mouse: MouseSlot = {
    state: newState(-1),
    down: false,
    queuedDown: 0,
    queuedUp: 0,
    ndc: new THREE.Vector2(),
    active: false,
  };

  function trackMouse(event: PointerEvent): void {
    const rect = domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    mouse.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    mouse.active = true;
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.isPrimary) trackMouse(event);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    trackMouse(event);
    mouse.queuedDown++;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    mouse.queuedUp++;
    // A finger that has lifted is no longer hovering anything; a mouse still is.
    if (event.pointerType !== "mouse") mouse.active = false;
  };
  const onPointerLeave = () => {
    mouse.active = false;
  };

  domElement.addEventListener("pointermove", onPointerMove, { passive: true });
  domElement.addEventListener("pointerdown", onPointerDown);
  domElement.addEventListener("pointerup", onPointerUp);
  domElement.addEventListener("pointercancel", onPointerUp);
  domElement.addEventListener("pointerleave", onPointerLeave);

  function updateRayVisual(slot: XrSlot, dt: number, live: boolean): void {
    slot.visual.group.visible = live;
    if (!live) {
      // Reset so a controller waking up fades in from rest rather than
      // snapping back to whatever it was pointing at when it dropped out.
      slot.length = IDLE_LENGTH;
      slot.opacity = RAY_OPACITY_IDLE;
      return;
    }

    const hit = pickScene(slot.state.ray, { far: MAX_LENGTH });
    const targetLength = hit
      ? THREE.MathUtils.clamp(hit.distance, MIN_LENGTH, MAX_LENGTH)
      : IDLE_LENGTH;

    let targetOpacity = hit ? RAY_OPACITY_HOVER : RAY_OPACITY_IDLE;
    if (slot.state.held) targetOpacity = RAY_OPACITY_HELD;
    else if (slot.state.isHand) {
      // Hands get no rumble, so closing the fingers has to show somewhere.
      targetOpacity += (RAY_OPACITY_HELD - targetOpacity) * pinchAmount(slot.hand);
    }

    slot.length = approach(slot.length, targetLength, 18, dt);
    slot.opacity = approach(slot.opacity, targetOpacity, 14, dt);
    slot.visual.setState(slot.length, slot.opacity);
  }

  return {
    update(dt) {
      snapshot.length = 0;
      const presenting = renderer.xr.isPresenting;

      for (const slot of xrSlots) {
        const live = presenting && slot.source !== null && slot.space.visible;
        if (live) {
          applyEdges(slot);
          rayFromObject(slot.space, slot.state.ray);
          snapshot.push(slot.state);
        } else {
          // Drop a half-finished press rather than firing it on reconnect.
          clearSlot(slot);
        }
        updateRayVisual(slot, dt, live);
      }

      if (presenting) {
        mouse.active = false;
        clearSlot(mouse);
      } else if (mouse.active) {
        applyEdges(mouse);
        rayFromNdc(camera, mouse.ndc.x, mouse.ndc.y, mouse.state.ray);
        snapshot.push(mouse.state);
      } else {
        clearSlot(mouse);
      }
    },

    pointers() {
      return snapshot;
    },

    haptic(pointerId, intensity, ms) {
      const slot = xrSlots[pointerId];
      const gamepad = slot?.source?.gamepad as (Gamepad & MaybeHaptic) | undefined;
      const actuator = gamepad?.hapticActuators?.[0];
      if (!actuator) return;
      try {
        void actuator
          .pulse(THREE.MathUtils.clamp(intensity, 0, 1), Math.max(1, ms))
          .catch(() => {});
      } catch {
        // Some runtimes expose the actuator but reject the call; a missing
        // rumble is never worth breaking a frame over.
      }
    },

    dispose() {
      domElement.removeEventListener("pointermove", onPointerMove);
      domElement.removeEventListener("pointerdown", onPointerDown);
      domElement.removeEventListener("pointerup", onPointerUp);
      domElement.removeEventListener("pointercancel", onPointerUp);
      domElement.removeEventListener("pointerleave", onPointerLeave);

      for (const slot of xrSlots) {
        slot.detach();
        slot.space.remove(slot.visual.group);
        slot.visual.dispose();
        scene.remove(slot.space);
      }

      assets.geometry.dispose();
      assets.material.dispose();
      assets.tipMaterial.dispose();
      assets.tipTexture.dispose();
      snapshot.length = 0;
    },
  };
}
