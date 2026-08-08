/**
 * Mixed reality — the player's real room, with the board standing on their own
 * table.
 *
 * The whole design principle here is restraint. Everything this scene draws is
 * something a virtual object cannot do for itself: land the board on a real
 * surface. There is no dome, no floor, no fog, no decoration. Anything that
 * occludes the room would be working against the mode.
 *
 * Two elements do the grounding:
 *   • the controller's blob shadow, which this scene asks for at full strength
 *     — over camera passthrough a dark alpha-blended patch is the only thing
 *     that reads as a shadow (multiply blending composites to nothing against a
 *     transparent framebuffer);
 *   • a grounding ring, drawn additively so it reads as light cast onto the
 *     real table rather than as a decal floating over it.
 *
 * The transparent clear itself (`scene.background = null`, clear alpha 0) is
 * applied by the controller from `lighting.background === null`, under the
 * cross-fade veil, so it lands on the same frame as everything else.
 */

import * as THREE from "three";
import type { EnvScene, SceneContext, SceneLighting } from "./controller.ts";
import { SceneAssets, defaultLighting, makeShader, GLSL_OUTPUT } from "./procedural.ts";
import { hex, palette, text as brandText } from "../../shared/brand.ts";

const WHITE = new THREE.Color(hex(brandText.onPrimary));
const INK = new THREE.Color(hex(palette.ink));

export function createPassthroughScene(ctx: SceneContext): EnvScene {
  const assets = new SceneAssets();
  assets.root.name = "env-passthrough";
  const tint = ctx.tint;
  const uTime: THREE.IUniform = { value: 0 };

  const lighting: SceneLighting = defaultLighting(ctx.spec, tint);
  // The real room supplies the look; our lights only have to make the virtual
  // objects sit in it. Keep them close to neutral so nothing looks colour-cast.
  lighting.keyDirection.set(0.3, 0.9, 0.32).normalize();
  lighting.keyColor = WHITE.clone().lerp(tint, 0.1);
  lighting.skyColor = WHITE.clone().lerp(tint, 0.16);
  lighting.groundColor = WHITE.clone().lerp(INK, 0.55);
  lighting.fogColor = INK.clone();
  lighting.fogDensity = 0;
  lighting.background = null;
  lighting.shadowColor = INK.clone().lerp(tint, 0.08);
  lighting.shadowStrength = 0.5;
  lighting.poolStrength = 0;

  const rings = new THREE.Group();
  rings.name = "passthrough-grounding";
  assets.add(rings);

  // ── Grounding ring: a thin annulus of light with twelve quiet index marks.
  const ringUniforms: Record<string, THREE.IUniform> = {
    uTime,
    uTint: { value: tint },
    uStrength: { value: 0.5 },
  };
  const ring = new THREE.Mesh(
    assets.geom(new THREE.RingGeometry(0.5, 1.0, 96, 1)),
    makeShader(
      assets,
      ringUniforms,
      /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      /* glsl */ `
      uniform vec3 uTint;
      uniform float uTime, uStrength, uOpacity;
      varying vec2 vLocal;
      void main() {
        float r = length(vLocal);
        // A bright hairline with a short falloff either side of it. Anything
        // wider stops reading as contact and starts reading as decoration.
        float inner = exp(-pow((r - 0.60) * 34.0, 2.0));
        float wash = exp(-pow((r - 0.60) * 7.0, 2.0)) * 0.10;

        // Twelve index marks, so the ring reads as an instrument, not a glow.
        float a01 = atan(vLocal.y, vLocal.x) / 6.2831853 + 0.5;
        float tick = 1.0 - smoothstep(0.0, 0.05, abs(fract(a01 * 12.0) - 0.5) - 0.455);
        float tickBand = (1.0 - smoothstep(0.63, 0.74, r)) * smoothstep(0.60, 0.63, r);

        float breathe = 0.86 + 0.14 * sin(uTime * 0.7);
        float a = (inner * 0.55 + wash + tick * tickBand * 0.45) * breathe * uStrength * uOpacity;
        gl_FragColor = vec4(uTint, clamp(a, 0.0, 1.0));
        ${GLSL_OUTPUT}
      }
    `,
      { blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide },
    ),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  rings.add(ring);

  // ── An outer horizon line, a whisper, purely to widen the sense of contact.
  const halo = new THREE.Mesh(
    assets.geom(new THREE.RingGeometry(0.98, 1.22, 96, 1)),
    makeShader(
      assets,
      { uTint: { value: tint }, uStrength: { value: 0.12 } },
      /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      /* glsl */ `
      uniform vec3 uTint;
      uniform float uStrength, uOpacity;
      varying vec2 vLocal;
      void main() {
        float r = length(vLocal);
        float a = (1.0 - smoothstep(0.98, 1.5, r)) * smoothstep(0.98, 1.06, r);
        gl_FragColor = vec4(uTint, a * uStrength * uOpacity);
        ${GLSL_OUTPUT}
      }
    `,
      { blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide },
    ),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 3;
  rings.add(halo);

  const place = (centre: THREE.Vector3, radius: number): void => {
    // A shade above the surface, so it never z-fights the board's own base.
    rings.position.set(centre.x, centre.y + 0.0015, centre.z);
    rings.scale.setScalar(Math.max(0.15, radius) * 1.18);
  };
  place(ctx.anchor, ctx.anchorRadius);

  return {
    root: assets.root,
    lighting,
    update(_dt, t) {
      uTime.value = t;
    },
    setOpacity(k) {
      assets.setOpacity(k);
    },
    setAnchor(centre, radius) {
      place(centre, radius);
    },
    dispose() {
      assets.dispose();
    },
  };
}
