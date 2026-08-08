/**
 * The environment controller.
 *
 * One job: own everything the player sees *around* the board — sky, room,
 * atmosphere, lighting — and swap between those worlds without ever showing a
 * seam. Three rules drive the design:
 *
 *   1. Never a hard cut and never a black frame. `apply()` keeps both worlds
 *      alive for 600 ms, cross-dissolves their materials and rides a tinted
 *      veil over the middle of the transition so the swap lands under cover.
 *   2. Never leak. Every environment owns its geometry, materials and textures
 *      through `SceneAssets` and frees all of it the moment it retires. Ten
 *      demos in a row must cost the same VRAM as one.
 *   3. One source of truth for colour. Lighting, fog and the veil are derived
 *      from the active `EnvironmentSpec`, and `currentTint()` publishes the
 *      result so the board and the spatial UI can match the room.
 *
 * The controller also owns the board's grounding rig — a baked blob shadow and
 * (in rooms with a floor) a wider light pool. There are no realtime shadows
 * anywhere in this product; a Quest 3 cannot afford them at 72 fps.
 */

import * as THREE from "three";
import type { Engine, EnvironmentController } from "../contracts.ts";
import {
  DEFAULT_ENVIRONMENT_ID,
  getEnvironment,
  type EnvironmentSpec,
} from "../../shared/environments.ts";
import { hex, palette } from "../../shared/brand.ts";
import { SceneAssets, createProceduralScene, defaultLighting } from "./procedural.ts";
import { createPanoramaScene } from "./panorama.ts";
import { createPassthroughScene } from "./passthrough.ts";

// ── Scene contract ──────────────────────────────────────────────────────────

/**
 * Everything a scene module needs to build itself. Handed in by the controller;
 * the objects on it are live and must not be mutated by the scene.
 */
export interface SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly spec: EnvironmentSpec;
  /** `spec.tint`, pre-parsed. Copy it before mutating. */
  readonly tint: THREE.Color;
  /** Board centre in world space. Live — the controller updates it in place. */
  readonly anchor: THREE.Vector3;
  /** Radius of the board's footprint in metres. */
  readonly anchorRadius: number;
}

/**
 * How a scene wants the room lit. Intensities are multiplied by the spec's
 * `ambient` / `key`, so the catalogue stays in charge of exposure while the
 * scene stays in charge of direction and colour.
 */
export interface SceneLighting {
  /** Direction the key light arrives *from*, world space. */
  keyDirection: THREE.Vector3;
  keyColor: THREE.Color;
  keyScale: number;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  ambientScale: number;
  fogColor: THREE.Color;
  fogDensity: number;
  /** `null` means passthrough: transparent clear, real room visible. */
  background: THREE.Color | null;
  shadowColor: THREE.Color;
  shadowStrength: number;
  /** Wider light pool on the floor beneath the board. 0 in floorless rooms. */
  poolStrength: number;
}

/** One built world. Created by `procedural.ts`, `panorama.ts`, `passthrough.ts`. */
export interface EnvScene {
  readonly root: THREE.Group;
  readonly lighting: SceneLighting;
  update(dt: number, time: number): void;
  /** 0 = fully faded out, 1 = fully present. */
  setOpacity(k: number): void;
  /** Called when the board moves, so grounding details follow it. */
  setAnchor?(centre: THREE.Vector3, radius: number): void;
  dispose(): void;
}

/** Why the controller had to substitute a different environment. */
export type FallbackReason = "load-failed" | "unsupported";

/**
 * The controller as `main.ts` sees it. A superset of the `EnvironmentController`
 * contract — the extra members are additive, so it is still a drop-in.
 */
export interface EnvironmentSystem extends EnvironmentController {
  /** Live scene tint, cross-faded during a swap. Copy before mutating. */
  currentTint(): THREE.Color;
  /** Tells the grounding rig where the board sits. */
  setBoardAnchor(centre: THREE.Vector3, radius?: number): void;
  /** Fires when a requested environment could not be shown. Returns an unsubscribe. */
  onFallback(fn: (requested: EnvironmentSpec, used: EnvironmentSpec, reason: FallbackReason) => void): () => void;
}

