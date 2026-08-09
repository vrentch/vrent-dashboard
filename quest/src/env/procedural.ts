/**
 * The five procedural rooms — and the small toolkit every scene module shares.
 *
 * Everything here is geometry plus GLSL: no textures ship with the app, so an
 * environment costs a few kilobytes of code instead of forty megabytes of
 * download, and a re-skin is a colour change rather than a re-shoot.
 *
 * The performance contract for a Quest 3 at 72 fps:
 *   • single-digit draw calls per room — repeated geometry is instanced,
 *     detail lives in the shader rather than in vertices;
 *   • no realtime shadows anywhere (the controller bakes a blob shadow);
 *   • no allocation in `update()` — every frame touches uniforms only;
 *   • anything animated per-instance animates in the vertex shader, so the CPU
 *     never walks a matrix array.
 *
 * Scenes are art-directed, not generated: placements come from hand-written
 * tables or from a golden-angle sequence, never from `Math.random()`, so the
 * room looks the same every time a client sees it.
 *
 * This module is also the lowest layer of the environment package, so the
 * shared `SceneAssets` bookkeeping and the shared GLSL live here; `panorama.ts`
 * and `passthrough.ts` build on them without importing the controller at
 * runtime.
 */

import * as THREE from "three";
import type { EnvScene, SceneContext, SceneLighting } from "./controller.ts";
import type { EnvironmentSpec } from "../../shared/environments.ts";
import {
  hex,
  luminance,
  mix,
  onThemeChange,
  palette,
  seatColors,
  text as brandText,
} from "../../shared/brand.ts";
import { mulberry32 } from "../../shared/game.ts";

// ── Brand colours, live ─────────────────────────────────────────────────────
//
// Parsed once into objects that are then **mutated in place** on a theme
// change, exactly as `brand.ts` does with the palette itself. Every scene
// derives its uniforms from these through a recipe registered on its
// `SceneAssets`, so a swap of theme re-derives colour without rebuilding a
// single GPU resource.
//
// The three neutrals below carry one extra step: they are the neutrals of the
// room *currently being derived*, not of the theme. See `applyRoomGrade`.

const INK = new THREE.Color();
const SURFACE = new THREE.Color();
const SURFACE_ALT = new THREE.Color();
const PRIMARY = new THREE.Color();
const ACCENT = new THREE.Color();
const REWARD = new THREE.Color();
const VIOLET = new THREE.Color();
const MINT = new THREE.Color();
const ICE = new THREE.Color();

/**
 * A cool near-white, in *either* theme.
 *
 * `text.primary` cannot serve here: it is near-black on a light palette, so
 * every "paper" surface derived from it would come out inverted — a white
 * research lab would render as a black one.
 */
const PAPER = new THREE.Color();

/**
 * Pure white — `text.onPrimary`, the one palette entry that means the same
 * thing in both themes. The far end of every lighting ramp.
 */
export const WHITE = new THREE.Color();

/**
 * The palette's darkest neutral, in either theme. The direction "away from the
 * light": used to deepen an emitter that has no headroom left above it, and by
 * anything that must stay dark whichever way the UI goes — the shadow the board
 * casts on a real table, for one.
 */
export const DEEP = new THREE.Color();

/**
 * 0 for a dark room, 1 for a light one — the room **currently being derived**,
 * which is not the same thing as the theme. See `themeAdoption`.
 *
 * Read off the palette's own void colour rather than off the theme's *name*,
 * so a customer re-skin that is neither of the two shipped themes still lands
 * the right way round. Everything in this file that has to behave differently
 * in a bright room leans on this one number; there are no theme-id branches.
 */
let roomLightness = 0;

/** The theme's own lightness, before any room declines part of it. */
let themeLightness = 0;

/** The adoption the grade currently installed in this module was built from. */
let gradeAdoption = 1;

/** `DEEP` as a `#RRGGBB` string, for the hex-string helpers in `brand.ts`. */
let deepHex = "#000000";

/**
 * @see roomLightness
 *
 * Meaningful only inside a `SceneAssets` derivation, which is where a
 * particular room's grade is installed. Anything holding a catalogue entry
 * rather than being *inside* its room asks `roomLightFor(spec)` instead.
 */
export function roomLight(): number {
  return roomLightness;
}

/** @see themeLightness */
export function themeLight(): number {
  return themeLightness;
}

// ── Per-room theme adoption ─────────────────────────────────────────────────

/**
 * The catalogue `ambient` either side of which a room reads as authored dark or
 * authored bright. Neon Vault sits at 0.35 and Quantum Lab at 1.25, so the
 * crossover lands between them and nearer the dark end: a room has to be
 * genuinely bright before a light UI is allowed to open it up.
 */
const ADOPT_DARK = 0.35;
const ADOPT_BRIGHT = 0.95;

/**
 * How much of a light theme a room is willing to take, 0-1.
 *
 * The theme is a UI decision; the catalogue is a promise. "A dark vault ribbed
 * with reactive light" is the string the picker puts next to the room and the
 * string the sales page prints, so the vault has to *be* a dark vault under
 * either UI — and a room built out of near-white neutrals renders as a white
 * tunnel however carefully it is lit. Each catalogue entry already states its
 * intent in `ambient`, so that is what decides it: rooms authored bright take
 * the whole of a light theme, rooms authored dark decline it, and the ones in
 * between ramp.
 *
 * Read off that number rather than off the room's id, so a client's own
 * uploaded 360 lands somewhere sensible with nobody maintaining a list.
 */
export function themeAdoption(spec: EnvironmentSpec): number {
  return smooth01(ADOPT_DARK, ADOPT_BRIGHT, spec.ambient);
}

/** The lightness a given room actually renders at under the active theme. */
export function roomLightFor(spec: EnvironmentSpec): number {
  return themeLightness * themeAdoption(spec);
}

/** A theme neutral pulled back towards the palette's dark end by `hold`, 0-1. */
function heldNeutral(neutral: string, hold: number): string {
  return hold > 0.002 ? mix(neutral, deepHex, hold) : neutral;
}

/**
 * A room's void colour under the active theme, as `#RRGGBB`.
 *
 * For anything that has to sit *behind* the room rather than in it — the
 * controller's cross-fade veil, which would otherwise flash the UI's near-white
 * `ink` between two rooms that both stay dark.
 */
export function roomInk(spec: EnvironmentSpec): string {
  return heldNeutral(palette.ink, themeLightness - roomLightFor(spec));
}

/**
 * Installs the grade for a room that takes `adoption` of the theme's lightness.
 *
 * The neutrals are the whole of it. On a pale palette `ink` and `surface` are
 * both near-white, so a vault built from them comes out white whatever the
 * lights are doing. A room that declines the theme's lightness gets those same
 * neutrals pulled back to the palette's dark end instead, and every recipe
 * downstream — `roomLightness` included — follows from there.
 *
 * Module-level state rather than a parameter threaded through fifty recipes,
 * and safe because there is exactly one place it is read from: `SceneAssets`
 * installs a room's grade immediately before running that room's derivations.
 */
function applyRoomGrade(adoption: number): void {
  gradeAdoption = adoption;
  roomLightness = themeLightness * adoption;
  const hold = themeLightness - roomLightness;
  INK.setHex(hex(heldNeutral(palette.ink, hold)));
  SURFACE.setHex(hex(heldNeutral(palette.surface, hold)));
  SURFACE_ALT.setHex(hex(heldNeutral(palette.surfaceAlt, hold)));
}

/**
 * `a` blended `k` of the way towards `b`, written into `out`.
 *
 * Mixed in sRGB rather than in the linear working space, because every use of
 * this is art direction: "an ink surface with a tenth of the room tint in it"
 * should look like a tenth. A linear blend with a saturated accent lands two to
 * three times stronger than the number reads, and five rooms tinted that way
 * all come out as one loud colour.
 *
 * `out` may alias either input — the operands are staged through scratch.
 */
export function mixInto(
  out: THREE.Color,
  a: THREE.Color,
  b: THREE.Color,
  k: number,
): THREE.Color {
  MIX_A.copy(a).convertLinearToSRGB();
  MIX_B.copy(b).convertLinearToSRGB();
  return out.copy(MIX_A.lerp(MIX_B, k)).convertSRGBToLinear();
}

const MIX_A = new THREE.Color();
const MIX_B = new THREE.Color();

/** `mixInto` into a fresh colour. */
export function mixColor(a: THREE.Color, b: THREE.Color, k: number): THREE.Color {
  return mixInto(new THREE.Color(), a, b, k);
}

/**
 * The colour a light fitting takes at its core, `k` of the way from its tint
 * to full intensity.
 *
 * In a dark room an emitter burns out towards white. A pale room has no
 * headroom above the wall behind it, so the same fitting has to read by going
 * *deeper* instead — chroma rather than brightness. Which way to travel is
 * decided by `roomLightness`, so this is one rule rather than two branches.
 */
export function coreInto(out: THREE.Color, tint: THREE.Color, k: number): THREE.Color {
  mixInto(out, tint, WHITE, k * (1 - roomLightness));
  return mixInto(out, out, DEEP, k * roomLightness * 0.45);
}

// ── Live rendering scalars ──────────────────────────────────────────────────
//
// Three uniforms shared by every shader that draws a room. Each is a single
// object handed to every material, so one write re-grades with no traversal,
// no allocation and no shader recompile.
//
// Exposure is the operator's, and therefore global. The other two describe how
// light behaves in *this* room and live on its `SceneAssets`, because the two
// rooms alive during a cross-fade need not agree about it — dissolving a white
// research floor into a dark vault has to grade each of them its own way.

/** Operator brightness. Multiplies every scene fragment before tone mapping. */
const uRoomExposure: THREE.IUniform = { value: 1 };

// ── Surround tuning ─────────────────────────────────────────────────────────

/**
 * The operator's live controls over the surround. Persisting these is the
 * caller's business; everything here applies them the moment they change, with
 * no rebuild and no reload.
 */
export interface EnvironmentTuning {
  /** Overall room brightness. 1 is the room exactly as art-directed. */
  brightness: number;
  /**
   * Overrides the catalogue tint for every environment — the hook for a
   * customer who wants every room in their own colour. `null` leaves each
   * environment on its own tint.
   */
  tint: string | null;
  /** How much of that tint the room takes. 0 is a neutral grey room, 1 is as
   *  art-directed, above 1 pushes the chroma. */
  tintStrength: number;
}

export const TUNING_LIMITS = {
  brightness: { min: 0.35, max: 2, step: 0.05 },
  tintStrength: { min: 0, max: 1.6, step: 0.05 },
} as const;

/** The room exactly as art-directed. Hand this back to `setEnvironmentTuning`
 *  for a "reset" control. */
export const DEFAULT_TUNING: Readonly<EnvironmentTuning> = {
  brightness: 1,
  tint: null,
  tintStrength: 1,
};

const tuning: EnvironmentTuning = { ...DEFAULT_TUNING };

type TuningListener = (tuning: Readonly<EnvironmentTuning>) => void;
const tuningListeners = new Set<TuningListener>();

const HEX6 = /^#[0-9a-f]{6}$/i;

function clamp(v: number, lo: number, hi: number): number {
  return !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v;
}

/** The operator's current surround tuning. Read-only — patch it with `setEnvironmentTuning`. */
export function getEnvironmentTuning(): Readonly<EnvironmentTuning> {
  return tuning;
}

/**
 * Applies a partial tuning patch live. Unknown or out-of-range values are
 * clamped rather than rejected, so a slider dragged to its stop is never an
 * error. Returns the tuning actually in force.
 */
export function setEnvironmentTuning(patch: Partial<EnvironmentTuning>): Readonly<EnvironmentTuning> {
  if (patch.brightness !== undefined) {
    tuning.brightness = clamp(
      patch.brightness,
      TUNING_LIMITS.brightness.min,
      TUNING_LIMITS.brightness.max,
    );
  }
  if (patch.tint !== undefined) {
    tuning.tint = patch.tint !== null && HEX6.test(patch.tint) ? patch.tint : null;
  }
  if (patch.tintStrength !== undefined) {
    tuning.tintStrength = clamp(
      patch.tintStrength,
      TUNING_LIMITS.tintStrength.min,
      TUNING_LIMITS.tintStrength.max,
    );
  }

  uRoomExposure.value = tuning.brightness;
  // Listeners first: the controller re-resolves each live room's tint colour
  // in place, and the derivations below then read it.
  for (const fn of tuningListeners) {
    try {
      fn(tuning);
    } catch (err) {
      console.error("[env] tuning listener failed", err);
    }
  }
  refreshSceneDerivations();
  return tuning;
}

/**
 * The operator's brightness, for the handful of things `uRoomExposure` cannot
 * reach: three's own lit materials (whose *emissive* term is not lit by
 * anything) and unlit line materials. Read it inside a `themed` recipe — those
 * re-run on a tuning change, so the value stays current.
 */
