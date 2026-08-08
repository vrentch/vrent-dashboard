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
import { hex, palette, seatColors, text as brandText } from "../../shared/brand.ts";
import { mulberry32 } from "../../shared/game.ts";

// ── Brand colours, parsed once ──────────────────────────────────────────────

const INK = new THREE.Color(hex(palette.ink));
const SURFACE = new THREE.Color(hex(palette.surface));
const SURFACE_ALT = new THREE.Color(hex(palette.surfaceAlt));
const PRIMARY = new THREE.Color(hex(palette.primary));
const ACCENT = new THREE.Color(hex(palette.accent));
const REWARD = new THREE.Color(hex(palette.reward));
const WHITE = new THREE.Color(hex(brandText.onPrimary));
const PAPER = new THREE.Color(hex(brandText.primary));
const VIOLET = new THREE.Color(hex(seatColors[3]));
const MINT = new THREE.Color(hex(seatColors[5]));
const ICE = new THREE.Color(hex(seatColors[7]));

/**
 * `a` blended `k` of the way towards `b`, as a fresh colour.
 *
 * Mixed in sRGB rather than in the linear working space, because every use of
 * this is art direction: "an ink surface with a tenth of the room tint in it"
 * should look like a tenth. A linear blend with a saturated accent lands two to
 * three times stronger than the number reads, and five rooms tinted that way
 * all come out as one loud colour.
 */
function mixColor(a: THREE.Color, b: THREE.Color, k: number): THREE.Color {
  const from = a.clone().convertLinearToSRGB();
  const to = b.clone().convertLinearToSRGB();
  return from.lerp(to, k).convertSRGBToLinear();
}

// ── Shared scene bookkeeping ────────────────────────────────────────────────

interface FadeEntry {
  material: THREE.Material;
  base: number;
  uniform: THREE.IUniform | null;
}

/**
 * Owns every GPU resource a scene allocates, drives the cross-fade opacity and
 * frees the lot in one call. Nothing in an environment may create a geometry,
 * material or texture without handing it to one of these.
 */
export class SceneAssets {
  readonly root = new THREE.Group();

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly fading: FadeEntry[] = [];
  private disposed = false;

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
}

/** A fade-aware `ShaderMaterial`. Every scene material goes through here. */
export function makeShader(
  assets: SceneAssets,
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
  options: ShaderOptions = {},
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, ...uniforms },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: options.depthWrite ?? true,
    depthTest: options.depthTest ?? true,
    side: options.side ?? THREE.FrontSide,
    blending: options.blending ?? THREE.NormalBlending,
    fog: false,
  });
  return assets.mat(material);
}