// ── Tuning ──────────────────────────────────────────────────────────────────

/** Cross-fade length. Long enough to read as a dissolve, short enough to feel instant. */
const FADE_SEC = 0.6;
/** Peak opacity of the veil. Deliberately short of 1 — a dip to solid reads as a cut. */
const VEIL_PEAK = 0.82;
/** How long a panorama may load before we commit to showing its loading state. */
const PANORAMA_GRACE_MS = 420;

const DEFAULT_ANCHOR_RADIUS = 0.92;

// ── Small maths helpers (allocation-free) ───────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves with the promise's value, or `"pending"` if it is still in flight. */
async function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | "pending"> {
  return Promise.race([p, delay(ms).then(() => "pending" as const)]);
}

// ── Implementation ──────────────────────────────────────────────────────────

interface Layer {
  spec: EnvironmentSpec;
  scene: EnvScene;
}

class Environment implements EnvironmentSystem {
  private readonly engine: Engine;
  private readonly rig: SceneAssets;

  private readonly hemi: THREE.HemisphereLight;
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;

  private readonly veil: THREE.Mesh;
  private readonly veilMaterial: THREE.MeshBasicMaterial;
  private readonly veilOffset = new THREE.Matrix4();

  private readonly contactShadow: THREE.Mesh;
  private readonly floorPool: THREE.Mesh;
  private readonly shadowUniforms: Record<string, THREE.IUniform>;
  private readonly poolUniforms: Record<string, THREE.IUniform>;

  private readonly anchor = new THREE.Vector3(0, 0, 0);
  private anchorRadius = DEFAULT_ANCHOR_RADIUS;

  private readonly tintScratch = new THREE.Color();
  private readonly veilScratch = new THREE.Color();
  private readonly bgColor = new THREE.Color();

  private active: Layer | null = null;
  private outgoing: Layer | null = null;

  /** Working lighting state, lerped every frame during a transition. */
  private readonly live: SceneLighting;
  private readonly tint = new THREE.Color(hex(palette.accent));

  private exposureAmbient = 1;
  private exposureKey = 1;

  private fadeT = 1;
  private fading = false;
  private swapped = true;
  private fadeDone: (() => void) | null = null;

  private elapsed = 0;
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  private readonly fallbackListeners = new Set<
    (requested: EnvironmentSpec, used: EnvironmentSpec, reason: FallbackReason) => void
  >();

  /** Renderer/scene state we borrowed and must hand back on dispose. */
  private readonly restore: {
    background: THREE.Scene["background"];
    fog: THREE.Scene["fog"];
    clearAlpha: number;
    clearColor: THREE.Color;
  };

  constructor(engine: Engine) {
    this.engine = engine;

    const clearColor = new THREE.Color();
    engine.renderer.getClearColor(clearColor);
    this.restore = {
      background: engine.scene.background,
      fog: engine.scene.fog,
      clearAlpha: engine.renderer.getClearAlpha(),
      clearColor,
    };

    this.live = defaultLighting(getEnvironment(DEFAULT_ENVIRONMENT_ID), this.tint);

    // Fog stays assigned for the lifetime of the controller — toggling
    // `scene.fog` between null and a value recompiles every material in the
    // scene, which is a visible hitch on a headset. Passthrough simply runs at
    // density 0.
    this.fog = new THREE.FogExp2(this.live.fogColor.getHex(), 0);
    engine.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    // Targets live in the same space as the lights so a recentre rotates the
    // key direction with the room rather than shearing it.
    engine.world.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target);

    // ── Grounding rig: one blob shadow, plus a light pool in floored rooms.
    this.rig = new SceneAssets();
    this.rig.root.name = "env-grounding";
    engine.world.add(this.rig.root);

    const shadow = this.makeGroundQuad(1.7, 0.55);
    this.contactShadow = shadow.mesh;
    this.shadowUniforms = shadow.uniforms;
    this.contactShadow.renderOrder = 2;

