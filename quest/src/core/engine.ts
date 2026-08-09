/**
 * The XR engine: renderer, session lifecycle, frame loop, recentring.
 *
 * Everything else in the app is handed `Engine` and nothing more, so the
 * renderer configuration, the passthrough handling and the frame budget all
 * live in one file that can be tuned for a new headset without touching the
 * game.
 *
 * A few decisions that are not obvious from the code:
 *
 *  - `world` is the only thing `recentre()` moves. Content authored around the
 *    origin of `world`, facing +Z, ends up in front of the player. Rays,
 *    hands and the camera stay in real-room space so they never inherit a
 *    recentre.
 *  - The camera is synced to the headset pose every frame. Three.js renders
 *    XR through its own internal camera and leaves the application camera
 *    where it was, which would leave head-tracked audio and any billboarding
 *    code pointing at the origin.
 *  - Frame callbacks are individually guarded. A thrown error in the board
 *    must not stop the render loop: a frozen headset is far worse than a
 *    broken feature.
 *  - Off-headset the engine is only half the story. `flatmode.ts` owns the
 *    camera, the look controls and the mouse pointer whenever `mode` is
 *    "none", and is inert the moment a session starts. It hangs off the engine
 *    as `flat` (see `FlatEngine`) rather than being wired up by `main.ts`, so
 *    a flat visitor gets a framed, playable app with no call site at all.
 */

import * as THREE from "three";
import type { Engine, PointerState, XrMode } from "../contracts.ts";
import { hex, onThemeChange, palette } from "../../shared/brand.ts";
import { createInput } from "./input.ts";
import { createFlatMode, type FlatMode } from "./flatmode.ts";

/** A hitch must not teleport an animation, so no frame is worth more than this. */
const MAX_DELTA = 0.1;
/** Quest 3 renders the periphery at reduced resolution; 0.6 is the usual sweet spot. */
const FOVEATION = 0.6;
/** Slight supersample. Small text in spatial panels is otherwise soft. */
const FRAMEBUFFER_SCALE = 1.1;
/** Metres in front of the player that recentred content sits. */
const RECENTRE_DISTANCE = 1.4;
/** Fallback when the runtime cannot give us a floor-relative space. */
const DEFAULT_EYE_HEIGHT = 1.6;
/** 90Hz is smooth and still leaves passthrough compositing enough GPU budget. */
const PREFERRED_FRAME_RATE = 90;

/**
 * Requested for both session types. None are required: a headset without
 * plane detection should still get a game, just without surface snapping.
 */
const XR_OPTIONAL_FEATURES = [
  "local-floor",
  "bounded-floor",
  "hand-tracking",
  "layers",
  "anchors",
  "plane-detection",
] as const;

function xrSessionMode(mode: "vr" | "ar"): XRSessionMode {
  return mode === "ar" ? "immersive-ar" : "immersive-vr";
}

/**
 * What `createEngine` actually returns.
 *
 * `Engine` in `src/contracts.ts` is the contract every other subsystem is
 * written against and is deliberately left alone — nothing in the app needs to
 * know the flat path exists. This adds the one member that does: the flat-mode
 * controller, for anything that wants to drive the desktop view directly.
 */
export interface FlatEngine extends Engine {
  /** Framing, look controls and the mouse pointer off-headset. Inert in XR. */
  readonly flat: FlatMode;
}

/** Whether this device can run the given session type. */
export async function isSessionSupported(mode: "vr" | "ar"): Promise<boolean> {
  const xr = navigator.xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported(xrSessionMode(mode));
  } catch {
    return false;
  }
}

