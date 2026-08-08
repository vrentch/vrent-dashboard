/**
 * 360° panorama environments.
 *
 * This is the tailoring hook: a client hands over their own equirectangular
 * photography and it becomes a playable room with no code change. Which means
 * this file has to behave impeccably on a stranger's images, over a conference
 * wifi, in front of a paying customer:
 *
 *   • the room is never empty — a tinted holding dome is up before the photo
 *     starts downloading, so there is no black void at any point;
 *   • a slow load gets a quiet, in-world loading state rather than a stall;
 *   • a broken or missing image resolves `ready` to `false`, and the controller
 *     cross-fades to the default procedural room instead;
 *   • when the photo does arrive it eases in rather than snapping;
 *   • the room's own light is measured off the photo, so the cards look like
 *     they are standing in that space rather than pasted over it.
 *
 * Sampling is done by hand rather than by handing the texture to
 * `scene.background`: three converts an equirect background into a PMREM cube,
 * which costs VRAM and visibly softens a client's photography. A sphere plus
 * `textureGrad` keeps it sharp, seam-free and mip-mapped.
 */

import * as THREE from "three";
import type { EnvScene, SceneContext, SceneLighting } from "./controller.ts";
import {
  SceneAssets,
  defaultLighting,
  makeShader,
  mixColor,
  fitDistance,
  GLSL_OUTPUT,
} from "./procedural.ts";
import { hex, palette, rgba, text as brandText, tokens } from "../../shared/brand.ts";

/** Give up on an image after this long — a demo cannot wait forever. */
const LOAD_TIMEOUT_MS = 15000;
/** Length of the photo's ease-in once it has decoded. */
const REVEAL_SEC = 0.8;

export interface PanoramaScene extends EnvScene {
  /** `true` once the photo is on screen, `false` if it could never be shown. */
  readonly ready: Promise<boolean>;
}

// ── URL handling ────────────────────────────────────────────────────────────

/**
 * Resolves a catalogue path against the app base. Absolute URLs, blob: URLs
 * (runtime uploads) and data: URLs are passed through untouched.
 */
export function resolvePanoramaUrl(src: string): string {
  if (/^(?:[a-z]+:|\/\/|\/)/i.test(src)) return src;
  const base = import.meta.env?.BASE_URL ?? "./";
  return base.endsWith("/") ? `${base}${src}` : `${base}/${src}`;
}

/**
 * Loads one equirectangular image. Rejects on network failure, on a decode
 * failure and on timeout, so every unhappy path lands in the same place.
 */