    const pool = this.makeGroundQuad(1.1, 0.0);
    this.floorPool = pool.mesh;
    this.poolUniforms = pool.uniforms;
    this.floorPool.renderOrder = 1;
    (this.floorPool.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;

    this.rig.add(this.floorPool);
    this.rig.add(this.contactShadow);
    this.layoutRig();

    // ── Veil: a quad pinned to the eye, drawn last, used only during swaps.
    this.veilMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex(palette.ink)),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.veilMaterial);
    this.veil.name = "env-veil";
    this.veil.frustumCulled = false;
    this.veil.matrixAutoUpdate = false;
    this.veil.matrixWorldAutoUpdate = false;
    this.veil.renderOrder = 100000;
    this.veil.visible = false;
    // Outside whatever near plane the engine chose, and wide enough that no
    // head rotation can uncover an edge.
    const veilDistance = Math.max(0.25, engine.camera.near * 4);
    this.veilOffset.makeTranslation(0, 0, -veilDistance);
    this.veilOffset.scale(new THREE.Vector3(veilDistance * 18, veilDistance * 18, 1));
    this.veil.onBeforeRender = (_r, _s, cam) => {
      this.veil.matrixWorld.multiplyMatrices(cam.matrixWorld, this.veilOffset);
    };
    engine.scene.add(this.veil);

    this.pushLighting();
  }

  // ── Grounding rig ─────────────────────────────────────────────────────────

  /**
   * A horizontal quad with a soft elliptical falloff. Plain alpha blending, so
   * it darkens a virtual floor *and* reads as a shadow over camera passthrough
   * (where multiply blending would composite to nothing).
   */
  private makeGroundQuad(
    falloff: number,
    core: number,
  ): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
    const uniforms: Record<string, THREE.IUniform> = {
      uColor: { value: new THREE.Color(hex(palette.ink)) },
      uStrength: { value: 0 },
      uOpacity: { value: 1 },
      uFalloff: { value: falloff },
      uCore: { value: core },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        uniform float uOpacity;
        uniform float uFalloff;
        uniform float uCore;
        varying vec2 vUv;
        void main() {
          float d = length((vUv - 0.5) * 2.0);
          float a = 1.0 - smoothstep(0.0, 1.0, d);
          a = pow(a, uFalloff);
          a += pow(max(1.0 - d * 1.9, 0.0), 3.0) * uCore;
          gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uStrength * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(this.rig.geom(new THREE.PlaneGeometry(1, 1)), this.rig.mat(material, false));
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    return { mesh, uniforms };
  }

  private layoutRig(): void {
    const r = this.anchorRadius;
    this.contactShadow.position.set(this.anchor.x, this.anchor.y + 0.004, this.anchor.z);
    this.contactShadow.scale.set(r * 3.1, 1, r * 3.1);
    // The wider pool lives on the floor, directly beneath the board.
    this.floorPool.position.set(this.anchor.x, 0.006, this.anchor.z);
    this.floorPool.scale.set(r * 9.0, 1, r * 9.0);
  }

  setBoardAnchor(centre: THREE.Vector3, radius = this.anchorRadius): void {
    this.anchor.copy(centre);
    this.anchorRadius = Math.max(0.15, radius);
    this.layoutRig();
    this.active?.scene.setAnchor?.(this.anchor, this.anchorRadius);
    this.outgoing?.scene.setAnchor?.(this.anchor, this.anchorRadius);
  }

  // ── Lighting ──────────────────────────────────────────────────────────────

  /** Copies `live` onto the actual lights, fog and clear state. */
  private pushLighting(): void {
    this.hemi.color.copy(this.live.skyColor);
    this.hemi.groundColor.copy(this.live.groundColor);
    this.hemi.intensity = this.exposureAmbient * this.live.ambientScale;

    this.key.color.copy(this.live.keyColor);
    this.key.intensity = this.exposureKey * this.live.keyScale;
    this.key.position.copy(this.live.keyDirection).multiplyScalar(12);

    this.fill.color.copy(this.live.skyColor);
    this.fill.intensity = this.exposureKey * this.live.keyScale * 0.22;
    this.fill.position.set(-this.live.keyDirection.x, 0.35, -this.live.keyDirection.z).multiplyScalar(10);

    this.fog.color.copy(this.live.fogColor);
    this.fog.density = this.live.fogDensity;

    this.shadowUniforms.uColor.value = this.live.shadowColor;
    this.shadowUniforms.uStrength.value = this.live.shadowStrength;
    this.poolUniforms.uColor.value = this.live.skyColor;
    this.poolUniforms.uStrength.value = this.live.shadowStrength * this.live.poolStrength * 0.2;
    this.floorPool.visible = this.live.poolStrength > 0.002;
  }

  /** Exposure comes from the catalogue entry and cross-fades with the room. */
  private setExposure(ambient: number, key: number): void {
    this.exposureAmbient = ambient;
    this.exposureKey = key;
  }

  /** Hard-swaps background and clear alpha. Only ever called under the veil. */
  private pushBackground(lighting: SceneLighting): void {
    const { renderer, scene } = this.engine;
    if (lighting.background === null) {
      // Mixed reality: nothing of ours behind the real room.
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
    } else {
      this.bgColor.copy(lighting.background);
      scene.background = this.bgColor;
      renderer.setClearColor(this.bgColor, 1);
      renderer.setClearAlpha(1);
    }
  }

  private lerpLighting(a: SceneLighting, b: SceneLighting, k: number): void {
    const l = this.live;
    l.keyDirection.lerpVectors(a.keyDirection, b.keyDirection, k);
    l.keyColor.lerpColors(a.keyColor, b.keyColor, k);
    l.skyColor.lerpColors(a.skyColor, b.skyColor, k);
    l.groundColor.lerpColors(a.groundColor, b.groundColor, k);
    l.fogColor.lerpColors(a.fogColor, b.fogColor, k);
    l.shadowColor.lerpColors(a.shadowColor, b.shadowColor, k);
    l.keyScale = a.keyScale + (b.keyScale - a.keyScale) * k;
    l.ambientScale = a.ambientScale + (b.ambientScale - a.ambientScale) * k;
    l.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * k;
    l.shadowStrength = a.shadowStrength + (b.shadowStrength - a.shadowStrength) * k;
    l.poolStrength = a.poolStrength + (b.poolStrength - a.poolStrength) * k;
    l.background = k < 0.5 ? a.background : b.background;
  }

  private copyLighting(from: SceneLighting): void {
    this.lerpLighting(from, from, 1);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  current(): EnvironmentSpec | null {
    return this.active?.spec ?? null;
  }

  currentTint(): THREE.Color {
    return this.tint;
  }

  onFallback(
    fn: (requested: EnvironmentSpec, used: EnvironmentSpec, reason: FallbackReason) => void,
  ): () => void {
    this.fallbackListeners.add(fn);
    return () => this.fallbackListeners.delete(fn);
  }

  apply(spec: EnvironmentSpec): Promise<void> {
    const run = this.chain.then(() => this.swap(spec));
    // Keep the chain alive even if one swap rejects, so the next one still runs.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  update(dt: number, _now: number): void {
    if (this.disposed) return;

    // Be forgiving about the caller's unit convention and about resume spikes.
    let step = dt > 1 ? dt * 0.001 : dt;
    if (!(step > 0)) step = 1 / 72;
    if (step > 0.1) step = 0.1;
    this.elapsed += step;

    if (this.fading) this.stepFade(step);

    this.outgoing?.scene.update(step, this.elapsed);
    this.active?.scene.update(step, this.elapsed);

    // Between transitions the active scene stays in charge of the light. A
    // panorama that finishes downloading after its cross-fade has ended grades
    // the room off its own photograph, and this is what picks that up.
    if (!this.fading && this.active) {
      this.copyLighting(this.active.scene.lighting);
      this.setExposure(this.active.spec.ambient, this.active.spec.key);
      this.pushLighting();
      this.pushBackground(this.active.scene.lighting);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;

    this.retire(this.outgoing);
    this.outgoing = null;
    this.retire(this.active);
    this.active = null;

    this.engine.world.remove(this.hemi, this.key, this.key.target, this.fill, this.fill.target);
    this.hemi.dispose();
    this.key.dispose();
    this.fill.dispose();

    this.engine.scene.remove(this.veil);
    this.veil.geometry.dispose();
    this.veilMaterial.dispose();

    this.rig.dispose();

    const { renderer, scene } = this.engine;
    scene.background = this.restore.background;
    scene.fog = this.restore.fog;
    renderer.setClearColor(this.restore.clearColor, this.restore.clearAlpha);

    this.fallbackListeners.clear();
    if (activeSystem === this) activeSystem = null;

    // Anything the transition was still awaiting resolves now.
    this.fadeDone?.();
    this.fadeDone = null;
    this.fading = false;
  }

  // ── Transition ────────────────────────────────────────────────────────────

  private async swap(spec: EnvironmentSpec): Promise<void> {
    if (this.disposed) return;
    // Identity, not id: a re-issued catalogue entry is a no-op, but a freshly
    // built spec (a custom 360 that was just re-uploaded) always rebuilds.
    if (this.active && this.active.spec === spec && !this.fading) return;

    const gen = ++this.generation;
    const layer = await this.build(spec, gen);
    if (this.disposed || gen !== this.generation) {
      layer.scene.dispose();
      return;
    }
    this.begin(layer);
    await new Promise<void>((resolve) => {
      this.fadeDone = resolve;
      // Safety net: if the host forgets to pump `update()`, never hang a
      // caller. Guarded by generation so it cannot cut a later fade short.
      setTimeout(() => {
        if (gen === this.generation) this.finish();
      }, FADE_SEC * 1000 + 400);
    });
  }

  private contextFor(spec: EnvironmentSpec): SceneContext {
    return {
      renderer: this.engine.renderer,
      camera: this.engine.camera,
      spec,
      tint: new THREE.Color(hex(spec.tint)),
      anchor: this.anchor,
      anchorRadius: this.anchorRadius,
    };
  }

  private notifyFallback(requested: EnvironmentSpec, used: EnvironmentSpec, reason: FallbackReason): void {
    for (const fn of this.fallbackListeners) {
      try {
        fn(requested, used, reason);
      } catch {
        /* a listener must never break the swap */
      }
    }
  }

  private buildDefault(): Layer {
    const spec = getEnvironment(DEFAULT_ENVIRONMENT_ID);
    return { spec, scene: createProceduralScene(this.contextFor(spec)) };
  }

  private async build(spec: EnvironmentSpec, gen: number): Promise<Layer> {
    if (spec.kind === "passthrough") {
      return { spec, scene: createPassthroughScene(this.contextFor(spec)) };
    }

    if (spec.kind === "panorama") {
      const scene = createPanoramaScene(this.contextFor(spec));
      const settled = await settleWithin(scene.ready, PANORAMA_GRACE_MS);
      if (settled === false) {
        // Never show a customer a black void: fall back before we even fade.
        scene.dispose();
        const fallback = this.buildDefault();
        this.notifyFallback(spec, fallback.spec, "load-failed");
        return fallback;
      }
      if (settled === "pending") {
        // Still loading. Fade to its loading state now and self-heal later.
        void scene.ready.then((ok) => {
          if (ok || this.disposed || gen !== this.generation) return;
          const fallback = getEnvironment(DEFAULT_ENVIRONMENT_ID);
          this.notifyFallback(spec, fallback, "load-failed");
          void this.apply(fallback);
        });
      }
      return { spec, scene };
    }

    return { spec, scene: createProceduralScene(this.contextFor(spec)) };
  }

  private begin(layer: Layer): void {
    // A swap arriving mid-fade: land the one in flight instantly, under cover.
    if (this.fading) this.finish();

    this.outgoing = this.active;
    this.active = layer;

    layer.scene.setAnchor?.(this.anchor, this.anchorRadius);
    layer.scene.setOpacity(0);
    this.engine.world.add(layer.scene.root);

    const first = !this.outgoing;
    if (first) {
      // Nothing to dissolve from. Commit the room's light and clear colour up
      // front and ease only the geometry in — a veil over an empty scene would
      // read as a flash, which is the one thing a first impression cannot do.
      this.copyLighting(layer.scene.lighting);
      this.setExposure(layer.spec.ambient, layer.spec.key);
      this.pushBackground(layer.scene.lighting);
      this.pushLighting();
      this.tint.set(hex(layer.spec.tint));
    }

    this.fadeT = 0;
    this.fading = true;
    this.swapped = first;
    this.veil.visible = !first;
  }

  private stepFade(dt: number): void {
    const from = this.outgoing;
    const to = this.active;
    if (!to) {
      this.fading = false;
      return;
    }

    this.fadeT = clamp01(this.fadeT + dt / FADE_SEC);
    const t = this.fadeT;

    // Old world leaves first, new world arrives second, veil covers the middle.
    const out = 1 - smoothstep(0.08, 0.5, t);
    const inn = smoothstep(0.48, 0.94, t);
    from?.scene.setOpacity(out);
    to.scene.setOpacity(inn);

    const k = smoothstep(0.18, 0.82, t);

    if (from) {
      // The live tint carries the board and the spatial UI across the swap.
      this.tint.set(hex(from.spec.tint)).lerp(this.tintOf(to.spec), k);

      // Veil: deep brand ink carrying a trace of the room. Peaks short of
      // solid, so the dissolve stays visible under it and no frame goes black.
      // Blended in sRGB — a linear blend with a saturated tint turns the whole
      // transition into a colour flash rather than a dip.
      this.veilMaterial.opacity = Math.pow(Math.sin(Math.PI * t), 1.25) * VEIL_PEAK;
      this.veilMaterial.color
        .set(hex(palette.ink))
        .convertLinearToSRGB()
        .lerp(this.veilScratch.copy(this.tint).convertLinearToSRGB(), 0.14)
        .convertSRGBToLinear();

      this.lerpLighting(from.scene.lighting, to.scene.lighting, k);
      this.setExposure(
        from.spec.ambient + (to.spec.ambient - from.spec.ambient) * k,
        from.spec.key + (to.spec.key - from.spec.key) * k,
      );
    } else {
      this.copyLighting(to.scene.lighting);
      this.setExposure(to.spec.ambient, to.spec.key);
    }
    this.pushLighting();

    if (!this.swapped && t >= 0.5) {
      this.swapped = true;
      this.pushBackground(to.scene.lighting);
    }

    if (t >= 1) this.finish();
  }

  private tintOf(spec: EnvironmentSpec): THREE.Color {
    return this.tintScratch.set(hex(spec.tint));
  }

  private finish(): void {
    if (!this.fading && !this.fadeDone) return;
    this.fading = false;
    this.fadeT = 1;

    const to = this.active;
    if (to) {
      to.scene.setOpacity(1);
      this.copyLighting(to.scene.lighting);
      this.setExposure(to.spec.ambient, to.spec.key);
      this.tint.set(hex(to.spec.tint));
      if (!this.swapped) {
        this.swapped = true;
        this.pushBackground(to.scene.lighting);
      }
      this.pushLighting();
    }

    this.retire(this.outgoing);
    this.outgoing = null;

    this.veil.visible = false;
    this.veilMaterial.opacity = 0;

    const done = this.fadeDone;
    this.fadeDone = null;
    done?.();
  }

  private retire(layer: Layer | null): void {
    if (!layer) return;
    this.engine.world.remove(layer.scene.root);
    layer.scene.dispose();
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/** The controller most recently created, so `currentTint()` has something to read. */
let activeSystem: Environment | null = null;

const FALLBACK_TINT = new THREE.Color(hex(palette.accent));

/**
 * Builds the environment system for an engine. One per session.
 *
 * The returned object satisfies `EnvironmentController` exactly and adds
 * `currentTint()`, `setBoardAnchor()` and `onFallback()` on top.
 */
export function createEnvironment(engine: Engine): EnvironmentSystem {
  const system = new Environment(engine);
  activeSystem = system;
  return system;
}

/**
 * The live scene tint, for the board rim light and the spatial UI glow.
 *
 * Returns a shared, continuously updated `THREE.Color` — read it or copy it,
 * never mutate it. Before the first `apply()` it reports the brand accent.
 */
export function currentTint(): THREE.Color {
  return activeSystem ? activeSystem.currentTint() : FALLBACK_TINT;
}