export function createEngine(canvas: HTMLCanvasElement): FlatEngine {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    // Passthrough is composited behind whatever we draw, which only works if
    // the frame has an alpha channel to be transparent in.
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(hex(palette.ink), 1);

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  renderer.xr.setFoveation(FOVEATION);
  renderer.xr.setFramebufferScaleFactor(FRAMEBUFFER_SCALE);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hex(palette.ink));

  const world = new THREE.Group();
  world.name = "world";
  scene.add(world);

  // Near plane close enough for a hand held up to the face; far plane deep
  // enough for a panorama shell or the orbital deck's planet.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  camera.position.set(0, DEFAULT_EYE_HEIGHT, 0);

  const clock = new THREE.Clock();
  const input = createInput({ renderer, scene, camera, domElement: canvas });

  const frameCallbacks = new Set<(dt: number, now: number) => void>();
  const modeCallbacks = new Set<(mode: XrMode) => void>();

  let elapsed = 0;
  let requestedMode: "vr" | "ar" = "vr";
  let savedBackground: THREE.Scene["background"] = null;
  let pendingRecentre = false;
  /** Where y = 0 of `world` sits relative to the reference space origin. */
  let floorY = 0;
  let disposed = false;
  /** Created once the engine object exists; every use is guarded until then. */
  let flat: FlatMode | null = null;

  const headPosition = new THREE.Vector3();
  const headRotation = new THREE.Quaternion();
  const headScale = new THREE.Vector3();
  const facing = new THREE.Vector3();

  function emitMode(): void {
    for (const fn of modeCallbacks) {
      try {
        fn(engine.mode);
      } catch (error) {
        console.error("[engine] mode listener failed", error);
      }
    }
  }

  function resize(): void {
    if (renderer.xr.isPresenting) return;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Framing is solved against the aspect ratio, so a reshaped window is a
    // new framing problem, not just a new projection matrix.
    flat?.resize();
  }

  function syncCameraToHead(): void {
    if (!renderer.xr.isPresenting) return;
    const xrCamera = renderer.xr.getCamera();
    camera.matrix.copy(xrCamera.matrix);
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
  }

  function recentre(): void {
    if (!renderer.xr.isPresenting) {
      // Off-headset there is no head to recentre on, and the camera is flat
      // mode's to place. "Recentre" therefore means "put the content back where
      // it was authored and look at it straight on" — which is idempotent,
      // where anchoring to the camera would walk the world a further
      // RECENTRE_DISTANCE away on every press.
      world.position.set(0, floorY, -RECENTRE_DISTANCE);
      world.rotation.set(0, 0, 0);
      world.updateMatrixWorld(true);
      flat?.resetView();
      return;
    }

    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(headPosition, headRotation, headScale);

    facing.set(0, 0, -1).applyQuaternion(headRotation);
    if (facing.x * facing.x + facing.z * facing.z < 1e-6) {
      // Straight up or straight down carries no yaw in the gaze direction, but
      // the top of the head still points somewhere horizontal.
      const lookingDown = facing.y < 0;
      facing.set(0, 1, 0).applyQuaternion(headRotation);
      if (!lookingDown) facing.negate();
    }
    facing.y = 0;
    if (facing.lengthSq() < 1e-8) facing.set(0, 0, -1);
    facing.normalize();

    world.position.set(
      headPosition.x + facing.x * RECENTRE_DISTANCE,
      floorY,
      headPosition.z + facing.z * RECENTRE_DISTANCE,
    );
    // Yaw only, and the height is left on the floor plane. Tilting or lifting
    // the world under someone is the quickest way to make them ill.
    world.rotation.set(0, Math.atan2(-facing.x, -facing.z), 0);
    world.updateMatrixWorld(true);
  }

  function tuneFrameRate(session: XRSession): void {
    const rates = session.supportedFrameRates;
    if (!rates || rates.length === 0) return;
    let best = 0;
    for (const rate of rates) {
      if (rate <= PREFERRED_FRAME_RATE && rate > best) best = rate;
    }
    if (best <= 0) return;
    try {
      void session.updateTargetFrameRate(best).catch(() => {});
    } catch {
      // Older runtimes expose the list but not the setter.
    }
  }

  function onSessionStart(): void {
    const session = renderer.xr.getSession();
    engine.mode = requestedMode;

    if (requestedMode === "ar") {
      savedBackground = scene.background;
      scene.background = null;
      renderer.setClearAlpha(0);
    }

    // Both are stored by Three.js until a session exists, so re-apply them now
    // that the projection layer is real.
    renderer.xr.setFoveation(FOVEATION);
    if (session) tuneFrameRate(session);

    // The head pose only exists from the first XR frame onwards.
    pendingRecentre = true;
    emitMode();
  }

  function onSessionEnd(): void {
    if (engine.mode === "ar") {
      scene.background = savedBackground;
      savedBackground = null;
    }
    renderer.setClearColor(hex(palette.ink), 1);
    floorY = 0;
    engine.mode = "none";

    camera.position.set(0, DEFAULT_EYE_HEIGHT, 0);
    camera.quaternion.identity();
    resize();
    recentre();
    emitMode();
  }

  function frame(): void {
    const dt = Math.min(clock.getDelta(), MAX_DELTA);
    // Accumulating the clamped delta keeps `now` and `dt` telling the same
    // story; a hitch slows time down rather than skipping it.
    elapsed += dt;

    syncCameraToHead();

    // Flush transforms before anything picks. Three.js only refreshes world
    // matrices inside render(), which would leave every raycast this frame
    // testing against last frame's positions.
    scene.updateMatrixWorld();

    if (pendingRecentre && renderer.xr.isPresenting) {
      recentre();
      pendingRecentre = false;
    }

    // Flat mode reads the content it just flushed and places the camera. It
    // has to run before the camera's world matrix is taken, or every ray and
    // every billboard this frame would use last frame's viewpoint. Guarded for
    // the same reason frame callbacks are: a broken desktop camera must not
    // take the render loop down with it.
    if (flat) {
      try {
        flat.update(dt);
      } catch (error) {
        console.error("[engine] flat framing failed", error);
      }
    }
    camera.updateMatrixWorld();

    input.update(dt);
    if (flat) {
      try {
        flat.syncPointers(input.pointers());
      } catch (error) {
        console.error("[engine] flat pointer sync failed", error);
      }
    }

    for (const fn of frameCallbacks) {
      try {
        fn(dt, elapsed);
      } catch (error) {
        console.error("[engine] frame callback failed", error);
      }
    }

    renderer.render(scene, camera);
  }

  async function endSession(): Promise<void> {
    const active = renderer.xr.getSession();
    if (!active) return;
    try {
      await active.end();
    } catch {
      // Already ending, or ended between the check and the call.
    }
  }

  async function requestSession(mode: "vr" | "ar"): Promise<void> {
    if (disposed) throw new Error("Engine has been disposed.");
    const xr = navigator.xr;
    if (!xr) throw new Error("WebXR is not available on this device.");
    await endSession();

    const session = await xr.requestSession(xrSessionMode(mode), {
      optionalFeatures: [...XR_OPTIONAL_FEATURES],
    });

    requestedMode = mode;

    // `local-floor` is what puts the board at a believable table height. Quest
    // always grants it; a runtime that does not gets a nominal eye height so
    // content is still roughly where it belongs.
    const granted = session.enabledFeatures;
    const hasFloor = !granted || granted.includes("local-floor");
    renderer.xr.setReferenceSpaceType(hasFloor ? "local-floor" : "local");
    floorY = hasFloor ? 0 : -DEFAULT_EYE_HEIGHT;

    await renderer.xr.setSession(session);
  }

  const engine: Engine = {
    renderer,
    scene,
    camera,
    world,
    clock,
    mode: "none",

    onFrame(fn) {
      frameCallbacks.add(fn);
      return () => {
        frameCallbacks.delete(fn);
      };
    },

    pointers(): PointerState[] {
      // Flat mode substitutes its own mouse pointer for the one `input.ts`
      // synthesises; in a session it hands the snapshot straight back.
      return flat ? flat.pointers() : input.pointers();
    },

    haptic(pointerId, intensity, ms) {
      input.haptic(pointerId, intensity, ms);
    },

    requestSession,
    endSession,

    onModeChange(fn) {
      modeCallbacks.add(fn);
      return () => {
        modeCallbacks.delete(fn);
      };
    },

    recentre,

    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener("sessionstart", onSessionStart);
      renderer.xr.removeEventListener("sessionend", onSessionEnd);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
      unsubscribeTheme();
      frameCallbacks.clear();
      modeCallbacks.clear();
      void endSession();
      flat?.dispose();
      flat = null;
      input.dispose();
      renderer.dispose();
    },
  };

  /**
   * The clear colour and the scene background are *derived* from the palette —
   * a parsed hex and a THREE.Color — so a theme switch strands both on the old
   * ink. Everything else here reads `palette` live and needs nothing.
   */
  const unsubscribeTheme = onThemeChange(() => {
    const ink = hex(palette.ink);
    if (scene.background instanceof THREE.Color) scene.background.setHex(ink);
    if (savedBackground instanceof THREE.Color) savedBackground.setHex(ink);
    // Passthrough composites behind a transparent frame; keep it transparent.
    renderer.setClearColor(ink, engine.mode === "ar" ? 0 : 1);
  });

  renderer.xr.addEventListener("sessionstart", onSessionStart);
  renderer.xr.addEventListener("sessionend", onSessionEnd);

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
  resizeObserver?.observe(canvas);
  window.addEventListener("resize", resize);

  flat = createFlatMode(engine);
  // Same object, wider type: closures above keep working, callers get `flat`.
  const flatEngine: FlatEngine = Object.assign(engine, { flat });

  resize();
  recentre();
  renderer.setAnimationLoop(frame);

  return flatEngine;
}

/**
 * Enters XR without waiting for a tap, but only inside the installed Quest app.
 *
 * Meta's PWA packaging exposes the Digital Goods API to the packaged app and
 * to nothing else, which makes it the one reliable way to tell "launched from
 * the headset library" from "opened in a browser tab". In a tab an unprompted
 * session request is rejected for want of a user gesture, and the rejection
 * looks to the player like the app is broken — so it is never attempted.
 *
 * Resolves true if a session started.
 */
export async function maybeAutoEnterXR(engine: Engine, preferred: "vr" | "ar"): Promise<boolean> {
  if (typeof window === "undefined" || !("getDigitalGoodsService" in window)) return false;
  if (!navigator.xr) return false;

  const order: ("vr" | "ar")[] = preferred === "ar" ? ["ar", "vr"] : ["vr", "ar"];
  for (const mode of order) {
    if (!(await isSessionSupported(mode))) continue;
    try {
      await engine.requestSession(mode);
      return true;
    } catch {
      // Headset busy or the mode was refused; fall through to the other one.
    }
  }
  return false;
}