export function loadEquirectangular(
  url: string,
  anisotropy = 1,
  timeoutMs = LOAD_TIMEOUT_MS,
): Promise<THREE.Texture> {
  return new Promise<THREE.Texture>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`panorama timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    new THREE.TextureLoader().load(
      url,
      (texture) => {
        if (settled) {
          texture.dispose();
          return;
        }
        settled = true;
        clearTimeout(timer);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        // Wrap horizontally so the 0/1 seam interpolates instead of clamping.
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(`panorama failed to load: ${url}`));
      },
    );
  });
}

// ── Measuring the room's own light ──────────────────────────────────────────

interface PanoramaTone {
  sky: THREE.Color;
  ground: THREE.Color;
  average: THREE.Color;
}

/**
 * Averages the photo down to three colours — upper hemisphere, lower
 * hemisphere and overall — so the room lights the board with its own light.
 * These are measured off the customer's image, not invented.
 */
function measureTone(image: TexImageSource): PanoramaTone | null {
  const W = 32;
  const H = 16;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(image as CanvasImageSource, 0, 0, W, H);
    const data = g.getImageData(0, 0, W, H).data;

    let skyR = 0, skyG = 0, skyB = 0, skyN = 0;
    let gndR = 0, gndG = 0, gndB = 0, gndN = 0;
    for (let y = 0; y < H; y++) {
      // Weight by the cosine of latitude: an equirect over-samples the poles.
      const weight = Math.max(0.05, Math.sin(((y + 0.5) / H) * Math.PI));
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (y < H / 2) {
          skyR += data[i] * weight;
          skyG += data[i + 1] * weight;
          skyB += data[i + 2] * weight;
          skyN += weight;
        } else {
          gndR += data[i] * weight;
          gndG += data[i + 1] * weight;
          gndB += data[i + 2] * weight;
          gndN += weight;
        }
      }
    }
    if (skyN === 0 || gndN === 0) return null;

    const sky = new THREE.Color().setRGB(
      skyR / skyN / 255,
      skyG / skyN / 255,
      skyB / skyN / 255,
      THREE.SRGBColorSpace,
    );
    const ground = new THREE.Color().setRGB(
      gndR / gndN / 255,
      gndG / gndN / 255,
      gndB / gndN / 255,
      THREE.SRGBColorSpace,
    );
    const average = sky.clone().lerp(ground, 0.5);
    return { sky, ground, average };
  } catch {
    // A cross-origin image taints the canvas. Not fatal — fall back to the spec.
    return null;
  }
}

// ── Loading state ───────────────────────────────────────────────────────────

interface LoadingState {
  group: THREE.Group;
  setProgress(t: number): void;
  setFade(k: number): void;
}

/**
 * A small in-world card: the environment's name and an indeterminate progress
 * line. Drawn once into a canvas, animated by uniforms — nothing here redraws.
 */
function buildLoadingState(assets: SceneAssets, name: string, tint: THREE.Color): LoadingState {
  const group = new THREE.Group();
  group.name = "panorama-loading";

  const W = 512;
  const H = 132;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (g) {
    const radius = 18;
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.roundRect(2, 2, W - 4, H - 4, radius);
    g.fillStyle = rgba(palette.surface, 0.88);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = rgba(palette.accent, 0.28);
    g.stroke();

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = brandText.primary;
    g.font = `600 34px ${tokens.font.display}`;
    g.fillText(name, W / 2, H / 2 - 12, W - 56);

    g.fillStyle = brandText.muted;
    g.font = `500 17px ${tokens.font.body}`;
    g.fillText("PREPARING 360° ENVIRONMENT", W / 2, H / 2 + 26, W - 56);
  }

  const texture = assets.tex(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;

  const cardMat = assets.mat(
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
    false,
  );
  const card = new THREE.Mesh(assets.geom(new THREE.PlaneGeometry(0.46, 0.119)), cardMat);
  card.renderOrder = 900;
  group.add(card);

  const barUniforms: Record<string, THREE.IUniform> = {
    uProgress: { value: 0 },
    uTint: { value: tint },
    uTrack: { value: new THREE.Color(hex(palette.surfaceAlt)) },
  };
  const barMat = assets.mat(
    new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, ...barUniforms },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress, uOpacity;
        uniform vec3 uTint, uTrack;
        varying vec2 vUv;
        void main() {
          // An indeterminate sweep: a soft head chasing a short tail.
          float d = vUv.x - uProgress;
          d -= floor(d + 0.5);
          float lead = exp(-pow(max(d, 0.0) * 26.0, 2.0));
          float trail = exp(-max(-d, 0.0) * 9.0);
          float body = 1.0 - smoothstep(0.0, 1.0, abs(vUv.y - 0.5) * 2.0);
          vec3 col = mix(uTrack, uTint, clamp(lead + trail, 0.0, 1.0));
          float a = (0.35 + 0.65 * clamp(lead + trail, 0.0, 1.0)) * body * uOpacity;
          gl_FragColor = vec4(col, a);
          ${GLSL_OUTPUT}
        }
      `,
    }),
    false,
  );
  const bar = new THREE.Mesh(assets.geom(new THREE.PlaneGeometry(0.4, 0.006)), barMat);
  bar.position.y = -0.078;
  bar.renderOrder = 901;
  group.add(bar);

  return {
    group,
    setProgress(t) {
      barUniforms.uProgress.value = t;
    },
    setFade(k) {
      group.visible = k > 0.01;
      cardMat.opacity = k;
      (barMat as THREE.ShaderMaterial).uniforms.uOpacity.value = k;
    },
  };
}