/** Attaches a per-instance float attribute. */
function instanceAttr(
  geometry: THREE.BufferGeometry,
  name: string,
  values: readonly number[],
  itemSize = 1,
): void {
  geometry.setAttribute(
    name,
    new THREE.InstancedBufferAttribute(new Float32Array(values), itemSize),
  );
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
 * A sane room lighting rig derived from the catalogue entry. Scenes start here
 * and override only what their art direction needs, so `ambient`, `key` and
 * `tint` in `environments.ts` always mean something.
 */
export function defaultLighting(spec: EnvironmentSpec, tint: THREE.Color): SceneLighting {
  return {
    keyDirection: new THREE.Vector3(0.42, 0.8, 0.44).normalize(),
    keyColor: mixColor(WHITE, tint, 0.2),
    keyScale: 1,
    skyColor: mixColor(tint, WHITE, 0.32),
    groundColor: mixColor(INK, tint, 0.2),
    ambientScale: 1,
    fogColor: mixColor(INK, tint, 0.1),
    fogDensity: spec.floor ? 0.05 : 0.012,
    background: mixColor(INK, tint, 0.06),
    shadowColor: mixColor(INK, tint, 0.14),
    shadowStrength: 0.55,
    poolStrength: spec.floor ? 1 : 0,
  };
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

const VAULT_RADIUS = 3.95;
const VAULT_SPRING = 1.35;
const VAULT_LENGTH = 30;
const VAULT_BAYS = 14;

function neonVault(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets();
  assets.root.name = "env-neon-vault";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  lighting.keyDirection.set(0.28, 0.9, 0.34).normalize();
  lighting.keyColor = mixColor(WHITE, tint, 0.35);
  lighting.skyColor = mixColor(tint, WHITE, 0.15);
  lighting.groundColor = mixColor(INK, tint, 0.3);
  lighting.fogColor = mixColor(INK, tint, 0.12);
  // Dense enough that both ends of the vault fall away into the dark rather
  // than reading as two lit portals.
  lighting.fogDensity = 0.115;
  lighting.background = mixColor(INK, tint, 0.03);
  lighting.shadowStrength = 0.62;

  const fogColor = lighting.fogColor;
  const stripY = VAULT_SPRING + 0.05;
  const stripX = VAULT_RADIUS - 0.22;

  // ── Shell: one cylinder, all the ribbing in the fragment shader.
  const shellGeo = assets.geom(
    new THREE.CylinderGeometry(VAULT_RADIUS, VAULT_RADIUS, VAULT_LENGTH, 48, 1, true),
  );
  const shell = new THREE.Mesh(
    shellGeo,
    makeShader(
      assets,
      {
        uBase: { value: mixColor(SURFACE, INK, 0.55) },
        uTint: { value: tint },
        uFog: { value: fogColor },
        uFogDensity: { value: lighting.fogDensity },
        uTime,
        uBays: { value: VAULT_BAYS },
        uStripY: { value: stripY },
        uRadius: { value: VAULT_RADIUS },
      },
      VERT_WORLD,
      /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uBase, uTint, uFog;
      uniform float uFogDensity, uTime, uBays, uStripY, uRadius, uOpacity;
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

        // Cove light bleeding out of the strips at the springing line.
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 - vW.z * 0.20);
        pulse *= pulse;
        float side = smoothstep(0.28, 0.90, abs(vW.x) / uRadius);
        float bleed = exp(-abs(vW.y - uStripY) * 1.7) * side;
        col += uTint * bleed * (0.14 + 0.42 * pulse) * (0.45 + 0.55 * relief);

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
      color: mixColor(SURFACE_ALT, INK, 0.4),
      roughness: 0.66,
      metalness: 0.3,
      // A trace of self-illumination so the arches catch the cove light rather
      // than reading as black cut-outs against the glowing shell.
      emissive: mixColor(INK, tint, 0.35),
      emissiveIntensity: 0.55,
    }),
  );
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
  const stripGeo = assets.geom(new THREE.BoxGeometry(0.07, 0.11, bayLength - 0.4));
  const stripPhase: number[] = [];
  const stripCount = VAULT_BAYS * 2;
  const strips = new THREE.InstancedMesh(
    stripGeo,
    makeShader(
      assets,
      {
        uTime,
        uTint: { value: tint },
        uHot: { value: mixColor(tint, WHITE, 0.72) },
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
        float r = length(vec2(vLocal.x / 0.035, vLocal.y / 0.055));
        float core = 1.0 - smoothstep(0.82, 1.48, r);
        float ends = 1.0 - smoothstep(0.74, 1.0, abs(vLocal.z) / ${((bayLength - 0.4) / 2).toFixed(3)});
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 + vPhase);
        pulse = 0.34 + 0.66 * pulse * pulse;
        vec3 col = mix(uTint, uHot, core * core);
        gl_FragColor = vec4(col, core * ends * pulse * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { blending: THREE.AdditiveBlending, depthWrite: false },
    ),
    stripCount,
  );
  strips.frustumCulled = false;
  for (let i = 0; i < VAULT_BAYS; i++) {
    const z = -VAULT_LENGTH / 2 + (i + 0.5) * bayLength;
    for (let s = 0; s < 2; s++) {
      const index = i * 2 + s;
      strips.setMatrixAt(index, m4.makeTranslation(s === 0 ? -stripX : stripX, stripY, z));
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
      { uTime, uTint: { value: mixColor(tint, WHITE, 0.25) }, uStrength: { value: 0.1 } },
      /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        vUv = uv;
        vPhase = aPhase;
        vec4 centre = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          centre = instanceMatrix * centre;
        #endif
        centre = modelViewMatrix * centre;
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
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float mask = 1.0 - smoothstep(0.15, 1.0, d);
        mask *= mask;
        float n = vFbm2(vUv * 2.6 + vec2(uTime * 0.017 + vPhase, uTime * 0.011));
        gl_FragColor = vec4(uTint * (0.45 + 0.55 * n), mask * (0.3 + 0.7 * n) * uStrength * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { blending: THREE.AdditiveBlending, depthWrite: false },
    ),
    hazeCount,
  );
  haze.frustumCulled = false;
  for (let i = 0; i < hazeCount; i++) {
    const z = -11 + i * 4.4;
    haze.setMatrixAt(i, m4.makeTranslation(i % 2 === 0 ? -1.6 : 1.8, 0.7, z));
    hazeSize.push(5.5 + (i % 3) * 1.2);
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
        uBase: { value: mixColor(INK, SURFACE, 0.6) },
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
        col += uTint * line * 0.045;

        // The cove strips mirrored in the polish: a soft band at |x| = stripX,
        // pulsing in step with the real ones.
        float pulse = 0.5 + 0.5 * sin(uTime * 0.5 - p.y * 0.20);
        pulse *= pulse;
        float dx = abs(abs(p.x) - uStripX);
        float refl = exp(-dx * dx * 3.2);
        float ripple = 0.72 + 0.28 * vNoise2(vec2(p.x * 2.0, p.y * 0.5 - uTime * 0.05));
        col += uTint * refl * ripple * (0.16 + 0.46 * pulse);

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
const PLANET_RADIUS = 130;
const PLANET_CENTRE = new THREE.Vector3(0, -70, -200);

function orbitalDeck(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets();
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
  lighting.keyDirection.copy(sun);
  lighting.keyColor = mixColor(WHITE, REWARD, 0.08);
  lighting.keyScale = 1;
  lighting.skyColor = mixColor(tint, INK, 0.45);
  // Bounce off the planet, so undersides pick up the world below.
  lighting.groundColor = mixColor(tint, ICE, 0.35);
  lighting.ambientScale = 1;
  lighting.fogColor = INK.clone();
  lighting.fogDensity = 0.004;
  // Space is black. Anything else and the stars stop reading as stars.
  lighting.background = mixColor(INK, PRIMARY, 0.015);
  lighting.shadowColor = mixColor(INK, PRIMARY, 0.1);
  lighting.shadowStrength = 0.7;

  // ── Starfield with a deliberate galactic band.
  const starCount = 1500;
  const starPos = new Float32Array(starCount * 3);
  const starColor = new Float32Array(starCount * 3);
  const starScale = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const dir = new THREE.Vector3();
  const bandAxis = new THREE.Vector3(0.34, 0.79, -0.51).normalize();
  const starTone = new THREE.Color();
  const rand = mulberry32(0x5eed01);
  for (let i = 0; i < starCount; i++) {
    goldenSphere(i, starCount, dir);
    starPos[i * 3] = dir.x * starShell;
    starPos[i * 3 + 1] = dir.y * starShell;
    starPos[i * 3 + 2] = dir.z * starShell;
    const band = Math.exp(-Math.pow(dir.dot(bandAxis), 2) * 15);
    const r = rand();
    const bright = 0.28 + band * 0.55 + r * r * 0.5;
    starTone.copy(ICE).lerp(WHITE, rand());
    if (rand() > 0.93) starTone.lerp(REWARD, 0.55);
    starColor[i * 3] = starTone.r * bright;
    starColor[i * 3 + 1] = starTone.g * bright;
    starColor[i * 3 + 2] = starTone.b * bright;
    starScale[i] = 0.55 + band * 0.5 + Math.pow(rand(), 9) * 2.2;
    starPhase[i] = rand() * 6.2831853;
  }
  const starGeo = assets.geom(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aColor", new THREE.BufferAttribute(starColor, 3));
  starGeo.setAttribute("aScale", new THREE.BufferAttribute(starScale, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
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
      { blending: THREE.AdditiveBlending, depthWrite: false },
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
        uOcean: { value: mixColor(PRIMARY, INK, 0.62) },
        uShallow: { value: mixColor(PRIMARY, ACCENT, 0.45) },
        uLand: { value: mixColor(SURFACE_ALT, ACCENT, 0.22) },
        uIce: { value: mixColor(PAPER, ICE, 0.25) },
        uCity: { value: REWARD },
        uAtmo: { value: mixColor(tint, ICE, 0.4) },
        uTerm: { value: mixColor(REWARD, tint, 0.35) },
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

        vec3 col = surface * (0.035 + 1.10 * lit);
        col = mix(col, uIce * (0.08 + 1.0 * lit), cloud * 0.72);
        col += uTerm * term * 0.30 * (1.0 - cloud * 0.55);

        // City glow, night side only. The branch is coherent across the disc.
        float night = 1.0 - smoothstep(-0.03, 0.14, ndl);
        if (night > 0.01) {
          float sparks = smoothstep(0.855, 0.995, vNoise3(p * 46.0));
          col += uCity * sparks * land * (1.0 - cloud) * night * 0.5;
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
      { uSun: { value: sun }, uAtmo: { value: mixColor(tint, ICE, 0.5) } },
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
      { side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false },
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
        uCore: { value: WHITE },
        uHalo: { value: mixColor(REWARD, WHITE, 0.5) },
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
      { blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false },
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
        uBase: { value: mixColor(SURFACE, INK, 0.35) },
        uTint: { value: tint },
        uSun: { value: sun },
        uEdge: { value: mixColor(tint, WHITE, 0.35) },
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

        // 24 radial bays with recessed seams, plus concentric rings.
        float bay = a01 * 24.0;
        float seam = 1.0 - smoothstep(0.0, fwidth(bay) * 1.5 + 0.03, abs(fract(bay) - 0.5) - 0.44);
        float ring = 1.0 - smoothstep(0.0, fwidth(r) * 1.5 + 0.02, abs(fract(r * 0.5) - 0.5) - 0.46);

        // Brushed finish. Frequency is measured along the arc, not in angle —
        // otherwise it collapses into a starburst at the centre of the plate.
        float brush = (vNoise2(vec2(ang * max(r, 0.35) * 26.0, r * 1.6)) - 0.5) * 0.13;
        vec3 col = uBase * (0.80 + brush);
        col *= mix(1.0, 0.46, max(seam, ring * 0.6));

        // Hard sun grazing the plate.
        vec3 lateral = normalize(vec3(p.x, 0.0, p.y) + 1e-5);
        float graze = pow(max(dot(lateral, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 6.0);
        col += uEdge * graze * (0.05 + brush * 0.35);

        // Glowing rim and a soft pool of deck light under the board.
        float rim = exp(-abs(r - ${(DECK_RADIUS - 0.14).toFixed(2)}) * 18.0);
        col += uEdge * rim * (0.60 + 0.22 * sin(uTime * 0.4));
        col += uTint * exp(-r * r * 0.09) * 0.11;

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
      { uBase: { value: mixColor(SURFACE, INK, 0.6) }, uEdge: { value: mixColor(tint, WHITE, 0.3) } },
      VERT_WORLD,
      /* glsl */ `
      uniform vec3 uBase, uEdge;
      uniform float uOpacity;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        float band = 1.0 - smoothstep(0.0, 0.10, abs(vUv.y - 0.86));
        vec3 col = uBase * (0.30 + 0.55 * vUv.y);
        col += uEdge * band * 0.35;
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
    new THREE.MeshStandardMaterial({
      color: mixColor(SURFACE_ALT, PAPER, 0.18),
      roughness: 0.3,
      metalness: 0.85,
    }),
  );
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
  const assets = new SceneAssets();
  assets.root.name = "env-quantum-lab";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  // Bright, but a stop or two below paper white: shafts of light only read
  // against something they can be brighter than, and a full-white room in a
  // headset is fatiguing after two minutes.
  const paper = mixColor(INK, PAPER, 0.62);
  const lighting = defaultLighting(ctx.spec, tint);
  lighting.keyDirection.set(0.2, 0.94, 0.28).normalize();
  lighting.keyColor = mixColor(WHITE, tint, 0.1);
  lighting.skyColor = mixColor(PAPER, tint, 0.22);
  lighting.groundColor = mixColor(PAPER, tint, 0.1);
  lighting.fogColor = mixColor(paper, tint, 0.16);
  lighting.fogDensity = 0.055;
  lighting.background = mixColor(paper, tint, 0.12);
  lighting.shadowColor = mixColor(INK, tint, 0.3);
  lighting.shadowStrength = 0.34;

  const shaftUniform = LAB_SHAFTS.map(([x, z]) => new THREE.Vector2(x, z));

  // ── Dome: soft gradient plus a lattice of ceiling panels overhead.
  const dome = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(30, 32, 20)),
    makeShader(
      assets,
      {
        uHorizon: { value: mixColor(paper, tint, 0.2) },
        uZenith: { value: mixColor(PAPER, WHITE, 0.35) },
        uSeam: { value: mixColor(paper, tint, 0.55).multiplyScalar(0.55) },
      },
      VERT_DOME,
      /* glsl */ `
      uniform vec3 uHorizon, uZenith, uSeam;
      uniform float uOpacity;
      varying vec3 vDir;
      varying vec2 vUv;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.8));
        col = mix(col * 0.74, col, smoothstep(0.30, 0.54, h));

        // Ceiling light panels, projected onto a plane above the room.
        if (vDir.y > 0.10) {
          vec2 q = vDir.xz / max(vDir.y, 0.12) * 0.5;
          vec2 g = abs(fract(q) - 0.5);
          float seam = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y) - 0.03);
          float k = smoothstep(0.10, 0.42, vDir.y);
          col = mix(col, uZenith * 1.12, (1.0 - seam) * 0.30 * k);
          col = mix(col, uSeam, seam * 0.7 * k);
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
        uBase: { value: mixColor(paper, PAPER, 0.55) },
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

        // Where the shafts land.
        for (int i = 0; i < ${LAB_SHAFTS.length}; i++) {
          float d = length(p - uShafts[i]);
          float breathe = 0.85 + 0.15 * sin(uTime * 0.33 + float(i) * 1.7);
          col += uTint * exp(-d * d * 0.30) * 0.16 * breathe;
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
  const shaftGeo = assets.geom(new THREE.CylinderGeometry(0.3, 1.85, 6.4, 20, 1, true));
  const shafts = new THREE.InstancedMesh(
    shaftGeo,
    makeShader(
      assets,
      { uTime, uTint: { value: mixColor(WHITE, tint, 0.28) }, uStrength: { value: 0.34 } },
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
        float along = mix(0.18, 1.0, vUv.y);
        along *= 1.0 - smoothstep(0.93, 1.0, vUv.y);
        float breathe = 0.82 + 0.18 * sin(uTime * 0.31 + vPhase);
        gl_FragColor = vec4(uTint, body * along * breathe * uStrength * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false },
    ),
    LAB_SHAFTS.length,
  );
  shafts.frustumCulled = false;
  const shaftPhase: number[] = [];
  const m4 = new THREE.Matrix4();
  LAB_SHAFTS.forEach(([x, z], i) => {
    shafts.setMatrixAt(i, m4.makeTranslation(x, 3.15, z));
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
      uBase: { value: mixColor(PAPER, WHITE, 0.5) },
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
        col += uTint * fres * 0.65;
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
  const ringMat = makeShader(
    assets,
    { uTime, uTint: { value: mixColor(tint, WHITE, 0.2) } },
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
        gl_FragColor = vec4(uTint, vFade * 0.85 * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    { blending: THREE.AdditiveBlending, depthWrite: false },
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
  const frame = new THREE.LineSegments(
    frameGeo,
    assets.mat(
      new THREE.LineBasicMaterial({
        color: mixColor(tint, INK, 0.15),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    ),
  );
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

const GLASS_RADIUS = 8.5;

function cyberAtrium(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets();
  assets.root.name = "env-cyber-atrium";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  lighting.keyDirection.set(-0.42, 0.72, 0.55).normalize();
  lighting.keyColor = mixColor(WHITE, tint, 0.42);
  lighting.skyColor = mixColor(tint, PRIMARY, 0.35);
  lighting.groundColor = mixColor(INK, VIOLET, 0.28);
  lighting.fogColor = mixColor(INK, VIOLET, 0.14);
  lighting.fogDensity = 0.055;
  lighting.background = mixColor(INK, VIOLET, 0.05);
  lighting.shadowColor = mixColor(INK, VIOLET, 0.2);
  lighting.shadowStrength = 0.6;

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
        uSky: { value: mixColor(INK, VIOLET, 0.07) },
        uHaze: { value: mixColor(INK, tint, 0.16) },
        uBlock: { value: mixColor(INK, SURFACE, 0.5) },
        uWindow: { value: mixColor(REWARD, WHITE, 0.15) },
        uWindowAlt: { value: mixColor(tint, WHITE, 0.2) },
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
          float lit = step(0.80, vHash12(wc));
          float flicker = step(0.988, vHash12(wc + floor(uTime * 2.0)));
          vec3 windowColor = mix(uWindow, uWindowAlt, step(0.55, vHash12(wc + 3.7)));
          block += windowColor * lit * (0.20 + 0.35 * flicker) * mix(0.55, 1.0, f);

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
  const rand = mulberry32(0xc0ffee);
  const bokehTone = new THREE.Color();
  for (let i = 0; i < bokehCount; i++) {
    const a = rand() * Math.PI * 2;
    const radius = 12 + rand() * 11;
    bokehPos[i * 3] = Math.cos(a) * radius;
    bokehPos[i * 3 + 1] = -3.5 + Math.pow(rand(), 1.35) * 16;
    bokehPos[i * 3 + 2] = Math.sin(a) * radius;
    bokehTone.copy(signColors[i % signColors.length]).lerp(WHITE, 0.1 + rand() * 0.25);
    const gain = 0.35 + rand() * 0.65;
    bokehCol[i * 3] = bokehTone.r * gain;
    bokehCol[i * 3 + 1] = bokehTone.g * gain;
    bokehCol[i * 3 + 2] = bokehTone.b * gain;
    bokehScale[i] = 0.5 + Math.pow(rand(), 2) * 2.4;
    bokehPhase[i] = rand() * 6.2831853;
  }
  const bokehGeo = assets.geom(new THREE.BufferGeometry());
  bokehGeo.setAttribute("position", new THREE.BufferAttribute(bokehPos, 3));
  bokehGeo.setAttribute("aColor", new THREE.BufferAttribute(bokehCol, 3));
  bokehGeo.setAttribute("aScale", new THREE.BufferAttribute(bokehScale, 1));
  bokehGeo.setAttribute("aPhase", new THREE.BufferAttribute(bokehPhase, 1));
  const pixel = Math.min(2, Math.max(1, ctx.renderer.getPixelRatio()));
  const bokeh = new THREE.Points(
    bokehGeo,
    makeShader(
      assets,
      { uTime, uSize: { value: 20 * pixel } },
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
        gl_PointSize = clamp(uSize * aScale * (14.0 / max(-mv.z, 1.0)), 2.0, 90.0);
      }
    `,
      /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vGain;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        // A real out-of-focus highlight: flat core, slightly brighter rim.
        float disc = 1.0 - smoothstep(0.80, 1.0, d);
        float rim = smoothstep(0.55, 0.94, d) * 0.5;
        float a = disc * (0.55 + rim);
        gl_FragColor = vec4(vColor, a * vGain * 0.6 * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { blending: THREE.AdditiveBlending, depthWrite: false },
    ),
  );
  bokeh.frustumCulled = false;
  assets.add(bokeh);

  // ── Structure: columns framing the atrium, and a dark roof.
  const columnMat = assets.mat(
    new THREE.MeshStandardMaterial({
      color: mixColor(SURFACE, INK, 0.55),
      roughness: 0.55,
      metalness: 0.5,
    }),
  );
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
      { uBase: { value: mixColor(INK, SURFACE, 0.3) }, uTint: { value: tint } },
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
        col += uTint * exp(-r * 0.6) * 0.12;
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
        uBase: { value: mixColor(INK, SURFACE, 0.35) },
        uTint: { value: tint },
        uFog: { value: lighting.fogColor },
        uFogDensity: { value: lighting.fogDensity },
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
        float band = exp(-pow((lf - 0.5) * 4.2, 2.0));
        float reach = smoothstep(1.4, 7.6, r);
        float ripple = 0.62 + 0.38 * vNoise2(vec2(a01 * 120.0, r * 1.8 - uTime * 0.16));
        float strength = pow(vHash12(vec2(li, 6.0)), 2.5);
        col += signCol * band * reach * ripple * strength * 0.55;

        // A cool sheen so the stone still reads as stone.
        col += uTint * exp(-r * 0.5) * 0.04;
        col = depthFade(col, vW, uFog, uFogDensity);
        gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(7.4, 8.9, r)));
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
        uTint: { value: mixColor(tint, WHITE, 0.15) },
        uHot: { value: mixColor(WHITE, tint, 0.25) },
        uMullion: { value: mixColor(INK, SURFACE_ALT, 0.5) },
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
        vec2 rc = vec2(vUv.x * 70.0, vUv.y * 2.4);
        float column = floor(rc.x);
        float cf = fract(rc.x);
        float active = step(0.42, vHash12(vec2(column, 17.0)));
        float speed = 0.16 + vHash12(vec2(column, 1.0)) * 0.55;
        float y = fract(rc.y + uTime * speed + vHash12(vec2(column, 7.0)) * 9.0);
        float width = 0.22 + vHash12(vec2(column, 3.0)) * 0.30;
        float lateral = exp(-pow(abs(cf - 0.5) * 2.0 / width, 2.0) * 3.4);
        float head = exp(-pow((y - 0.34) * 46.0, 2.0));
        float tail = exp(-max(y - 0.34, 0.0) * 3.6) * step(0.34, y) * 0.55;
        float runnel = lateral * (head * 1.4 + tail) * active;

        // Beads clinging between the runnels — small, and only a few of them.
        vec2 gc = vec2(vUv.x * 150.0, vUv.y * 42.0);
        vec2 gi = floor(gc);
        vec2 gf = fract(gc) - 0.5;
        vec2 jitter = vec2(vHash12(gi), vHash12(gi + 41.0)) - 0.5;
        float rad = 0.05 + vHash12(gi + 9.0) * 0.13;
        float bead = smoothstep(rad, rad * 0.25, length((gf - jitter * 0.7) * vec2(1.0, 1.5)));
        bead *= step(0.55, vHash12(gi + 23.0));

        float wet = clamp(runnel + bead * 0.4, 0.0, 1.4);

        // Mullions, so the glass has structure behind the water.
        float mull = 1.0 - smoothstep(0.0, 0.012, abs(fract(vUv.x * 26.0) - 0.5) - 0.482);
        float transom = 1.0 - smoothstep(0.0, 0.010, abs(fract(vUv.y * 6.0) - 0.5) - 0.485);

        vec3 col = mix(uTint * 0.4, uHot, clamp(wet, 0.0, 1.0));
        float a = (0.022 + wet * 0.5) * uOpacity;
        col = mix(col, uMullion, max(mull, transom) * 0.9);
        a = max(a, max(mull, transom) * 0.5 * uOpacity);
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
  [26, 2.4, 15, -3.5, 0.0, Math.PI - 0.75, 0.0, 0.55],
  [34, 2.9, 21, -6.0, 1.7, Math.PI + 0.25, 0.35, 0.85],
  [20, 1.7, 12, -1.5, 3.4, Math.PI - 1.85, 0.15, 0.4],
  [41, 2.1, 25, -8.0, 5.1, Math.PI + 1.5, 0.6, 1.0],
  [29, 1.4, 17, -4.5, 2.4, 0.35, 0.05, 0.7],
];

function auroraVoid(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets();
  assets.root.name = "env-aurora-void";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting = defaultLighting(ctx.spec, tint);
  lighting.keyDirection.set(-0.3, 0.86, 0.42).normalize();
  lighting.keyColor = mixColor(WHITE, tint, 0.3);
  lighting.skyColor = mixColor(tint, ACCENT, 0.4);
  lighting.groundColor = mixColor(INK, VIOLET, 0.4);
  lighting.fogColor = mixColor(INK, VIOLET, 0.1);
  lighting.fogDensity = 0.01;
  lighting.background = mixColor(INK, VIOLET, 0.07);
  lighting.shadowColor = mixColor(INK, VIOLET, 0.25);
  lighting.shadowStrength = 0.4;
  lighting.poolStrength = 0;

  const reach = fitDistance(ctx.camera, 72) / 72;

  // ── Dome: a deep gradient with a dusting of far stars.
  const dome = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(72 * reach, 28, 18)),
    makeShader(
      assets,
      {
        uLow: { value: mixColor(INK, VIOLET, 0.14) },
        uHigh: { value: mixColor(INK, PRIMARY, 0.16) },
        uStar: { value: mixColor(WHITE, ICE, 0.3) },
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
        col += uStar * dust * 0.5;
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
    { uTime, uStrength: { value: 0.85 } },
    /* glsl */ `
      attribute vec4 aParams;
      attribute float aPhase;
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

        float fold = sin(u * 10.05 + uTime * 0.20 + aPhase * 4.0) * 0.52
                   + sin(u * 19.48 - uTime * 0.14 + aPhase * 7.0) * 0.26
                   + sin(u * 4.40 + uTime * 0.085) * 0.88;
        vFold = fold;

        float ang = (u - 0.5) * span + aPhase * 0.35;
        float r = radius * (1.0 + fold * 0.055 + v * 0.03);
        float y = baseY + v * height + sin(u * 6.91 + uTime * 0.10 + aPhase) * height * 0.09;
        vec3 pos = vec3(sin(ang) * r, y, cos(ang) * r);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    /* glsl */ `
      ${GLSL_NOISE}
      uniform float uTime, uStrength, uOpacity;
      varying vec2 vRib;
      varying vec3 vColA;
      varying vec3 vColB;
      varying float vFold;
      void main() {
        float u = vRib.x;
        float v = vRib.y;
        float base = smoothstep(0.0, 0.05, v);
        float top = 1.0 - smoothstep(0.30, 1.0, v);
        float ends = smoothstep(0.0, 0.13, u) * (1.0 - smoothstep(0.87, 1.0, u));

        // Vertical rays: the structure that makes an aurora read as an aurora.
        float rays = vFbm2(vec2(u * 34.0 + uTime * 0.025, v * 1.1));
        rays = 0.30 + 0.90 * smoothstep(0.34, 0.76, rays);
        // Folds facing us are brighter, as curtains stack in depth.
        float facing = 0.65 + 0.35 * clamp(vFold * 0.6 + 0.5, 0.0, 1.0);

        float a = base * top * ends * rays * facing * uStrength;
        vec3 col = mix(vColA, vColB, pow(v, 0.65));
        gl_FragColor = vec4(col * (0.55 + 0.65 * rays), a * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false },
  );
  const ribbons = new THREE.InstancedMesh(ribbonGeo, ribbonMat, AURORA_RIBBONS.length);
  ribbons.frustumCulled = false;
  const params: number[] = [];
  const phases: number[] = [];
  const colA: number[] = [];
  const colB: number[] = [];
  const identity = new THREE.Matrix4();
  const rampLow = mixColor(tint, ACCENT, 0.25);
  const rampHigh = mixColor(ACCENT, VIOLET, 0.7);
  const tone = new THREE.Color();
  AURORA_RIBBONS.forEach(([radius, span, height, baseY, phase, ca, cb], i) => {
    ribbons.setMatrixAt(i, identity);
    params.push(radius * reach, span, height * reach, baseY * reach);
    phases.push(phase);
    tone.copy(MINT).lerp(rampLow, ca);
    colA.push(tone.r, tone.g, tone.b);
    tone.copy(rampLow).lerp(rampHigh, cb);
    colB.push(tone.r, tone.g, tone.b);
  });
  ribbons.instanceMatrix.needsUpdate = true;
  instanceAttr(ribbonGeo, "aParams", params, 4);
  instanceAttr(ribbonGeo, "aPhase", phases);
  instanceAttr(ribbonGeo, "aColA", colA, 3);
  instanceAttr(ribbonGeo, "aColB", colB, 3);
  assets.add(ribbons);

  // ── Particulate.
  const moteCount = 850;
  const motePos = new Float32Array(moteCount * 3);
  const moteScale = new Float32Array(moteCount);
  const motePhase = new Float32Array(moteCount);
  const moteColor = new Float32Array(moteCount * 3);
  const rand = mulberry32(0xa0f0a0);
  const moteTone = new THREE.Color();
  const dir = new THREE.Vector3();
  for (let i = 0; i < moteCount; i++) {
    goldenSphere(i, moteCount, dir);
    const radius = 2.5 + Math.pow(rand(), 0.6) * 22;
    motePos[i * 3] = dir.x * radius;
    motePos[i * 3 + 1] = -18 + rand() * 36;
    motePos[i * 3 + 2] = dir.z * radius;
    moteScale[i] = 0.35 + Math.pow(rand(), 3) * 2.6;
    motePhase[i] = rand();
    moteTone.copy(tint).lerp(WHITE, 0.25 + rand() * 0.6);
    const gain = 0.35 + rand() * 0.65;
    moteColor[i * 3] = moteTone.r * gain;
    moteColor[i * 3 + 1] = moteTone.g * gain;
    moteColor[i * 3 + 2] = moteTone.b * gain;
  }
  const moteGeo = assets.geom(new THREE.BufferGeometry());
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute("aScale", new THREE.BufferAttribute(moteScale, 1));
  moteGeo.setAttribute("aPhase", new THREE.BufferAttribute(motePhase, 1));
  moteGeo.setAttribute("aColor", new THREE.BufferAttribute(moteColor, 3));
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
      { blending: THREE.AdditiveBlending, depthWrite: false },
    ),
  );
  motes.frustumCulled = false;
  assets.add(motes);

  return scene(assets, lighting, uTime);
}