export function roomExposure(): number {
  return tuning.brightness;
}

/** Subscribe to tuning changes. Returns an unsubscribe function. */
export function onEnvironmentTuningChange(fn: TuningListener): () => void {
  tuningListeners.add(fn);
  return () => tuningListeners.delete(fn);
}

const TINT_SCRATCH = new THREE.Color();
const HSL_SCRATCH = { h: 0, s: 0, l: 0 };

/**
 * The tint a room should actually use, as `#RRGGBB`.
 *
 * Three things fold in: the operator's override if there is one, their chroma
 * setting, and the room's own value. The catalogue tints were picked against a
 * dark room; on a pale one the same hex is too light to read against the walls,
 * so it is deepened towards the palette's darkest neutral in proportion to how
 * bright *that room* has become. A room that declines a light theme keeps its
 * neon at full strength, which is the point of it.
 */
export function resolveTint(spec: EnvironmentSpec): string {
  let base = tuning.tint ?? spec.tint;
  if (tuning.tintStrength !== 1) {
    TINT_SCRATCH.setHex(hex(base)).getHSL(HSL_SCRATCH, THREE.SRGBColorSpace);
    TINT_SCRATCH.setHSL(
      HSL_SCRATCH.h,
      clamp(HSL_SCRATCH.s * tuning.tintStrength, 0, 1),
      HSL_SCRATCH.l,
      THREE.SRGBColorSpace,
    );
    base = `#${TINT_SCRATCH.getHexString(THREE.SRGBColorSpace)}`;
  }
  const light = roomLightFor(spec);
  return light > 0 ? mix(base, deepHex, 0.34 * light) : base;
}

// ── Palette refresh ─────────────────────────────────────────────────────────

/** `smoothstep`, on the CPU. */
function smooth01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function refreshPalette(): void {
  PRIMARY.setHex(hex(palette.primary));
  ACCENT.setHex(hex(palette.accent));
  REWARD.setHex(hex(palette.reward));
  WHITE.setHex(hex(brandText.onPrimary));
  VIOLET.setHex(hex(seatColors[3]));
  MINT.setHex(hex(seatColors[5]));
  ICE.setHex(hex(seatColors[7]));

  PAPER.setHex(hex(mix(brandText.onPrimary, palette.primary, 0.08)));
  deepHex =
    luminance(palette.ink) <= luminance(brandText.primary) ? palette.ink : brandText.primary;
  DEEP.setHex(hex(deepHex));

  themeLightness = smooth01(0.1, 0.45, luminance(palette.ink));
  // The three neutrals are room state, not theme state: re-install whichever
  // grade is in force so they pick up the new palette. Every live scene
  // re-installs its own a moment later, in `refreshSceneDerivations`.
  applyRoomGrade(gradeAdoption);
}

refreshPalette();

/**
 * Re-runs every derivation registered by every live scene.
 *
 * Called on a theme change, and by the controller when the operator moves a
 * surround-tuning slider. Nothing here allocates a GPU resource: uniforms and
 * material colours are written in place, so a hundred switches cost the same
 * VRAM as none.
 */
export function refreshSceneDerivations(): void {
  for (const assets of liveScenes) assets.rederive();
}

// A single module-level subscription rather than one per scene, so the palette
// is always refreshed before any scene reads it. `SceneAssets` joins and
// leaves `liveScenes` in its constructor and `dispose()`, which is that
// object's unsubscribe.
onThemeChange(() => {
  refreshPalette();
  refreshSceneDerivations();
});

// ── Shared scene bookkeeping ────────────────────────────────────────────────

interface FadeEntry {
  material: THREE.Material;
  base: number;
  uniform: THREE.IUniform | null;
}

/** Every scene currently built, so a theme change can find their derivations. */
const liveScenes = new Set<SceneAssets>();

/**
 * Owns every GPU resource a scene allocates, drives the cross-fade opacity and
 * frees the lot in one call. Nothing in an environment may create a geometry,
 * material or texture without handing it to one of these.
 *
 * It is also where a scene registers everything it *derives* from the palette —
 * a mixed colour, a parsed hex, a baked vertex attribute. Those recipes are
 * re-run in place whenever the theme or the operator's tuning changes, which is
 * what keeps a room correct across a switch without rebuilding it.
 *
 * Each one carries its room's grade with it (`themeAdoption`), installed around
 * every derivation it runs. Two rooms are alive at once through a cross-fade
 * and they need not agree: a white research floor dissolving into a dark vault
 * grades each end of the dissolve the way that room was authored.
 */
export class SceneAssets {
  readonly root = new THREE.Group();

  /**
   * Gain on additive light drawn *inside* a lit surface — a cove bleeding onto
   * a wall, a reflection in a floor. On a pale surface an add has almost
   * nowhere to go, and pushing it anyway erases the shading underneath, so a
   * light room pulls it back and lets chroma carry the effect instead.
   */
  readonly roomGlow: THREE.IUniform = { value: 1 };
  /** Gain on optional glitter — stars, motes, signage bokeh. Fades out entirely
   *  in a bright room, where a daylit sky simply has no stars in it. */
  readonly roomSpark: THREE.IUniform = { value: 1 };

  /** How much of the theme's lightness this room takes. @see themeAdoption */
  private readonly adoption: number;

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly fading: FadeEntry[] = [];
  private readonly derivations: (() => void)[] = [];
  private disposed = false;