// ── Scene ───────────────────────────────────────────────────────────────────

/**
 * Builds a panorama room. Returns immediately with the holding dome up; the
 * photo arrives later and eases in over the top.
 */
export function createPanoramaScene(ctx: SceneContext): PanoramaScene {
  const assets = new SceneAssets();
  assets.root.name = "env-panorama";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting: SceneLighting = defaultLighting(ctx.spec, tint);
  lighting.fogDensity = 0.006;
  lighting.shadowStrength = 0.5;
  lighting.poolStrength = 0;

  // Keep both domes inside whatever far plane the engine chose — a sky sphere
  // sitting behind the far plane renders as nothing at all.
  const domeRadius = fitDistance(ctx.camera, 500);

  // ── The holding dome. Up before anything downloads; never a black void.
  //    Deliberately luminous: this is what a client sees while their own
  //    photography is still coming down the wire, and a dark sphere is
  //    indistinguishable from a crash.
  const INK = new THREE.Color(hex(palette.ink));
  const holdUniforms: Record<string, THREE.IUniform> = {
    uTime,
    uLow: { value: mixColor(INK, tint, 0.16) },
    uHigh: { value: mixColor(INK, tint, 0.5) },
    uFade: { value: 1 },
  };
  const holding = new THREE.Mesh(
    assets.geom(new THREE.SphereGeometry(domeRadius * 0.96, 24, 16)),
    makeShader(
      assets,
      holdUniforms,
      /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      /* glsl */ `
      uniform vec3 uLow, uHigh;
      uniform float uTime, uFade, uOpacity;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uLow, uHigh, pow(h, 1.2));
        // A very slow breath, so the holding state does not read as frozen.
        col *= 0.94 + 0.06 * sin(uTime * 0.35 + d.y * 1.5);
        gl_FragColor = vec4(col, uFade * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { side: THREE.BackSide, depthWrite: false },
    ),
  );
  holding.renderOrder = -30;
  assets.add(holding);

  // ── The photo sphere. Hidden until there is something in it.
  const photoUniforms: Record<string, THREE.IUniform> = {
    uMap: { value: null },
    uYaw: { value: ctx.spec.yawOffset ?? 0 },
    uMix: { value: 0 },
    uExposure: { value: 1 },
  };
  const photoMat = makeShader(
    assets,
    photoUniforms,
    /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    /* glsl */ `
      uniform sampler2D uMap;
      uniform float uYaw, uMix, uExposure, uOpacity;
      varying vec3 vDir;

      const float INV_TWO_PI = 0.15915494309;
      const float INV_PI = 0.31830988618;

      void main() {
        vec3 d = normalize(vDir);
        // yawOffset turns the horizon feature to face the player.
        float ca = cos(uYaw);
        float sa = sin(uYaw);
        vec3 r = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);

        vec2 uv = vec2(atan(r.z, r.x) * INV_TWO_PI + 0.5,
                       asin(clamp(r.y, -1.0, 1.0)) * INV_PI + 0.5);

        // Analytic derivatives. Screen-space ones blow up across the u seam and
        // pull in the smallest mip, which shows as a hard vertical line.
        vec3 dx = dFdx(r);
        vec3 dy = dFdy(r);
        float denom = max(r.x * r.x + r.z * r.z, 1e-5);
        float dudx = (r.x * dx.z - r.z * dx.x) / denom * INV_TWO_PI;
        float dudy = (r.x * dy.z - r.z * dy.x) / denom * INV_TWO_PI;
        float inv = inversesqrt(max(1.0 - r.y * r.y, 1e-5));
        float dvdx = dx.y * inv * INV_PI;
        float dvdy = dy.y * inv * INV_PI;

        vec3 col = textureGrad(uMap, uv, vec2(dudx, dvdx), vec2(dudy, dvdy)).rgb * uExposure;
        gl_FragColor = vec4(col, uMix * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
    { side: THREE.BackSide, depthWrite: false },
  );
  const photo = new THREE.Mesh(assets.geom(new THREE.SphereGeometry(domeRadius, 48, 32)), photoMat);
  photo.renderOrder = -20;
  photo.visible = false;
  assets.add(photo);

  // ── Loading state, parked above the board.
  const loading = buildLoadingState(assets, ctx.spec.name, tint);
  loading.setFade(0);
  loading.group.position.set(ctx.anchor.x, ctx.anchor.y + 0.44, ctx.anchor.z);
  assets.add(loading.group);

  // ── Load.
  let disposed = false;
  let reveal = 0;
  let loadingFade = 0;
  let showLoading = false;
  let settledOk = false;
  let sceneOpacity = 1;
  let texture: THREE.Texture | null = null;

  // The card runs its own fade, so it also has to honour the environment
  // cross-fade rather than hanging in the air over the outgoing room.
  const pushLoadingFade = () => loading.setFade(loadingFade * sceneOpacity);

  const anisotropy = ctx.renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  const url = resolvePanoramaUrl(ctx.spec.panorama ?? "");

  const ready: Promise<boolean> = (ctx.spec.panorama
    ? loadEquirectangular(url, Math.min(8, anisotropy))
    : Promise.reject(new Error("panorama entry has no image"))
  ).then(
    (loaded) => {
      if (disposed) {
        loaded.dispose();
        return false;
      }
      texture = assets.tex(loaded);
      photoUniforms.uMap.value = loaded;
      photo.visible = true;
      settledOk = true;

      // Grade the room from the photo itself, so the cards pick up its light.
      const tone = loaded.image ? measureTone(loaded.image as TexImageSource) : null;
      if (tone) {
        lighting.skyColor.lerp(tone.sky, 0.55);
        lighting.groundColor.lerp(tone.ground, 0.55);
        lighting.fogColor.lerp(tone.average, 0.5);
        lighting.keyColor.lerp(tone.sky, 0.3);
        lighting.shadowColor.lerp(tone.ground, 0.35).multiplyScalar(0.35);
        if (lighting.background) lighting.background.lerp(tone.average, 0.6);
      }
      return true;
    },
    (err: unknown) => {
      if (!disposed) {
        console.warn(`[env] panorama "${ctx.spec.id}" could not be shown:`, err);
      }
      return false;
    },
  );

  // If it has not arrived quickly, put the loading state up.
  const graceTimer = setTimeout(() => {
    if (!disposed && !settledOk) showLoading = true;
  }, 260);
  void ready.then(() => clearTimeout(graceTimer));

  const camPos = new THREE.Vector3();

  return {
    root: assets.root,
    lighting,
    ready,

    update(dt, t) {
      uTime.value = t;

      if (settledOk) {
        reveal = Math.min(1, reveal + dt / REVEAL_SEC);
        const k = reveal * reveal * (3 - 2 * reveal);
        photoUniforms.uMix.value = k;
        // The holding dome retires behind the photo rather than under it.
        holdUniforms.uFade.value = 1 - k;
        holding.visible = k < 0.995;
      }

      const targetFade = showLoading && !settledOk ? 1 : 0;
      if (loadingFade !== targetFade) {
        const step = dt / 0.35;
        loadingFade =
          loadingFade < targetFade
            ? Math.min(targetFade, loadingFade + step)
            : Math.max(targetFade, loadingFade - step);
        pushLoadingFade();
      }
      if (loadingFade > 0.01) {
        loading.setProgress((t * 0.55) % 1);
        ctx.camera.getWorldPosition(camPos);
        loading.group.lookAt(camPos);
      }
    },

    setOpacity(k) {
      sceneOpacity = k;
      assets.setOpacity(k);
      pushLoadingFade();
    },

    setAnchor(centre) {
      loading.group.position.set(centre.x, centre.y + 0.44, centre.z);
    },

    dispose() {
      disposed = true;
      clearTimeout(graceTimer);
      photoUniforms.uMap.value = null;
      // `assets.dispose()` frees the texture too; this covers a load that lands
      // after teardown, which would otherwise strand it in VRAM.
      texture?.dispose();
      texture = null;
      assets.dispose();
    },
  };
}
