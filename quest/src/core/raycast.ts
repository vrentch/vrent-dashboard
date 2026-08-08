/**
 * Shared picking.
 *
 * The board and the spatial UI both answer the same question — "what is this
 * pointer aimed at" — and they must answer it identically, or a card can look
 * hovered while a panel behind it swallows the press. One helper keeps the
 * range, the visibility rules and the ancestor lookup in a single place.
 *
 * Two things here are not what a bare `THREE.Raycaster` gives you:
 *
 *  - Three.js ignores `visible` when raycasting, so a face-down card that has
 *    been hidden would still be pickable. Every hit is checked back up to its
 *    registered root.
 *  - The pointer ray visual needs to know where to stop, and it must not have
 *    to know about the board or the UI to find out. Subsystems register their
 *    pickable roots here and the input layer queries the registry.
 */

import * as THREE from "three";
import type { PointerState } from "../contracts.ts";

/** Nothing in this product is further away than a large virtual room. */
export const DEFAULT_PICK_FAR = 12;

export interface Hit {
  /** The exact mesh the ray struck. */
  object: THREE.Object3D;
  /** The registered root that owns `object` — usually what the caller wants. */
  root: THREE.Object3D;
  /** World-space intersection point. */
  point: THREE.Vector3;
  /** Metres from the ray origin. */
  distance: number;
  /** World-space surface normal, when the geometry provides one. */
  normal: THREE.Vector3 | null;
  /** Surface coordinates, for hit-testing canvas-textured panels. */
  uv: THREE.Vector2 | null;
}

export interface PickOptions {
  /** Metres. Hits beyond this are discarded. */
  far?: number;
  /** Metres. Hits nearer than this are discarded. */
  near?: number;
  /** Test descendants of each candidate. Defaults to true. */
  recursive?: boolean;
  /** Rejects a candidate root before any triangle work happens. */
  accept?: (root: THREE.Object3D) => boolean;
}

export interface PointerHit {
  pointer: PointerState;
  hit: Hit;
}

// Picking is synchronous and single-threaded, so one raycaster serves every
// caller without any risk of interleaving.
const _raycaster = new THREE.Raycaster();
const _scratch: THREE.Intersection[] = [];
const _normalMatrix = new THREE.Matrix3();
const _unprojected = new THREE.Vector3();

// ── Pickable registry ───────────────────────────────────────────────────────

const _registry = new Set<THREE.Object3D>();

/**
 * Declares a subtree as something pointers can hit. Returns the unregister
 * function; call it from the owner's `dispose()`.
 */
export function registerPickable(root: THREE.Object3D): () => void {
  _registry.add(root);
  return () => {
    _registry.delete(root);
  };
}

/** Every currently registered root, in registration order. */
export function pickables(): readonly THREE.Object3D[] {
  return [..._registry];
}

/** Nearest registered thing under `ray`. */
export function pickScene(ray: THREE.Ray, options: PickOptions = {}): Hit | null {
  return pick(ray, _registry, options);
}

// ── Picking ─────────────────────────────────────────────────────────────────

/** Nearest hit among `candidates`, or null. */
export function pick(
  ray: THREE.Ray,
  candidates: Iterable<THREE.Object3D>,
  options: PickOptions = {},
): Hit | null {
  const recursive = options.recursive ?? true;
  _raycaster.set(ray.origin, ray.direction);
  _raycaster.near = options.near ?? 0;
  _raycaster.far = options.far ?? DEFAULT_PICK_FAR;

  let best: THREE.Intersection | null = null;
  let bestRoot: THREE.Object3D | null = null;

  for (const root of candidates) {
    if (!root.visible) continue;
    if (options.accept && !options.accept(root)) continue;

    _scratch.length = 0;
    _raycaster.intersectObject(root, recursive, _scratch);

    for (const candidate of _scratch) {
      if (best !== null && candidate.distance >= best.distance) break;
      if (!isVisibleThrough(candidate.object, root)) continue;
      best = candidate;
      bestRoot = root;
      break;
    }
  }

  _scratch.length = 0;
  if (best === null || bestRoot === null) return null;
  return toHit(best, bestRoot);
}

/**
 * Nearest hit across every active pointer, with the pointer that produced it.
 * Two hands can be aimed at the board at once; whichever is closer wins.
 */
export function pickPointers(
  pointers: readonly PointerState[],
  candidates: Iterable<THREE.Object3D>,
  options: PickOptions = {},
): PointerHit | null {
  let best: PointerHit | null = null;
  for (const pointer of pointers) {
    const hit = pick(pointer.ray, candidates, options);
    if (hit && (best === null || hit.distance < best.hit.distance)) {
      best = { pointer, hit };
    }
  }
  return best;
}

function toHit(intersection: THREE.Intersection, root: THREE.Object3D): Hit {
  let normal: THREE.Vector3 | null = null;
  const face = intersection.face;
  if (intersection.normal) {
    normal = intersection.normal.clone();
  } else if (face) {
    _normalMatrix.getNormalMatrix(intersection.object.matrixWorld);
    normal = face.normal.clone().applyMatrix3(_normalMatrix).normalize();
  }
  return {
    object: intersection.object,
    root,
    point: intersection.point.clone(),
    distance: intersection.distance,
    normal,
    uv: intersection.uv ? intersection.uv.clone() : null,
  };
}

/** True when `object` and everything up to and including `root` is visible. */
function isVisibleThrough(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  // The hit was not under `root` at all, which should not happen.
  return false;
}

// ── Ray construction ────────────────────────────────────────────────────────

/**
 * Ray along an object's local -Z, the convention every XR target-ray space and
 * every Three.js camera follows.
 */
export function rayFromObject(object: THREE.Object3D, target = new THREE.Ray()): THREE.Ray {
  object.updateWorldMatrix(true, false);
  target.origin.setFromMatrixPosition(object.matrixWorld);
  target.direction.set(0, 0, -1).transformDirection(object.matrixWorld);
  return target;
}

/** Ray through a normalised device coordinate — the desktop mouse fallback. */
export function rayFromNdc(
  camera: THREE.Camera,
  x: number,
  y: number,
  target = new THREE.Ray(),
): THREE.Ray {
  _unprojected.set(x, y, 0.5).unproject(camera);
  target.origin.setFromMatrixPosition(camera.matrixWorld);
  target.direction.copy(_unprojected).sub(target.origin).normalize();
  return target;
}

// ── Identifying what was hit ────────────────────────────────────────────────

/**
 * Walks up from a hit mesh to the first ancestor tagged with `key`. Cards and
 * buttons are groups of several meshes; the tag lives on the group.
 */
export function ancestorWithData(object: THREE.Object3D | null, key: string): THREE.Object3D | null {
  for (let node = object; node; node = node.parent) {
    if (node.userData[key] !== undefined) return node;
  }
  return null;
}

/** The `userData[key]` of the nearest tagged ancestor, if any. */
export function dataOf<T>(object: THREE.Object3D | null, key: string): T | undefined {
  const owner = ancestorWithData(object, key);
  return owner ? (owner.userData[key] as T) : undefined;
}