  /**
   * `spec` is the catalogue entry the room is being built from. Omitting it —
   * the grounding rig, anything not a catalogue room — means "follow the theme
   * as it is", which is what everything did before rooms could decline it.
   */
  constructor(spec?: EnvironmentSpec) {
    this.adoption = spec ? themeAdoption(spec) : 1;
    // Before anything the caller does: a scene reads the neutrals the moment it
    // asks for its lighting rig, which is a line or two above its first recipe.
    this.grade();
    liveScenes.add(this);
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  /**
   * Installs this room's grade on the module, so everything derived under it
   * reads the neutrals and the `roomLightness` this room actually renders at
   * rather than the theme's raw ones.
   */
  private grade(): void {
    applyRoomGrade(this.adoption);
    this.roomGlow.value = 1 - 0.62 * roomLightness;
    this.roomSpark.value = 1 - 0.93 * roomLightness;
  }

  /**
   * Registers work that derives from the live palette. Runs `fn` now, and
   * again on every theme or tuning change. `fn` must write in place — it is
   * called with GPU resources already built and pointing at its output.
   */
  themed(fn: () => void): void {
    this.derivations.push(fn);
    this.grade();
    fn();
  }

  /** A colour uniform derived from the live palette. */
  uColor(recipe: (out: THREE.Color) => void): THREE.IUniform {
    const value = new THREE.Color();
    this.themed(() => recipe(value));
    return { value };
  }

  /** A scalar uniform derived from the live palette. */
  uScalar(recipe: () => number): THREE.IUniform {
    const uniform: THREE.IUniform = { value: 0 };
    this.themed(() => {
      uniform.value = recipe();
    });
    return uniform;
  }

  /** Re-runs every registered derivation, under this room's grade. */
  rederive(): void {
    if (this.disposed) return;
    this.grade();
    for (let i = 0; i < this.derivations.length; i++) this.derivations[i]();
  }

  // ── GPU resources ─────────────────────────────────────────────────────────

  geom<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  tex<T extends THREE.Texture>(texture: T): T {
    this.textures.add(texture);
    return texture;
  }

  /**
   * Registers a material. `fade` materials stay permanently `transparent` —
   * flipping that flag at runtime silently keeps the old `OPAQUE` shader (or
   * forces a recompile hitch), so the fade would simply never happen.
   */
  mat<T extends THREE.Material>(material: T, fade = true): T {
    this.materials.add(material);
    if (material.side === THREE.DoubleSide) {
      // Otherwise three draws every transparent double-sided mesh twice, with
      // a `needsUpdate` between the passes. That is a real cost on a headset.
      material.forceSinglePass = true;
    }
    if (fade) {
      material.transparent = true;
      const uniforms = (material as unknown as THREE.ShaderMaterial).uniforms;
      this.fading.push({
        material,
        base: material.opacity,
        uniform: uniforms && uniforms.uOpacity ? uniforms.uOpacity : null,
      });
    }
    return material;
  }

  add<T extends THREE.Object3D>(object: T): T {
    this.root.add(object);
    return object;
  }

  setOpacity(k: number): void {
    this.root.visible = k > 0.002;
    for (let i = 0; i < this.fading.length; i++) {
      const entry = this.fading[i];
      if (entry.uniform) entry.uniform.value = k;
      else entry.material.opacity = entry.base * k;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Leaving `liveScenes` is this object's unsubscribe: a retired room is
    // never re-derived, and holds nothing alive past its own disposal.
    liveScenes.delete(this);
    this.derivations.length = 0;

    // Sweep the graph as well as the ledger — nothing escapes.
    this.root.traverse((object) => {
      const withGeometry = object as Partial<THREE.Mesh>;
      if (withGeometry.geometry) this.geometries.add(withGeometry.geometry);
      const material = (object as Partial<THREE.Mesh>).material;
      if (Array.isArray(material)) for (const m of material) this.materials.add(m);
      else if (material) this.materials.add(material);
      const instanced = object as Partial<THREE.InstancedMesh>;
      if (instanced.isInstancedMesh) instanced.dispose?.();
    });

    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();

    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.fading.length = 0;
    this.root.clear();
    this.root.removeFromParent();
  }
}

// ── Shared GLSL ─────────────────────────────────────────────────────────────

/** Hash/noise/fbm. Kept to three or four octaves — this runs on a mobile GPU. */
export const GLSL_NOISE = /* glsl */ `
float vHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(vHash13(i), vHash13(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(vHash13(i + vec3(0.0, 1.0, 0.0)), vHash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(vHash13(i + vec3(0.0, 0.0, 1.0)), vHash13(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(vHash13(i + vec3(0.0, 1.0, 1.0)), vHash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
float vNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vHash12(i), vHash12(i + vec2(1.0, 0.0)), f.x),
             mix(vHash12(i + vec2(0.0, 1.0)), vHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vFbm3(vec3 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 2; i++) { s += a * vNoise3(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s / 0.825;
}
float vFbm2(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) { s += a * vNoise2(p); p = p * 2.03 + 17.3; a *= 0.5; }
  return s / 0.9625;
}
/**
 * Gaussian falloff, width 1/k. Written as a multiply rather than as
 * pow(x, 2.0): GLSL leaves pow() undefined for a negative base, and every
 * signed distance in these shaders goes negative on one side. Some drivers
 * return NaN there, which silently erases the whole fragment.
 */
float gauss(float x, float k) {
  float t = x * k;
  return exp(-t * t);
}
vec3 depthFade(vec3 col, vec3 world, vec3 fogColor, float density) {
  float d = length(world - cameraPosition) * density;
  return mix(col, fogColor, clamp(1.0 - exp(-d * d), 0.0, 1.0));
}
mat3 spinMatrix(vec3 axis, float a) {
  float s = sin(a);
  float c = cos(a);
  float t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c,          t * axis.x * axis.y - s * axis.z, t * axis.x * axis.z + s * axis.y,
    t * axis.x * axis.y + s * axis.z, t * axis.y * axis.y + c,          t * axis.y * axis.z - s * axis.x,
    t * axis.x * axis.z - s * axis.y, t * axis.y * axis.z + s * axis.x, t * axis.z * axis.z + c
  );
}
`;

/** Tone mapping + output colour space. Custom shaders must do this themselves. */
export const GLSL_OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** World position + UV, for anything that shades from where it sits in the room. */
const VERT_WORLD = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Direction from the centre of a sky dome, for gradient backdrops. */
const VERT_DOME = /* glsl */ `
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface ShaderOptions {
  blending?: THREE.Blending;
  side?: THREE.Side;
  depthWrite?: boolean;
  depthTest?: boolean;
  /**
   * Marks the material as light rather than surface, which decides how it
   * survives a bright room:
   *
   *   "emit"  — a fitting the room can see: a light strip, a shaft, an aurora.
   *             Additive in a dark room. Additive light cannot make a mark on
   *             a pale wall, so in a light room it flips to normal blending and
   *             the (now deep, saturated) colour recipes carry it instead.
   *   "spark" — optional glitter: stars, motes, signage bokeh. Stays additive
   *             and fades out as the room brightens, because a daylit sky has
   *             no stars in it.
   *
   * Both are set here rather than by the caller passing `AdditiveBlending`, so
   * the decision is recorded and can be revisited on a theme change.
   */
  light?: "emit" | "spark";
}

/** Where three's own tone-mapping chunk lands in a fragment shader. */
const OUTPUT_ANCHOR = "#include <tonemapping_fragment>";

/**
 * Injects the shared grading uniforms and applies exposure just before tone
 * mapping — the one physically correct place for it.
 *
 * Done here rather than inside `GLSL_OUTPUT` so that a shader written without
 * `makeShader` (the panorama loading card) keeps compiling untouched.
 *
 * `uRoom*` is a reserved prefix: a scene shader must not declare a uniform by
 * any of these names. Redeclaring one is a compile error that a desktop
 * preview will not necessarily surface — `panorama.ts` already has a uniform
 * called `uExposure` of its own, which is exactly why these are namespaced.
 */
function graded(fragmentShader: string, spark: boolean): string {
  const grade = spark
    ? "gl_FragColor.rgb *= uRoomExposure * uRoomSpark;"
    : "gl_FragColor.rgb *= uRoomExposure;";
  return `uniform float uRoomExposure, uRoomGlow, uRoomSpark;\n${fragmentShader.replace(
    OUTPUT_ANCHOR,
    `${grade}\n  ${OUTPUT_ANCHOR}`,
  )}`;
}

/** A fade-aware `ShaderMaterial`. Every scene material goes through here. */
export function makeShader(
  assets: SceneAssets,
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
  options: ShaderOptions = {},
): THREE.ShaderMaterial {
  const light = options.light;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uRoomExposure,
      uRoomGlow: assets.roomGlow,
      uRoomSpark: assets.roomSpark,
      ...uniforms,
    },
    vertexShader,
    fragmentShader: graded(fragmentShader, light === "spark"),
    transparent: true,
    depthWrite: options.depthWrite ?? true,
    depthTest: options.depthTest ?? true,
    side: options.side ?? THREE.FrontSide,
    blending: light ? THREE.AdditiveBlending : options.blending ?? THREE.NormalBlending,
    fog: false,
  });
  if (light === "emit") {
    // Blending is renderer state, not shader code — three does not put it in
    // the program cache key for a transparent material, so flipping it costs
    // nothing and cannot cause a recompile hitch on the headset.
    assets.themed(() => {
      material.blending = roomLightness > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
    });
  }
  return assets.mat(material);
}

/**
 * Attaches a per-instance float attribute. A `Float32Array` is adopted rather
 * than copied, so a caller that has to refill it on a theme change can keep
 * writing into the same buffer instead of allocating a new one.
 */
function instanceAttr(
  geometry: THREE.BufferGeometry,
  name: string,
  values: Float32Array | readonly number[],
  itemSize = 1,
): THREE.InstancedBufferAttribute {
  const array = values instanceof Float32Array ? values : new Float32Array(values);
  const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
  geometry.setAttribute(name, attribute);
  return attribute;
}

/**
 * Clamps a backdrop distance to the engine's far plane.
 *
 * A sky dome or a planet placed beyond `camera.far` is clipped away entirely,
 * which is precisely the black void this product must never show. Every scene
 * sizes its distant geometry through here, so the composition survives whatever
 * near/far the engine picks.
 */
export function fitDistance(camera: THREE.PerspectiveCamera, desired: number): number {
  const limit = Math.max(12, (camera.far || desired) * 0.85);
  return Math.min(desired, limit);
}

/** Points on a sphere, evenly spread by the golden angle. Deterministic. */
function goldenSphere(index: number, count: number, target: THREE.Vector3): THREE.Vector3 {
  const y = 1 - ((index + 0.5) / count) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * 2.399963229728653;
  return target.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
}

// ── Lighting defaults ───────────────────────────────────────────────────────

/**
 * A sane room lighting rig derived from the catalogue entry, written into an
 * existing `SceneLighting`.
 *
 * In place, and colour by colour, because a scene hands `lighting.fogColor`
 * straight to a uniform: replacing the object on a theme change would strand
 * the shader on the old colour. A `null` background is left null — that is
 * passthrough's signal to the controller and is never a colour.
 */
export function applyDefaultLighting(
  out: SceneLighting,
  spec: EnvironmentSpec,
  tint: THREE.Color,
): SceneLighting {
  out.keyDirection.set(0.42, 0.8, 0.44).normalize();
  mixInto(out.keyColor, WHITE, tint, 0.2);
  out.keyScale = 1;
  mixInto(out.skyColor, tint, WHITE, 0.32);
  mixInto(out.groundColor, INK, tint, 0.2);
  out.ambientScale = 1;
  mixInto(out.fogColor, INK, tint, 0.1);
  out.fogDensity = spec.floor ? 0.05 : 0.012;
  if (out.background) mixInto(out.background, INK, tint, 0.06);
  // A shadow is the absence of light, so it runs to the palette's darkest
  // neutral and never to `ink` — which on a light palette is nearly white, and
  // would leave the board hovering over a pale smudge. How *heavy* it is on a
  // given theme is the controller's business, via `scene.shadowAlpha`.
  mixInto(out.shadowColor, DEEP, tint, 0.14);
  out.shadowStrength = 0.55;
  out.poolStrength = spec.floor ? 1 : 0;
  return out;
}

/**
 * A fresh lighting rig from the catalogue entry. Scenes start here and override
 * only what their art direction needs, so `ambient`, `key` and `tint` in
 * `environments.ts` always mean something.
 */
export function defaultLighting(spec: EnvironmentSpec, tint: THREE.Color): SceneLighting {
  return applyDefaultLighting(
    {
      keyDirection: new THREE.Vector3(),
      keyColor: new THREE.Color(),
      keyScale: 1,
      skyColor: new THREE.Color(),
      groundColor: new THREE.Color(),
      ambientScale: 1,
      fogColor: new THREE.Color(),
      fogDensity: 0,
      background: new THREE.Color(),
      shadowColor: new THREE.Color(),
      shadowStrength: 0.55,
      poolStrength: 0,
    },
    spec,
    tint,
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Builds the procedural room named by `spec.preset`. */
export function createProceduralScene(ctx: SceneContext): EnvScene {
  switch (ctx.spec.preset) {
    case "orbital-deck":
      return orbitalDeck(ctx);
    case "quantum-lab":
      return quantumLab(ctx);
    case "cyber-atrium":
      return cyberAtrium(ctx);
    case "aurora-void":
      return auroraVoid(ctx);
    case "neon-vault":
    default:
      return neonVault(ctx);
  }
}

/** The background colour of a scene that has one (i.e. is not passthrough). */
function bg(lighting: SceneLighting): THREE.Color {
  if (!lighting.background) lighting.background = new THREE.Color();
  return lighting.background;
}

/** Shared plumbing: one uniform holding the scene clock, plus the fade hooks. */
function scene(
  assets: SceneAssets,
  lighting: SceneLighting,
  time: THREE.IUniform,
  tick?: (dt: number, t: number) => void,
): EnvScene {
  return {
    root: assets.root,
    lighting,
    update(dt, t) {
      time.value = t;
      tick?.(dt, t);
    },
    setOpacity(k) {
      assets.setOpacity(k);
    },
    dispose() {
      assets.dispose();
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Neon Vault — a dark ribbed barrel vault lit from the springing line.
// ════════════════════════════════════════════════════════════════════════════

const VAULT_RADIUS = 3.4;
const VAULT_SPRING = 1.25;
const VAULT_LENGTH = 26;
const VAULT_BAYS = 13;

function neonVault(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets(ctx.spec);
  assets.root.name = "env-neon-vault";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  const fogColor = lighting.fogColor;
  assets.themed(() => {
    applyDefaultLighting(lighting, ctx.spec, tint);
    lighting.keyDirection.set(0.28, 0.9, 0.34).normalize();
    mixInto(lighting.keyColor, WHITE, tint, 0.35);
    mixInto(lighting.skyColor, tint, WHITE, 0.15);
    mixInto(lighting.groundColor, INK, tint, 0.3);
    // Fog and background are all but the same colour, so the open ends of the
    // vault dissolve into the room instead of reading as two lit portals. On a
    // light palette that same rule turns them into aerial haze.
    mixInto(lighting.fogColor, INK, tint, 0.055);
    lighting.fogDensity = 0.115;
    mixInto(bg(lighting), INK, tint, 0.045);
    lighting.shadowStrength = 0.62;
  });
  const stripY = VAULT_SPRING + 0.05;
  const stripX = VAULT_RADIUS - 0.22;
  /** The apex line. Looking down the vault this is the strongest read. */
  const crownY = VAULT_SPRING + VAULT_RADIUS - 0.16;

  // ── Shell: one cylinder, all the ribbing in the fragment shader.
  const shellGeo = assets.geom(
    new THREE.CylinderGeometry(VAULT_RADIUS, VAULT_RADIUS, VAULT_LENGTH, 48, 1, true),
  );
  const shell = new THREE.Mesh(
    shellGeo,
    makeShader(
      assets,
      {
        uBase: assets.uColor((c) => mixInto(c, SURFACE, INK, 0.55)),
        uTint: { value: tint },
        uFog: { value: fogColor },
        uFogDensity: { value: lighting.fogDensity },
        uTime,
        uBays: { value: VAULT_BAYS },
        uStripY: { value: stripY },
        uStripX: { value: stripX },
        uCrownY: { value: crownY },
        uRadius: { value: VAULT_RADIUS },
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uFog;
      uniform float uFogDensity, uTime, uBays, uStripY, uStripX, uCrownY, uRadius, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        // Ribbed relief: a smooth barrel per bay, plus a crisp rib line.
        float bay = vUv.y * uBays;
        float phase = fract(bay);
        float w = phase * 6.2831853;
        float relief = 0.5 - 0.5 * cos(w);
        float slope = sin(w);
        float aw = fwidth(bay) * 1.6 + 0.006;
        float ribLine = 1.0 - smoothstep(0.0, aw + 0.02, min(phase, 1.0 - phase));

        float shade = 0.34 + 0.56 * relief + 0.22 * slope;
        shade *= mix(1.0, 0.34, ribLine);
        shade *= 0.92 + 0.16 * vNoise2(vUv * vec2(70.0, 240.0));

        // Ambient occlusion: crown and skirting fall away.
        float h = clamp(vW.y / 5.3, 0.0, 1.0);
        shade *= mix(0.34, 1.0, smoothstep(0.0, 0.28, h)) * mix(1.0, 0.46, smoothstep(0.55, 1.0, h));

        vec3 col = uBase * shade;

        // Light bleeding out of the coves and off the apex line. Measured as a
        // true distance in the vault's cross-section, so it wraps the curve.
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 - vW.z * 0.20);
        pulse *= pulse;
        float cove = exp(-length(vec2(abs(vW.x) - uStripX, vW.y - uStripY)) * 1.9);
        float crown = exp(-length(vec2(vW.x, vW.y - uCrownY)) * 1.5);
        // Light bleeding out of the coves. On a pale vault it cannot brighten
        // the plaster, so there it stains it instead — which is what actually
        // happens when a coloured cove washes a white wall.
        float bleed = (cove + crown * 0.9) * (0.14 + 0.42 * pulse) * (0.45 + 0.55 * relief);
        col = mix(col, uTint, clamp(bleed, 0.0, 1.0) * 0.6 * (1.0 - uRoomGlow));
        col += uTint * bleed * uRoomGlow;

        col = depthFade(col, vW, uFog, uFogDensity);
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide },
    ),
  );
  shell.position.y = VAULT_SPRING;
  shell.rotation.x = Math.PI / 2;
  assets.add(shell);

  // ── Ribs: real arches for parallax. One instanced draw.
  const ribGeo = assets.geom(
    new THREE.TorusGeometry(VAULT_RADIUS - 0.03, 0.085, 5, 26, Math.PI),
  );
  const ribMat = assets.mat(
    new THREE.MeshStandardMaterial({
      roughness: 0.66,
      metalness: 0.3,
      emissiveIntensity: 0.55,
    }),
  );
  assets.themed(() => {
    mixInto(ribMat.color, SURFACE_ALT, INK, 0.4);
    // A trace of self-illumination so the arches catch the cove light rather
    // than reading as black cut-outs against the glowing shell. A pale vault
    // has no cut-outs to rescue, and the same emissive only fogs the arch.
    mixInto(ribMat.emissive, INK, tint, 0.35);
    // Emissive is the one term no light touches, so the brightness knob has to
    // be applied by hand or the arches stay put while the vault around them
    // moves — which reads as the ribs getting *brighter* as the room dims.
    ribMat.emissiveIntensity = 0.55 * (1 - 0.7 * roomLightness) * roomExposure();
  });
  const ribs = new THREE.InstancedMesh(ribGeo, ribMat, VAULT_BAYS + 1);
  ribs.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const bayLength = VAULT_LENGTH / VAULT_BAYS;
  for (let i = 0; i <= VAULT_BAYS; i++) {
    const z = -VAULT_LENGTH / 2 + i * bayLength;
    ribs.setMatrixAt(i, m4.makeTranslation(0, VAULT_SPRING, z));
  }
  ribs.instanceMatrix.needsUpdate = true;
  assets.add(ribs);

  // ── Light strips: one segment per bay per side, each with its own phase.
  const stripGeo = assets.geom(new THREE.BoxGeometry(0.12, 0.1, bayLength - 0.4));
  const stripPhase: number[] = [];
  // Two cove runs plus the apex run: three lines converging down the vault.
  const stripLanes: readonly (readonly [number, number])[] = [
    [-stripX, stripY],
    [stripX, stripY],
    [0, crownY],
  ];
  const stripCount = VAULT_BAYS * stripLanes.length;
  const strips = new THREE.InstancedMesh(
    stripGeo,
    makeShader(
      assets,
      {
        uTime,
        uTint: { value: tint },
        uHot: assets.uColor((c) => coreInto(c, tint, 0.72)),
      },
      /* glsl */ `
      attribute float aPhase;
      varying vec3 vLocal;
      varying float vPhase;
      void main() {
        vLocal = position;
        vPhase = aPhase;
        vec4 mv = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mv = instanceMatrix * mv;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * mv;
      }
    `,
      /* glsl */ `
      uniform vec3 uTint, uHot;
      uniform float uTime, uOpacity;
      varying vec3 vLocal;
      varying float vPhase;
      void main() {
        // The bar's own surface sits at r = 1..1.41, so the falloff has to
        // start inside that range or every face shades to nothing.
        float r = length(vec2(vLocal.x / 0.06, vLocal.y / 0.05));
        float core = 1.0 - smoothstep(0.82, 1.48, r);
        float ends = 1.0 - smoothstep(0.74, 1.0, abs(vLocal.z) / ${((bayLength - 0.4) / 2).toFixed(3)});
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 + vPhase);
        pulse = 0.34 + 0.66 * pulse * pulse;
        vec3 col = mix(uTint, uHot, core * core);
        gl_FragColor = vec4(col, core * ends * pulse * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "emit", depthWrite: false },
    ),
    stripCount,
  );
  strips.frustumCulled = false;
  for (let i = 0; i < VAULT_BAYS; i++) {
    const z = -VAULT_LENGTH / 2 + (i + 0.5) * bayLength;
    for (let s = 0; s < stripLanes.length; s++) {
      const [lx, ly] = stripLanes[s];
      strips.setMatrixAt(i * stripLanes.length + s, m4.makeTranslation(lx, ly, z));
      // Phase walks along the vault so the pulse reads as a slow travelling wave.
      stripPhase.push(-z * 0.2);
    }
  }
  strips.instanceMatrix.needsUpdate = true;
  instanceAttr(stripGeo, "aPhase", stripPhase);
  assets.add(strips);

  // ── Ground haze: six camera-facing sheets, built in view space.
  const hazeGeo = assets.geom(new THREE.PlaneGeometry(1, 1));
  const hazeCount = 6;
  const hazeSize: number[] = [];
  const hazePhase: number[] = [];
  const haze = new THREE.InstancedMesh(
    hazeGeo,
    makeShader(
      assets,
      {
        uTime,
        uTint: assets.uColor((c) => mixInto(c, tint, WHITE, 0.12)),
        // A pale vault reads the same sheets as aerial haze, and needs more of
        // them, not less — they are the only thing giving the depth away.
        uStrength: assets.uScalar(() => 0.075 * (1 + 1.4 * roomLightness)),
      },
      /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      varying vec2 vUv;
      varying float vPhase;
      varying float vDepth;
      void main() {
        vUv = uv;
        vPhase = aPhase;
        vec4 centre = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          centre = instanceMatrix * centre;
        #endif
        centre = modelViewMatrix * centre;
        vDepth = -centre.z;
        centre.xy += position.xy * aSize;
        gl_Position = projectionMatrix * centre;
      }
    `,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uTint;
      uniform float uTime, uStrength, uOpacity;
      varying vec2 vUv;
      varying float vPhase;
      varying float vDepth;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float mask = 1.0 - smoothstep(0.10, 1.0, d);
        mask *= mask;
        // Distant sheets pile up down the length of the vault and read as a
        // bright plug in the far opening. Hold the haze close to the player.
        float near = exp(-max(vDepth - 3.0, 0.0) * 0.30);
        float n = vFbm2(vUv * 2.6 + vec2(uTime * 0.017 + vPhase, uTime * 0.011));
        gl_FragColor = vec4(uTint * (0.45 + 0.55 * n), mask * near * (0.3 + 0.7 * n) * uStrength * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "emit", depthWrite: false },
    ),
    hazeCount,
  );
  haze.frustumCulled = false;
  for (let i = 0; i < hazeCount; i++) {
    const z = -6.5 + i * 2.6;
    haze.setMatrixAt(i, m4.makeTranslation(i % 2 === 0 ? -1.5 : 1.7, 0.6, z));
    hazeSize.push(3.6 + (i % 3) * 0.8);
    hazePhase.push(i * 1.7);
  }
  haze.instanceMatrix.needsUpdate = true;
  instanceAttr(hazeGeo, "aSize", hazeSize);
  instanceAttr(hazeGeo, "aPhase", hazePhase);
  assets.add(haze);

  // ── Floor: polished stone with an analytic reflection of the two strips.
  const floor = new THREE.Mesh(
    assets.geom(new THREE.PlaneGeometry(22, 28)),
    makeShader(
      assets,
      {
        uTime,
        uBase: assets.uColor((c) => mixInto(c, INK, SURFACE, 0.6)),
        uTint: { value: tint },
        uFog: { value: fogColor },
        uFogDensity: { value: lighting.fogDensity },
        uStripX: { value: stripX },
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uFog;
      uniform float uTime, uFogDensity, uStripX, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz;
        float grain = vNoise2(p * 3.1) * 0.07 + vNoise2(p * 14.0) * 0.035;
        vec3 col = uBase * (0.82 + grain);

        vec2 g = abs(fract(p * 0.5) - 0.5) / max(fwidth(p * 0.5), 1e-4);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        // A pale floor takes its joint lines as a darkening, not as a glow.
        col *= 1.0 - line * 0.22 * (1.0 - uRoomGlow);
        col += uTint * line * 0.045 * uRoomGlow;

        // The cove strips mirrored in the polish: a soft band at |x| = stripX,
        // pulsing in step with the real ones.
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 - p.y * 0.20);
        pulse *= pulse;
        float dx = abs(abs(p.x) - uStripX);
        float refl = exp(-dx * dx * 3.2);
        float ripple = 0.72 + 0.28 * vNoise2(vec2(p.x * 2.0, p.y * 0.5 - uTime * 0.05));
        // Polished stone reflects what is above it. On a pale floor that is a
        // wash of colour rather than a brightening, so the two are crossfaded.
        float wash = refl * ripple * (0.16 + 0.46 * pulse);
        col = mix(col, uTint, clamp(wash, 0.0, 1.0) * 0.55 * (1.0 - uRoomGlow));
        col += uTint * wash * uRoomGlow;

        col = depthFade(col, vW, uFog, uFogDensity);
        float a = uOpacity * (1.0 - smoothstep(8.0, 12.5, length(p)));
        gl_FragColor = vec4(col, a);
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  assets.add(floor);

  return scene(assets, lighting, uTime);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Orbital Deck — a station platform with the planet turning below.
// ════════════════════════════════════════════════════════════════════════════

const DECK_RADIUS = 8;
const STAR_SHELL = 330;
/**
 * The planet sits ahead of the deck as well as below it. Straight below, the
 * deck plate would hide it completely: from eye height at the centre of an 8 m
 * platform the sight line only clears the edge about 10° under the horizon,
 * and a body directly beneath begins far lower than that. Offset forward, its
 * limb rises above the railing and fills the view — which is the shot.
 */
const PLANET_RADIUS = 128;
const PLANET_CENTRE = new THREE.Vector3(0, -96, -206);

function orbitalDeck(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets(ctx.spec);
  assets.root.name = "env-orbital-deck";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  // Everything beyond the deck is scaled about the player, which leaves every
  // angle — and therefore the whole composition — untouched.
  const reach = fitDistance(ctx.camera, STAR_SHELL) / STAR_SHELL;
  const starShell = STAR_SHELL * reach;
  const planetRadius = PLANET_RADIUS * reach;

  const sun = new THREE.Vector3(0.62, 0.3, -0.46).normalize();

  const lighting = defaultLighting(ctx.spec, tint);
  assets.themed(() => {
    applyDefaultLighting(lighting, ctx.spec, tint);
    lighting.keyDirection.copy(sun);
    mixInto(lighting.keyColor, WHITE, REWARD, 0.08);
    lighting.keyScale = 1;
    mixInto(lighting.skyColor, tint, INK, 0.45);
    // Bounce off the planet, so undersides pick up the world below.
    mixInto(lighting.groundColor, tint, ICE, 0.35);
    lighting.ambientScale = 1;
    lighting.fogDensity = 0.004;

    // Space is black, and anything else stops the stars reading as stars. A
    // light palette does not want a black void behind a bright UI, so the same
    // deck becomes a high-altitude one: the void opens into sky, the stars
    // wash out with it and the sun becomes the thing you see.
    mixInto(bg(lighting), INK, PRIMARY, 0.015);
    mixInto(bg(lighting), bg(lighting), ICE, 0.22 * roomLightness);
    lighting.fogColor.copy(bg(lighting));
    mixInto(lighting.shadowColor, DEEP, PRIMARY, 0.1);
    lighting.shadowStrength = 0.7;
  });

  // ── Starfield with a deliberate galactic band.
  const starCount = 1500;
  const starPos = new Float32Array(starCount * 3);
  const starColor = new Float32Array(starCount * 3);
  const starScale = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const dir = new THREE.Vector3();
  const bandAxis = new THREE.Vector3(0.34, 0.79, -0.51).normalize();
  const starTone = new THREE.Color();
  const starGeo = assets.geom(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aColor", new THREE.BufferAttribute(starColor, 3));
  starGeo.setAttribute("aScale", new THREE.BufferAttribute(starScale, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  // The field is baked into attributes, which makes it derived state like any
  // other. Re-seeding the same generator refills the same buffer with the new
  // palette's stars — no reallocation, so the swap costs no VRAM.
  assets.themed(() => {
    const rand = mulberry32(0x5eed01);
    for (let i = 0; i < starCount; i++) {
      goldenSphere(i, starCount, dir);
      starPos[i * 3] = dir.x * starShell;
      starPos[i * 3 + 1] = dir.y * starShell;
      starPos[i * 3 + 2] = dir.z * starShell;
      const band = Math.exp(-Math.pow(dir.dot(bandAxis), 2) * 15);
      const r = rand();
      const bright = 0.28 + band * 0.55 + r * r * 0.5;
      mixInto(starTone, ICE, WHITE, rand());
      if (rand() > 0.93) mixInto(starTone, starTone, REWARD, 0.55);
      starColor[i * 3] = starTone.r * bright;
      starColor[i * 3 + 1] = starTone.g * bright;
      starColor[i * 3 + 2] = starTone.b * bright;
      starScale[i] = 0.55 + band * 0.5 + Math.pow(rand(), 9) * 2.2;
      starPhase[i] = rand() * 6.2831853;
    }
    starGeo.attributes.aColor.needsUpdate = true;
  });
  const pixel = Math.min(2, Math.max(1, ctx.renderer.getPixelRatio()));
  const stars = new THREE.Points(
    starGeo,
    makeShader(
      assets,
      { uTime, uSize: { value: 2.6 * pixel } },
      /* glsl */ `
      attribute vec3 aColor;
      attribute float aScale;
      attribute float aPhase;
      uniform float uTime, uSize;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = aColor;
        vTwinkle = 0.74 + 0.26 * sin(uTime * 0.7 + aPhase);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aScale;
      }
    `,
      /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, d);
        core *= core;
        gl_FragColor = vec4(vColor, core * vTwinkle * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "spark", depthWrite: false },
    ),
  );
  stars.frustumCulled = false;
  // Their object origin sits on the player, so distance sorting would draw
  // them last — over the planet. Pin them to the back of the queue.
  stars.renderOrder = -20;
  assets.add(stars);

  // ── Planet.
  const planetGeo = assets.geom(new THREE.SphereGeometry(planetRadius, 64, 44));
  const planet = new THREE.Mesh(
    planetGeo,
    makeShader(
      assets,
      {
        uTime,
        uSun: { value: sun },
        // A planet is an object in the sky, not a surface of the room: it keeps
        // its own deep oceans whichever way the UI goes, so every darkening
        // here runs towards the palette's darkest neutral rather than towards
        // `ink` — which on a light palette is very nearly white.
        uOcean: assets.uColor((c) => mixInto(c, PRIMARY, DEEP, 0.62)),
        uShallow: assets.uColor((c) => mixInto(c, PRIMARY, ACCENT, 0.45)),
        uLand: assets.uColor((c) => mixInto(c, SURFACE_ALT, ACCENT, 0.22)),
        uIce: assets.uColor((c) => mixInto(c, PAPER, ICE, 0.25)),
        uCity: assets.uColor((c) => c.copy(REWARD)),
        uAtmo: assets.uColor((c) => mixInto(c, tint, ICE, 0.4)),
        uTerm: assets.uColor((c) => mixInto(c, REWARD, tint, 0.35)),
      },
      /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vObj;
      varying vec3 vW;
      void main() {
        vObj = normalize(position);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uSun, uOcean, uShallow, uLand, uIce, uCity, uAtmo, uTerm;
      uniform float uTime, uOpacity;
      varying vec3 vNormalW;
      varying vec3 vObj;
      varying vec3 vW;
      void main() {
        vec3 p = vObj;
        float h = vFbm3(p * 2.3 + 11.7);
        float land = smoothstep(0.505, 0.575, h);
        float shelf = smoothstep(0.465, 0.515, h) * (1.0 - land);

        vec3 surface = mix(uOcean, uLand, land);
        surface = mix(surface, uShallow, shelf * 0.7);
        float ice = smoothstep(0.70, 0.90, abs(p.y));
        surface = mix(surface, uIce, ice * 0.92);
        surface *= 0.86 + 0.28 * vNoise3(p * 9.0);

        float cloud = smoothstep(0.50, 0.80, vFbm3(p * 3.4 + vec3(uTime * 0.0035, 0.0, uTime * -0.0018)));

        float ndl = dot(vNormalW, uSun);
        float lit = smoothstep(-0.13, 0.30, ndl);
        float term = exp(-abs(ndl) * 8.0);

        // Night side. Against a black sky it is black; against a daylit one it
        // has to keep some body, or the planet reads as a hole in the sky.
        float dark = 0.035 + 0.16 * (1.0 - uRoomGlow);
        vec3 col = surface * (dark + 1.10 * lit);
        col = mix(col, uIce * (0.08 + 1.0 * lit), cloud * 0.72);
        col += uTerm * term * 0.30 * (1.0 - cloud * 0.55) * uRoomGlow;

        // City glow, night side only. The branch is coherent across the disc.
        float night = 1.0 - smoothstep(-0.03, 0.14, ndl);
        if (night > 0.01) {
          float sparks = smoothstep(0.855, 0.995, vNoise3(p * 46.0));
          col += uCity * sparks * land * (1.0 - cloud) * night * 0.5 * uRoomGlow;
        }

        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(dot(viewDir, vNormalW), 0.0, 1.0), 3.0);
        col += uAtmo * fres * (0.18 + 0.85 * lit);

        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  planet.position.copy(PLANET_CENTRE).multiplyScalar(reach);
  assets.add(planet);

  // ── Atmosphere halo just outside the limb.
  const halo = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(planetRadius * 1.055, 48, 32)),
    makeShader(
      assets,
      { uSun: { value: sun }, uAtmo: assets.uColor((c) => mixInto(c, tint, ICE, 0.5)) },
      /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
      /* glsl */ `
      uniform vec3 uSun, uAtmo;
      uniform float uOpacity;
      varying vec3 vNormalW;
      varying vec3 vW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vW);
        float rim = pow(clamp(1.0 - abs(dot(viewDir, vNormalW)), 0.0, 1.0), 3.4);
        float lit = smoothstep(-0.35, 0.35, dot(-vNormalW, uSun));
        gl_FragColor = vec4(uAtmo, rim * (0.10 + 0.55 * lit) * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, light: "emit", depthWrite: false },
    ),
  );
  halo.position.copy(planet.position);
  assets.add(halo);

  // ── The sun: a small hard disc, no flare theatrics.
  const sunDisc = new THREE.Mesh(
    assets.geom(new THREE.PlaneGeometry(1, 1)),
    makeShader(
      assets,
      {
        uSize: { value: 12 * reach },
        uCore: assets.uColor((c) => c.copy(WHITE)),
        uHalo: assets.uColor((c) => mixInto(c, REWARD, WHITE, 0.5)),
      },
      /* glsl */ `
      uniform float uSize;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        centre.xy += position.xy * uSize;
        gl_Position = projectionMatrix * centre;
      }
    `,
      /* glsl */ `
      uniform vec3 uCore, uHalo;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float disc = 1.0 - smoothstep(0.16, 0.21, d);
        float glow = exp(-d * 5.2) * 0.55;
        vec3 col = mix(uHalo, uCore, disc);
        gl_FragColor = vec4(col, clamp(disc + glow, 0.0, 1.0) * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "emit", depthWrite: false, depthTest: false },
    ),
  );
  sunDisc.position.copy(sun).multiplyScalar(290 * reach);
  sunDisc.renderOrder = -5;
  sunDisc.frustumCulled = false;
  assets.add(sunDisc);

  // ── Deck plate.
  const deck = new THREE.Mesh(
    assets.geom(new THREE.CircleGeometry(DECK_RADIUS, 72)),
    makeShader(
      assets,
      {
        uTime,
        uBase: assets.uColor((c) => mixInto(c, SURFACE, INK, 0.35)),
        uTint: { value: tint },
        uSun: { value: sun },
        uEdge: assets.uColor((c) => coreInto(c, tint, 0.35)),
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uSun, uEdge;
      uniform float uTime, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float a01 = ang / 6.2831853 + 0.5;

        // 24 radial bays with recessed seams, plus concentric rings. The mask
        // is distance *to the boundary*, so the dark line lands on the joint.
        float bay = a01 * 24.0;
        float bayEdge = min(fract(bay), 1.0 - fract(bay));
        float seam = 1.0 - smoothstep(0.0, fwidth(bay) * 1.5 + 0.035, bayEdge);
        float ringU = r * 0.5;
        float ringEdge = min(fract(ringU), 1.0 - fract(ringU));
        float ring = 1.0 - smoothstep(0.0, fwidth(ringU) * 1.5 + 0.02, ringEdge);

        // Brushed finish. Frequency is measured along the arc, not in angle —
        // otherwise it collapses into a starburst at the centre of the plate.
        // Radial grain only. An angular frequency that rises towards the hub
        // aliases into a starburst on a headset's screen-space derivatives.
        float brush = (vNoise2(vec2(r * 7.0, a01 * 46.0)) - 0.5) * 0.09;
        vec3 col = uBase * (0.85 + brush);
        col *= mix(1.0, 0.42, max(seam, ring * 0.65));

        // Hard sun grazing the plate.
        vec3 lateral = normalize(vec3(p.x, 0.0, p.y) + 1e-5);
        float graze = pow(max(dot(lateral, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 8.0);
        col += uEdge * graze * (0.022 + brush * 0.22) * uRoomGlow;

        // Glowing rim and a soft pool of deck light under the board. A pale
        // plate cannot be brightened at its edge, so there the same rim is laid
        // in as colour instead and the two crossfade on uRoomGlow.
        float rim = exp(-abs(r - ${(DECK_RADIUS - 0.14).toFixed(2)}) * 18.0);
        float pool = exp(-r * r * 0.10) * 0.028;
        col = mix(col, uEdge, clamp(rim, 0.0, 1.0) * 0.8 * (1.0 - uRoomGlow));
        col += uEdge * rim * (0.60 + 0.22 * sin(uTime * 0.4)) * uRoomGlow;
        col += uTint * pool * uRoomGlow;

        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  deck.rotation.x = -Math.PI / 2;
  assets.add(deck);

  const skirt = new THREE.Mesh(
    assets.geom(new THREE.CylinderGeometry(DECK_RADIUS, DECK_RADIUS * 0.94, 0.45, 72, 1, true)),
    makeShader(
      assets,
      {
        uBase: assets.uColor((c) => mixInto(c, SURFACE, INK, 0.6)),
        uEdge: assets.uColor((c) => coreInto(c, tint, 0.3)),
      },
      VERT_WORLD,
      /* glsl */ `
      uniform vec3 uBase, uEdge;
      uniform float uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        float band = 1.0 - smoothstep(0.0, 0.10, abs(vUv.y - 0.86));
        vec3 col = uBase * (0.30 + 0.55 * vUv.y);
        col = mix(col, uEdge, band * 0.7 * (1.0 - uRoomGlow));
        col += uEdge * band * 0.35 * uRoomGlow;
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  skirt.position.y = -0.225;
  assets.add(skirt);

  // ── Railing: posts instanced, handrail a single torus.
  const railMat = assets.mat(
    new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.85 }),
  );
  assets.themed(() => {
    mixInto(railMat.color, SURFACE_ALT, PAPER, 0.18);
    // Polished metal against a bright sky wants to be darker than the sky, or
    // the railing vanishes and the deck loses its edge.
    mixInto(railMat.color, railMat.color, DEEP, 0.42 * roomLightness);
  });
  const postGeo = assets.geom(new THREE.CylinderGeometry(0.022, 0.022, 1.04, 6));
  const posts = new THREE.InstancedMesh(postGeo, railMat, 28);
  posts.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    posts.setMatrixAt(
      i,
      m4.makeTranslation(Math.cos(a) * (DECK_RADIUS - 0.16), 0.52, Math.sin(a) * (DECK_RADIUS - 0.16)),
    );
  }
  posts.instanceMatrix.needsUpdate = true;
  assets.add(posts);

  const handrail = new THREE.Mesh(
    assets.geom(new THREE.TorusGeometry(DECK_RADIUS - 0.16, 0.028, 5, 96)),
    railMat,
  );
  handrail.rotation.x = -Math.PI / 2;
  handrail.position.y = 1.04;
  assets.add(handrail);

  return scene(assets, lighting, uTime, (dt) => {
    // One quaternion write per frame; no allocation, no matrix array walk.
    planet.rotation.y += dt * 0.011;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Quantum Lab — bright floor, soft shafts, floating calibration geometry.
// ════════════════════════════════════════════════════════════════════════════

/** Hand-placed shafts: none directly in front of the board, all off the axis. */
const LAB_SHAFTS: readonly (readonly [number, number])[] = [
  [-3.5, -2.1],
  [3.9, -1.2],
  [-2.2, 3.4],
  [4.6, 3.1],
  [-5.4, 0.8],
];

function quantumLab(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets(ctx.spec);
  assets.root.name = "env-quantum-lab";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  // Bright, but a stop or two below paper white: shafts of light only read
  // against something they can be brighter than, and a full-white room in a
  // headset is fatiguing after two minutes.
  const paper = new THREE.Color();
  const lighting = defaultLighting(ctx.spec, tint);
  assets.themed(() => {
    mixInto(paper, INK, PAPER, 0.4);
    applyDefaultLighting(lighting, ctx.spec, tint);
    lighting.keyDirection.set(0.2, 0.94, 0.28).normalize();
    mixInto(lighting.keyColor, WHITE, tint, 0.1);
    mixInto(lighting.skyColor, PAPER, tint, 0.22);
    mixInto(lighting.groundColor, PAPER, tint, 0.1);
    mixInto(lighting.fogColor, paper, tint, 0.16);
    lighting.fogDensity = 0.055;
    mixInto(bg(lighting), paper, tint, 0.12);
    mixInto(lighting.shadowColor, DEEP, tint, 0.3);
    lighting.shadowStrength = 0.34;
  });

  const shaftUniform = LAB_SHAFTS.map(([x, z]) => new THREE.Vector2(x, z));

  // ── Dome: soft gradient plus a lattice of ceiling panels overhead.
  const dome = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(30, 32, 20)),
    makeShader(
      assets,
      {
        // The volume sits below the floor in value. Shafts of light can only
        // read against something they are brighter than.
        uHorizon: assets.uColor((c) => mixInto(c, paper, tint, 0.16)),
        uZenith: assets.uColor((c) => mixInto(c, paper, PAPER, 0.22)),
        uPanel: assets.uColor((c) => mixInto(c, PAPER, WHITE, 0.5)),
        // Panel seams are the ceiling's only structure. On a pale palette
        // `ink` is nearly white, so the seam has to be taken further down or
        // the lattice disappears and the ceiling reads as one flat sheet.
        uSeam: assets.uColor((c) => {
          mixInto(c, paper, INK, 0.5);
          mixInto(c, c, DEEP, 0.4 * roomLightness);
        }),
      },
      VERT_DOME,
      /* glsl */ `
      uniform vec3 uHorizon, uZenith, uPanel, uSeam;
      uniform float uOpacity;
      varying vec3 vDir;
      varying vec2 vUv;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.8));
        col = mix(col * 0.72, col, smoothstep(0.30, 0.54, h));

        // Ceiling light panels, projected onto a plane above the room.
        if (vDir.y > 0.10) {
          vec2 q = vDir.xz / max(vDir.y, 0.12) * 0.5;
          vec2 g = abs(fract(q) - 0.5);
          float seam = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y) - 0.03);
          float k = smoothstep(0.10, 0.42, vDir.y);
          col = mix(col, uPanel, (1.0 - seam) * 0.62 * k);
          col = mix(col, uSeam, seam * 0.75 * k);
        }
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, depthWrite: false },
    ),
  );
  dome.renderOrder = -10;
  assets.add(dome);

  // ── Floor, with a landing pool for each shaft.
  const floor = new THREE.Mesh(
    assets.geom(new THREE.CircleGeometry(24, 72)),
    makeShader(
      assets,
      {
        uTime,
        uBase: assets.uColor((c) => mixInto(c, paper, PAPER, 0.42)),
        uTint: { value: tint },
        uFog: { value: lighting.fogColor },
        uFogDensity: { value: lighting.fogDensity },
        uShafts: { value: shaftUniform },
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uFog;
      uniform float uTime, uFogDensity, uOpacity;
      uniform vec2 uShafts[${LAB_SHAFTS.length}];
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz;
        float r = length(p);
        vec3 col = uBase * (0.95 + vNoise2(p * 7.0) * 0.05);

        // Seams every metre, heavier every four.
        vec2 g = abs(fract(p) - 0.5) / max(fwidth(p), 1e-4);
        float fine = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 G = abs(fract(p * 0.25) - 0.5) / max(fwidth(p * 0.25), 1e-4);
        float bold = 1.0 - min(min(G.x, G.y), 1.0);
        col *= 1.0 - fine * 0.10 - bold * 0.16;

        // Where the shafts land. A white floor cannot be made whiter, so the
        // pool is laid in as colour there and as light in a dark room.
        for (int i = 0; i < ${LAB_SHAFTS.length}; i++) {
          float d = length(p - uShafts[i]);
          float breathe = 0.85 + 0.15 * sin(uTime * 0.33 + float(i) * 1.7);
          float pool = exp(-d * d * 0.30) * breathe;
          col = mix(col, uTint, clamp(pool, 0.0, 1.0) * 0.30 * (1.0 - uRoomGlow));
          col += uTint * pool * 0.16 * uRoomGlow;
        }

        col *= mix(0.62, 1.0, 1.0 - smoothstep(2.0, 20.0, r));
        col = depthFade(col, vW, uFog, uFogDensity);
        gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(17.0, 23.5, r)));
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  assets.add(floor);

  // ── God rays.
  // Short and low: a seated player's field of view only reaches about 15°
  // above the horizon, so a tall shaft puts all of its brightness off screen.
  const shaftGeo = assets.geom(new THREE.CylinderGeometry(0.35, 2.2, 4.6, 20, 1, true));
  const shafts = new THREE.InstancedMesh(
    shaftGeo,
    makeShader(
      assets,
      {
        uTime,
        // A shaft in a white room has to be read as colour rather than as
        // brightness, so it carries more of the tint the paler the room gets —
        // but only a little more, or five of them curdle the whole lab.
        uTint: assets.uColor((c) => mixInto(c, WHITE, tint, 0.22 + 0.2 * roomLightness)),
        uStrength: assets.uScalar(() => 0.5 * (1 - 0.5 * roomLightness)),
      },
      /* glsl */ `
      attribute float aPhase;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vW;
      varying float vPhase;
      void main() {
        vUv = uv;
        vPhase = aPhase;
        vec4 wp = vec4(position, 1.0);
        vec3 nrm = normal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          nrm = mat3(instanceMatrix) * nrm;
        #endif
        wp = modelMatrix * wp;
        vW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * nrm);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
      /* glsl */ `
      uniform vec3 uTint;
      uniform float uTime, uStrength, uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vW;
      varying float vPhase;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vW);
        // Brightest looking through the middle of the shaft, not at its edge.
        float body = pow(abs(dot(viewDir, vNormalW)), 1.7);
        // Bright the whole way down, so the shaft joins its pool on the floor.
        float along = mix(0.72, 1.0, vUv.y);
        along *= smoothstep(0.0, 0.10, vUv.y) * (1.0 - smoothstep(0.90, 1.0, vUv.y));
        float breathe = 0.82 + 0.18 * sin(uTime * 0.31 + vPhase);
        gl_FragColor = vec4(uTint, body * along * breathe * uStrength * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.DoubleSide, light: "emit", depthWrite: false },
    ),
    LAB_SHAFTS.length,
  );
  shafts.frustumCulled = false;
  const shaftPhase: number[] = [];
  const m4 = new THREE.Matrix4();
  LAB_SHAFTS.forEach(([x, z], i) => {
    shafts.setMatrixAt(i, m4.makeTranslation(x, 2.25, z));
    shaftPhase.push(i * 1.31);
  });
  shafts.instanceMatrix.needsUpdate = true;
  instanceAttr(shaftGeo, "aPhase", shaftPhase);
  assets.add(shafts);

  // ── Calibration solids: a deliberate arc, not a scatter.
  const solidPlacements: readonly (readonly [number, number, number, number])[] = [
    [-1.75, 1.02, -0.95, 0.9],
    [-2.35, 1.48, -0.15, 1.15],
    [-2.15, 1.92, 0.85, 0.75],
    [-1.25, 2.28, 1.7, 1.0],
    [1.35, 1.06, -1.15, 0.85],
    [2.2, 1.42, -0.3, 1.2],
    [2.45, 1.86, 0.75, 0.8],
    [1.6, 2.24, 1.65, 1.05],
    [0.0, 2.62, 2.35, 0.7],
  ];
  const solidGeo = assets.geom(new THREE.IcosahedronGeometry(0.13, 0));
  const solidMat = makeShader(
    assets,
    {
      uTime,
      // White solids in a white room are invisible. Take the body down as the
      // room comes up, so the arc still reads as a row of objects.
      uBase: assets.uColor((c) => {
        mixInto(c, PAPER, WHITE, 0.5);
        mixInto(c, c, SURFACE_ALT, 0.55 * roomLightness);
      }),
      uTint: { value: tint },
      uKey: { value: lighting.keyDirection },
    },
    /* glsl */ `
      ${GLSL_NOISE}
      attribute float aPhase;
      attribute float aSpin;
      varying vec3 vNormalW;
      varying vec3 vW;
      uniform float uTime;
      void main() {
        mat3 spin = spinMatrix(normalize(vec3(0.34, 0.86, 0.38)), uTime * aSpin + aPhase);
        vec4 wp = vec4(spin * position, 1.0);
        vec3 nrm = spin * normal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          nrm = mat3(instanceMatrix) * nrm;
        #endif
        wp.y += sin(uTime * 0.32 + aPhase) * 0.05;
        wp = modelMatrix * wp;
        vW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * nrm);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    /* glsl */ `
      uniform vec3 uBase, uTint, uKey;
      uniform float uOpacity;
      varying vec3 vNormalW;
      varying vec3 vW;
      void main() {
        float ndl = clamp(dot(vNormalW, normalize(uKey)), 0.0, 1.0);
        vec3 viewDir = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(dot(viewDir, vNormalW), 0.0, 1.0), 2.4);
        vec3 col = uBase * (0.42 + 0.58 * ndl);
        col = mix(col, uTint, clamp(fres, 0.0, 1.0) * 0.55 * (1.0 - uRoomGlow));
        col += uTint * fres * 0.65 * uRoomGlow;
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
  );
  const solids = new THREE.InstancedMesh(solidGeo, solidMat, solidPlacements.length);
  solids.frustumCulled = false;
  const solidPhase: number[] = [];
  const solidSpin: number[] = [];
  const scaleV = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const posV = new THREE.Vector3();
  solidPlacements.forEach(([x, y, z, s], i) => {
    posV.set(x, y, z);
    scaleV.setScalar(s);
    solids.setMatrixAt(i, m4.compose(posV, quat, scaleV));
    solidPhase.push(i * 0.83);
    solidSpin.push(0.1 + (i % 3) * 0.045);
  });
  solids.instanceMatrix.needsUpdate = true;
  instanceAttr(solidGeo, "aPhase", solidPhase);
  instanceAttr(solidGeo, "aSpin", solidSpin);
  assets.add(solids);

  // ── Calibration rings.
  const ringPlacements: readonly (readonly [number, number, number, number])[] = [
    [-2.75, 1.28, 0.35, 1.0],
    [2.85, 1.16, 0.5, 0.9],
    [-1.65, 2.55, -1.35, 0.7],
    [1.75, 2.72, 1.05, 0.8],
    [2.3, 1.9, -2.45, 1.05],
  ];
  const ringGeo = assets.geom(new THREE.TorusGeometry(0.3, 0.005, 4, 44));
  // Normal blending, not additive: in a bright room a glow disappears and a
  // dark line is what reads.
  const ringMat = makeShader(
    assets,
    { uTime, uTint: assets.uColor((c) => mixInto(c, tint, DEEP, 0.35)) },
    /* glsl */ `
      ${GLSL_NOISE}
      attribute float aPhase;
      attribute float aSpin;
      uniform float uTime;
      varying float vFade;
      void main() {
        mat3 spin = spinMatrix(normalize(vec3(0.72, 0.3, -0.62)), uTime * aSpin + aPhase);
        vec4 wp = vec4(spin * position, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp.y += sin(uTime * 0.26 + aPhase * 1.7) * 0.06;
        vFade = 0.65 + 0.35 * sin(uTime * 0.5 + aPhase);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }
    `,
    /* glsl */ `
      uniform vec3 uTint;
      uniform float uOpacity;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(uTint, (0.30 + 0.45 * vFade) * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    { depthWrite: false },
  );
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, ringPlacements.length);
  rings.frustumCulled = false;
  const ringPhase: number[] = [];
  const ringSpin: number[] = [];
  ringPlacements.forEach(([x, y, z, s], i) => {
    posV.set(x, y, z);
    scaleV.setScalar(s);
    rings.setMatrixAt(i, m4.compose(posV, quat, scaleV));
    ringPhase.push(1.4 + i * 1.21);
    ringSpin.push(0.07 + (i % 2) * 0.05);
  });
  rings.instanceMatrix.needsUpdate = true;
  instanceAttr(ringGeo, "aPhase", ringPhase);
  instanceAttr(ringGeo, "aSpin", ringSpin);
  assets.add(rings);

  // ── A single measurement frame, for the sense of a calibrated volume.
  const frameSource = new THREE.BoxGeometry(1.25, 1.25, 1.25);
  const frameGeo = assets.geom(new THREE.EdgesGeometry(frameSource));
  frameSource.dispose();
  const frameMat = assets.mat(
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
  );
  // Unlit, so the brightness knob has to be folded into the colour itself.
  assets.themed(() => {
    mixInto(frameMat.color, tint, DEEP, 0.15).multiplyScalar(roomExposure());
  });
  const frame = new THREE.LineSegments(frameGeo, frameMat);
  // Off the centre line, so it frames the board rather than sitting on it.
  frame.position.set(-2.6, 2.05, -1.9);
  assets.add(frame);

  return scene(assets, lighting, uTime, (dt) => {
    frame.rotation.y += dt * 0.06;
    frame.rotation.x += dt * 0.021;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Cyber Atrium — rain on the curtain wall, signage bleeding into the dark.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Close enough that rain on the curtain wall is legible. At nine or ten metres
 * a runnel is a couple of pixels wide on a headset and the whole effect is
 * wasted; at six and a half it is the thing you notice first.
 */
const GLASS_RADIUS = 6.6;

function cyberAtrium(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets(ctx.spec);
  assets.root.name = "env-cyber-atrium";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  assets.themed(() => {
    applyDefaultLighting(lighting, ctx.spec, tint);
    lighting.keyDirection.set(-0.42, 0.72, 0.55).normalize();
    mixInto(lighting.keyColor, WHITE, tint, 0.42);
    mixInto(lighting.skyColor, tint, PRIMARY, 0.35);
    mixInto(lighting.groundColor, INK, VIOLET, 0.28);
    // On a light palette the same recipe turns the night city into an overcast
    // daytime one: a pale violet sky, towers reading dark against it, and the
    // rain on the glass carried by contrast rather than by neon.
    mixInto(lighting.fogColor, INK, VIOLET, 0.14);
    lighting.fogDensity = 0.055;
    mixInto(bg(lighting), INK, VIOLET, 0.05);
    mixInto(lighting.shadowColor, DEEP, VIOLET, 0.2);
    lighting.shadowStrength = 0.6;
  });

  // A curated sign palette: four brand colours plus the room tint. Signage in
  // a city is not random, and neither is this.
  const signColors: readonly THREE.Color[] = [PRIMARY, ACCENT, REWARD, VIOLET, tint];

  // ── Backdrop: a skyline drawn straight out of a hash.
  const backdrop = new THREE.Mesh(
    assets.geom(new THREE.CylinderGeometry(27, 27, 36, 48, 1, true)),
    makeShader(
      assets,
      {
        uTime,
        uSky: assets.uColor((c) => mixInto(c, INK, VIOLET, 0.07)),
        uHaze: assets.uColor((c) => mixInto(c, INK, tint, 0.16)),
        // Towers read against the sky by being darker than it, whichever sky
        // the palette hands them.
        uBlock: assets.uColor((c) => {
          mixInto(c, INK, SURFACE, 0.5);
          mixInto(c, c, DEEP, 0.45 * roomLightness);
        }),
        uWindow: assets.uColor((c) => mixInto(c, REWARD, WHITE, 0.15)),
        uWindowAlt: assets.uColor((c) => mixInto(c, tint, WHITE, 0.2)),
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uSky, uHaze, uBlock, uWindow, uWindowAlt;
      uniform float uTime, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        // Night sky with a low glow where the city meets it.
        float h = vUv.y;
        vec3 col = mix(uHaze, uSky, smoothstep(0.26, 0.66, h));

        // Two ranks of towers: a far, hazier line behind a nearer one, so the
        // skyline has depth instead of reading as a single cardboard cut-out.
        for (int rank = 0; rank < 2; rank++) {
          float f = float(rank);
          float count = mix(150.0, 96.0, f);
          float u = vUv.x * count + f * 13.7;
          float bi = floor(u) + f * 411.0;
          float bf = fract(u);
          float width = 0.30 + vHash12(vec2(bi, 5.0)) * 0.48;
          float inBlock = 1.0 - smoothstep(width, width + 0.02, abs(bf - 0.5) * 2.0);
          float top = mix(0.36, 0.44, f) + vHash12(vec2(bi, 3.0)) * mix(0.14, 0.30, f);
          float body = 1.0 - smoothstep(top, top + 0.003, h);
          float mask = inBlock * body;

          vec3 block = uBlock * (0.16 + 0.22 * vHash12(vec2(bi, 11.0))) * mix(0.7, 1.0, f);

          // Windows: small, sparse and dim. A city at night is mostly dark.
          vec2 wc = vec2(floor(bf * 9.0) + bi * 7.0, floor(h * 420.0));
          float lit = step(0.88, vHash12(wc));
          float flicker = step(0.988, vHash12(wc + floor(uTime * 2.0)));
          vec3 windowColor = mix(uWindow, uWindowAlt, step(0.55, vHash12(wc + 3.7)));
          // A city in daylight does not have its lights on.
          block += windowColor * lit * (0.11 + 0.24 * flicker) * mix(0.5, 1.0, f) * uRoomGlow;

          col = mix(col, block, mask);
        }

        // Ground haze swallowing the base of the city.
        col = mix(col, uHaze, (1.0 - smoothstep(0.04, 0.30, h)) * 0.85);
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, depthWrite: false },
    ),
  );
  backdrop.position.y = 6;
  backdrop.renderOrder = -10;
  assets.add(backdrop);

  // ── Signage bokeh between the glass and the skyline.
  const bokehCount = 240;
  const bokehPos = new Float32Array(bokehCount * 3);
  const bokehCol = new Float32Array(bokehCount * 3);
  const bokehScale = new Float32Array(bokehCount);
  const bokehPhase = new Float32Array(bokehCount);
  const bokehTone = new THREE.Color();
  const bokehGeo = assets.geom(new THREE.BufferGeometry());
  bokehGeo.setAttribute("position", new THREE.BufferAttribute(bokehPos, 3));
  bokehGeo.setAttribute("aColor", new THREE.BufferAttribute(bokehCol, 3));
  bokehGeo.setAttribute("aScale", new THREE.BufferAttribute(bokehScale, 1));
  bokehGeo.setAttribute("aPhase", new THREE.BufferAttribute(bokehPhase, 1));
  assets.themed(() => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < bokehCount; i++) {
      const a = rand() * Math.PI * 2;
      const radius = 11 + rand() * 11;
      bokehPos[i * 3] = Math.cos(a) * radius;
      bokehPos[i * 3 + 1] = -3.5 + Math.pow(rand(), 1.35) * 16;
      bokehPos[i * 3 + 2] = Math.sin(a) * radius;
      mixInto(bokehTone, signColors[i % signColors.length], WHITE, 0.1 + rand() * 0.25);
      const gain = 0.35 + rand() * 0.65;
      bokehCol[i * 3] = bokehTone.r * gain;
      bokehCol[i * 3 + 1] = bokehTone.g * gain;
      bokehCol[i * 3 + 2] = bokehTone.b * gain;
      bokehScale[i] = 0.4 + Math.pow(rand(), 2.6) * 1.9;
      bokehPhase[i] = rand() * 6.2831853;
    }
    bokehGeo.attributes.aColor.needsUpdate = true;
  });
  const pixel = Math.min(2, Math.max(1, ctx.renderer.getPixelRatio()));
  const bokeh = new THREE.Points(
    bokehGeo,
    makeShader(
      assets,
      { uTime, uSize: { value: 11 * pixel } },
      /* glsl */ `
      attribute vec3 aColor;
      attribute float aScale;
      attribute float aPhase;
      uniform float uTime, uSize;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        vColor = aColor;
        // Most signs breathe; a few stutter like failing tubes.
        float breathe = 0.72 + 0.28 * sin(uTime * 0.45 + aPhase);
        float stutter = step(0.94, fract(sin(aPhase * 91.7) * 43758.5453));
        vGain = mix(breathe, step(0.35, fract(uTime * 2.3 + aPhase)) * 0.9 + 0.1, stutter);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * aScale * (14.0 / max(-mv.z, 1.0)), 2.0, 44.0);
      }
    `,
      /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        // A real out-of-focus highlight: flat core, slightly brighter rim.
        float disc = 1.0 - smoothstep(0.72, 1.0, d);
        float rim = smoothstep(0.5, 0.9, d) * 0.28;
        float a = disc * (0.55 + rim);
        gl_FragColor = vec4(vColor, a * vGain * 0.55 * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "spark", depthWrite: false },
    ),
  );
  bokeh.frustumCulled = false;
  assets.add(bokeh);

  // ── Structure: columns framing the atrium, and a dark roof.
  const columnMat = assets.mat(
    new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5 }),
  );
  assets.themed(() => {
    mixInto(columnMat.color, SURFACE, INK, 0.55);
    // Structure has to sit darker than the sky behind it, whichever the sky is.
    mixInto(columnMat.color, columnMat.color, DEEP, 0.5 * roomLightness);
  });
  const columnGeo = assets.geom(new THREE.CylinderGeometry(0.15, 0.19, 13, 8));
  const columns = new THREE.InstancedMesh(columnGeo, columnMat, 10);
  columns.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    columns.setMatrixAt(
      i,
      m4.makeTranslation(Math.cos(a) * (GLASS_RADIUS + 0.35), 6.2, Math.sin(a) * (GLASS_RADIUS + 0.35)),
    );
  }
  columns.instanceMatrix.needsUpdate = true;
  assets.add(columns);

  const roof = new THREE.Mesh(
    assets.geom(new THREE.CircleGeometry(GLASS_RADIUS + 0.6, 48)),
    makeShader(
      assets,
      {
        uBase: assets.uColor((c) => {
          mixInto(c, INK, SURFACE, 0.3);
          mixInto(c, c, DEEP, 0.45 * roomLightness);
        }),
        uTint: { value: tint },
      },
      VERT_WORLD,
      /* glsl */ `
      uniform vec3 uBase, uTint;
      uniform float uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float ribs = abs(fract(ang / 6.2831853 * 20.0) - 0.5) * 2.0;
        float rib = 1.0 - smoothstep(0.55, 0.95, ribs);
        vec3 col = uBase * (0.35 + 0.45 * rib);
        col += uTint * exp(-r * 0.6) * 0.12 * uRoomGlow;
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide },
    ),
  );
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = 11.6;
  assets.add(roof);

  // ── Wet floor reflecting the signage.
  const floor = new THREE.Mesh(
    assets.geom(new THREE.CircleGeometry(GLASS_RADIUS + 0.4, 72)),
    makeShader(
      assets,
      {
        uTime,
        uBase: assets.uColor((c) => mixInto(c, INK, SURFACE, 0.35)),
        uTint: { value: tint },
        uFog: { value: lighting.fogColor },
        uFogDensity: { value: lighting.fogDensity },
        // Live palette colours, shared by reference — `refreshPalette` mutates
        // them in place, so the wet floor follows a re-skin with no rebuild.
        uSignA: { value: PRIMARY },
        uSignB: { value: REWARD },
        uSignC: { value: VIOLET },
        uSignD: { value: ACCENT },
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uFog, uSignA, uSignB, uSignC, uSignD;
      uniform float uTime, uFogDensity, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz;
        float r = length(p);
        float a01 = atan(p.y, p.x) / 6.2831853 + 0.5;

        vec3 col = uBase * (0.42 + vNoise2(p * 5.0) * 0.10);

        // Signage smeared radially, as wet stone does it: many narrow lanes,
        // most of them nearly dark, a handful catching a sign.
        float lane = a01 * 96.0;
        float li = floor(lane);
        float lf = fract(lane);
        float seed = vHash12(vec2(li, 2.0));
        vec3 signCol = seed < 0.25 ? uSignA : seed < 0.5 ? uSignB : seed < 0.75 ? uSignC : uSignD;
        float band = gauss(lf - 0.5, 4.2);
        // Reflections of distant signage gather towards the far floor and die
        // out under your feet, rather than radiating from you like spokes.
        float reach = smoothstep(2.6, ${(GLASS_RADIUS - 1.0).toFixed(2)}, r)
                    * (1.0 - smoothstep(${(GLASS_RADIUS - 0.7).toFixed(2)}, ${(GLASS_RADIUS + 0.5).toFixed(2)}, r));
        float ripple = 0.45 + 0.55 * vNoise2(vec2(a01 * 120.0, r * 2.4 - uTime * 0.16));
        float strength = pow(vHash12(vec2(li, 6.0)), 3.0);
        // Wet stone in daylight still smears the colour above it, but as a
        // stain in the surface rather than as light lying on top of it.
        float smear = band * reach * ripple * strength;
        col = mix(col, signCol, clamp(smear, 0.0, 1.0) * 0.5 * (1.0 - uRoomGlow));
        col += signCol * smear * 0.10 * uRoomGlow;

        // A cool sheen so the stone still reads as stone.
        col += uTint * exp(-r * 0.5) * 0.04 * uRoomGlow;
        col = depthFade(col, vW, uFog, uFogDensity);
        gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(${(GLASS_RADIUS - 0.7).toFixed(
          2,
        )}, ${(GLASS_RADIUS + 0.45).toFixed(2)}, r)));
        ${GLSL_OUTPUT}
      }
    `,
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  assets.add(floor);

  // ── The curtain wall, and the rain running down it.
  const glass = new THREE.Mesh(
    assets.geom(new THREE.CylinderGeometry(GLASS_RADIUS, GLASS_RADIUS, 12, 56, 1, true)),
    makeShader(
      assets,
      {
        uTime,
        uTint: assets.uColor((c) => mixInto(c, tint, WHITE, 0.15)),
        uHot: assets.uColor((c) => coreInto(c, tint, 0.75)),
        // The mullions are the only opaque thing on the curtain wall: they have
        // to stay darker than the sky they are silhouetted against.
        uMullion: assets.uColor((c) => {
          mixInto(c, INK, SURFACE_ALT, 0.5);
          mixInto(c, c, DEEP, 0.55 * roomLightness);
        }),
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uTint, uHot, uMullion;
      uniform float uTime, uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        // Runnels: one per column, each with its own speed and offset. Long
        // and thin, so they read as water tracking down glass, not as snow.
        vec2 rc = vec2(vUv.x * 46.0, vUv.y * 3.2);
        float column = floor(rc.x);
        float cf = fract(rc.x);
        // Named "running", never "active" — active is a reserved word in
        // GLSL ES and the whole shader silently fails to compile with it.
        float running = step(0.30, vHash12(vec2(column, 17.0)));
        float speed = 0.20 + vHash12(vec2(column, 1.0)) * 0.7;
        float y = fract(rc.y + uTime * speed + vHash12(vec2(column, 7.0)) * 9.0);
        float width = 0.30 + vHash12(vec2(column, 3.0)) * 0.40;
        float lateral = gauss(abs(cf - 0.5) * 2.0 / width, 1.844);
        float head = gauss(y - 0.22, 62.0);
        // A long trail above the bead is what makes it read as rain on glass
        // rather than as falling snow.
        float tail = exp(-max(y - 0.22, 0.0) * 1.5) * step(0.22, y) * 0.5;
        float runnel = lateral * (head * 0.9 + tail) * running;

        // Beads clinging between the runnels — small, and only a few of them.
        vec2 gc = vec2(vUv.x * 150.0, vUv.y * 42.0);
        vec2 gi = floor(gc);
        vec2 gf = fract(gc) - 0.5;
        vec2 jitter = vec2(vHash12(gi), vHash12(gi + 41.0)) - 0.5;
        float rad = 0.05 + vHash12(gi + 9.0) * 0.13;
        // Edges in ascending order: smoothstep is undefined when edge0 >= edge1
        // and some drivers hand back NaN, which poisons the whole fragment.
        float bead = 1.0 - smoothstep(rad * 0.25, rad, length((gf - jitter * 0.7) * vec2(1.0, 1.5)));
        bead *= step(0.55, vHash12(gi + 23.0));

        float wet = clamp(runnel + bead * 0.4, 0.0, 1.4);

        // Mullions, so the glass has structure behind the water. The mask is
        // distance to the frame line, not to the middle of the pane.
        float mx = fract(vUv.x * 18.0);
        float my = fract(vUv.y * 5.0);
        float mull = 1.0 - smoothstep(0.0, 0.055, min(mx, 1.0 - mx));
        float transom = 1.0 - smoothstep(0.0, 0.030, min(my, 1.0 - my));

        float frame = max(mull, transom);
        vec3 col = mix(uTint * 0.4, uHot, clamp(wet * 0.8, 0.0, 1.0));
        float a = (0.02 + wet * 0.6) * uOpacity;
        col = mix(col, uMullion, frame * 0.92);
        a = max(a, frame * 0.7 * uOpacity);
        gl_FragColor = vec4(col, a);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, depthWrite: false },
    ),
  );
  glass.position.y = 3.6;
  glass.renderOrder = 4;
  assets.add(glass);

  return scene(assets, lighting, uTime);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Aurora Void — no floor, drifting curtains, weightless particulate.
// ════════════════════════════════════════════════════════════════════════════

/**
 * radius, span (rad), height, baseY, phase, bearing (rad), colour A, colour B.
 *
 * Bearings are measured from +Z and hand-set around π, because the player faces
 * −Z: derive them from the phase and every curtain ends up behind their head.
 * Two are placed wide and one behind, so turning around still finds sky.
 */
const AURORA_RIBBONS: readonly (readonly [
  number, number, number, number, number, number, number, number,
])[] = [
  [26, 1.5, 15, -3.5, 0.0, Math.PI - 1.05, 0.0, 0.5],
  [34, 1.8, 21, -6.0, 1.7, Math.PI - 0.3, 0.3, 0.85],
  [20, 1.1, 12, -1.5, 3.4, Math.PI + 0.5, 0.12, 0.35],
  [41, 1.3, 25, -8.0, 5.1, Math.PI + 1.3, 0.55, 1.0],
  [29, 0.9, 17, -4.5, 2.4, Math.PI - 2.1, 0.05, 0.65],
];

function auroraVoid(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets(ctx.spec);
  assets.root.name = "env-aurora-void";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  assets.themed(() => {
    applyDefaultLighting(lighting, ctx.spec, tint);
    lighting.keyDirection.set(-0.3, 0.86, 0.42).normalize();
    mixInto(lighting.keyColor, WHITE, tint, 0.3);
    mixInto(lighting.skyColor, tint, ACCENT, 0.4);
    mixInto(lighting.groundColor, INK, VIOLET, 0.4);
    mixInto(lighting.fogColor, INK, VIOLET, 0.08);
    lighting.fogDensity = 0.01;
    mixInto(bg(lighting), INK, VIOLET, 0.05);
    mixInto(lighting.shadowColor, DEEP, VIOLET, 0.25);
    lighting.shadowStrength = 0.4;
    lighting.poolStrength = 0;
  });

  const reach = fitDistance(ctx.camera, 72) / 72;

  // ── Dome: a deep gradient with a dusting of far stars.
  const dome = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(72 * reach, 28, 18)),
    makeShader(
      assets,
      {
        uLow: assets.uColor((c) => mixInto(c, INK, VIOLET, 0.13)),
        uHigh: assets.uColor((c) => mixInto(c, INK, PRIMARY, 0.1)),
        uStar: assets.uColor((c) => mixInto(c, WHITE, ICE, 0.3)),
      },
      VERT_DOME,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uLow, uHigh, uStar;
      uniform float uOpacity;
      varying vec3 vDir;
      varying vec2 vUv;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uLow, uHigh, pow(h, 1.25));
        col *= 0.85 + 0.30 * vNoise3(vDir * 2.4);
        float dust = smoothstep(0.972, 1.0, vNoise3(vDir * 190.0));
        col += uStar * dust * 0.5 * uRoomSpark;
        gl_FragColor = vec4(col, uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, depthWrite: false },
    ),
  );
  dome.renderOrder = -10;
  assets.add(dome);

  // ── Curtains. All placement lives in the vertex shader, so five ribbons of
  //    3 000 triangles each cost one draw call and no CPU work.
  const ribbonGeo = assets.geom(new THREE.PlaneGeometry(1, 1, 56, 22));
  const ribbonMat = makeShader(
    assets,
    {
      uTime,
      // Normal-blended over a pale sky the curtains are coverage rather than
      // light, so they need a touch more of it to hold the same presence.
      uStrength: assets.uScalar(() => 0.3 * (1 + 0.5 * roomLightness)),
      // …and they must not be darkened towards black on the way, or a
      // watercolour sky turns into a bruise.
      uBody: assets.uScalar(() => 0.42 + 0.4 * roomLightness),
    },
    /* glsl */ `
      attribute vec4 aParams;
      attribute vec2 aSeed;
      attribute vec3 aColA;
      attribute vec3 aColB;
      uniform float uTime;
      varying vec2 vRib;
      varying vec3 vColA;
      varying vec3 vColB;
      varying float vFold;
      void main() {
        float u = position.x + 0.5;
        float v = position.y + 0.5;
        vRib = vec2(u, v);
        vColA = aColA;
        vColB = aColB;

        float radius = aParams.x;
        float span = aParams.y;
        float height = aParams.z;
        float baseY = aParams.w;
        float phase = aSeed.x;
        float bearing = aSeed.y;

        float fold = sin(u * 10.05 + uTime * 0.20 + phase * 4.0) * 0.52
                   + sin(u * 19.48 - uTime * 0.14 + phase * 7.0) * 0.26
                   + sin(u * 4.40 + uTime * 0.085) * 0.88;
        vFold = fold;

        float ang = bearing + (u - 0.5) * span;
        float r = radius * (1.0 + fold * 0.055 + v * 0.03);
        float y = baseY + v * height + sin(u * 6.91 + uTime * 0.10 + phase) * height * 0.09;
        vec3 pos = vec3(sin(ang) * r, y, cos(ang) * r);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    /* glsl */ `
      ${GLSL_NOISE}
      uniform float uTime, uStrength, uBody, uOpacity;
      varying vec2 vRib;
      varying vec3 vColA;
      varying vec3 vColB;
      varying float vFold;
      void main() {
        float u = vRib.x;
        float v = vRib.y;
        // A long ramp at the base: a hard bottom edge turns the gap between two
        // curtains into a rectangular hole in the sky.
        float base = smoothstep(0.0, 0.22, v);
        float top = 1.0 - smoothstep(0.32, 1.0, v);
        float ends = smoothstep(0.0, 0.16, u) * (1.0 - smoothstep(0.84, 1.0, u));

        // Vertical rays: the structure that makes an aurora read as an aurora.
        float rays = vFbm2(vec2(u * 34.0 + uTime * 0.025, v * 1.1));
        rays = 0.28 + 0.85 * smoothstep(0.34, 0.76, rays);
        // Folds facing us are brighter, as curtains stack in depth.
        float facing = 0.62 + 0.38 * clamp(vFold * 0.6 + 0.5, 0.0, 1.0);

        float a = base * top * ends * rays * facing * uStrength;
        // Keep the ramp saturated: additive light that runs past 1.0 washes to
        // white, and a white aurora is just a light shaft.
        // Hold the mint base over most of the curtain and let only the fray go
        // violet — an early crossover averages the two into grey.
        vec3 col = mix(vColA, vColB, pow(v, 1.6));
        gl_FragColor = vec4(col * (uBody + 0.30 * rays), a * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    { side: THREE.DoubleSide, light: "emit", depthWrite: false },
  );
  const ribbons = new THREE.InstancedMesh(ribbonGeo, ribbonMat, AURORA_RIBBONS.length);
  ribbons.frustumCulled = false;
  const params: number[] = [];
  const seeds: number[] = [];
  const colA = new Float32Array(AURORA_RIBBONS.length * 3);
  const colB = new Float32Array(AURORA_RIBBONS.length * 3);
  const identity = new THREE.Matrix4();
  const rampLow = new THREE.Color();
  const tone = new THREE.Color();
  AURORA_RIBBONS.forEach(([radius, span, height, baseY, phase, bearing], i) => {
    ribbons.setMatrixAt(i, identity);
    params.push(radius * reach, span, height * reach, baseY * reach);
    seeds.push(phase, bearing);
  });
  ribbons.instanceMatrix.needsUpdate = true;
  instanceAttr(ribbonGeo, "aParams", params, 4);
  instanceAttr(ribbonGeo, "aSeed", seeds, 2);
  const aColA = instanceAttr(ribbonGeo, "aColA", colA, 3);
  const aColB = instanceAttr(ribbonGeo, "aColB", colB, 3);
  // Mint at the base through teal to violet at the fray — kept saturated,
  // because additive light that runs past 1.0 washes the hue straight out, and
  // because over a pale sky the saturation is the whole of the effect.
  assets.themed(() => {
    mixInto(rampLow, tint, ACCENT, 0.6);
    for (let i = 0; i < AURORA_RIBBONS.length; i++) {
      const ca = AURORA_RIBBONS[i][6];
      const cb = AURORA_RIBBONS[i][7];
      mixInto(tone, MINT, rampLow, ca);
      colA[i * 3] = tone.r;
      colA[i * 3 + 1] = tone.g;
      colA[i * 3 + 2] = tone.b;
      mixInto(tone, rampLow, VIOLET, cb);
      colB[i * 3] = tone.r;
      colB[i * 3 + 1] = tone.g;
      colB[i * 3 + 2] = tone.b;
    }
    aColA.needsUpdate = true;
    aColB.needsUpdate = true;
  });
  assets.add(ribbons);

  // ── Particulate.
  const moteCount = 850;
  const motePos = new Float32Array(moteCount * 3);
  const moteScale = new Float32Array(moteCount);
  const motePhase = new Float32Array(moteCount);
  const moteColor = new Float32Array(moteCount * 3);
  const moteTone = new THREE.Color();
  const dir = new THREE.Vector3();
  const moteGeo = assets.geom(new THREE.BufferGeometry());
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute("aScale", new THREE.BufferAttribute(moteScale, 1));
  moteGeo.setAttribute("aPhase", new THREE.BufferAttribute(motePhase, 1));
  moteGeo.setAttribute("aColor", new THREE.BufferAttribute(moteColor, 3));
  assets.themed(() => {
    const rand = mulberry32(0xa0f0a0);
    for (let i = 0; i < moteCount; i++) {
      goldenSphere(i, moteCount, dir);
      const radius = 2.5 + Math.pow(rand(), 0.6) * 22;
      motePos[i * 3] = dir.x * radius;
      motePos[i * 3 + 1] = -18 + rand() * 36;
      motePos[i * 3 + 2] = dir.z * radius;
      moteScale[i] = 0.35 + Math.pow(rand(), 3) * 2.6;
      motePhase[i] = rand();
      mixInto(moteTone, tint, WHITE, 0.25 + rand() * 0.6);
      const gain = 0.35 + rand() * 0.65;
      moteColor[i * 3] = moteTone.r * gain;
      moteColor[i * 3 + 1] = moteTone.g * gain;
      moteColor[i * 3 + 2] = moteTone.b * gain;
    }
    moteGeo.attributes.aColor.needsUpdate = true;
  });
  const pixel = Math.min(2, Math.max(1, ctx.renderer.getPixelRatio()));
  const motes = new THREE.Points(
    moteGeo,
    makeShader(
      assets,
      { uTime, uSize: { value: 7 * pixel } },
      /* glsl */ `
      attribute float aScale;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime, uSize;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vColor = aColor;
        vec3 p = position;
        // Seamless vertical drift: wraps through a 36 m column.
        p.y = mod(p.y + uTime * 0.14 + aPhase * 36.0 + 18.0, 36.0) - 18.0;
        float sway = aPhase * 6.2831853;
        p.x += sin(uTime * 0.10 + sway) * 0.45;
        p.z += cos(uTime * 0.083 + sway) * 0.45;
        vFade = 1.0 - smoothstep(11.0, 17.5, abs(p.y));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * aScale * (9.0 / max(-mv.z, 0.5)), 1.0, 26.0);
      }
    `,
      /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, d);
        core *= core;
        gl_FragColor = vec4(vColor, core * vFade * 0.75 * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { light: "spark", depthWrite: false },
    ),
  );
  motes.frustumCulled = false;
  assets.add(motes);

  return scene(assets, lighting, uTime);
}
