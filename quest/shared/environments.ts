/**
 * The environment catalogue.
 *
 * Three kinds:
 *   passthrough — the player's real room, via Quest 3 colour passthrough
 *   procedural  — futuristic scenes built from geometry and shaders, no assets
 *   panorama    — a 360° equirectangular photo, the tailoring hook for clients
 *
 * A customer's own 360 photography drops in as `panorama` entries: put the
 * image in `public/environments/`, add an entry here (or upload it at runtime
 * in the Enterprise edition) and it becomes a playable room.
 */

export type EnvironmentKind = "passthrough" | "procedural" | "panorama";

export interface EnvironmentSpec {
  id: string;
  name: string;
  /** One line shown under the name in the picker. */
  blurb: string;
  kind: EnvironmentKind;
  /** Procedural scene generator key, for `kind: "procedural"`. */
  preset?: "neon-vault" | "orbital-deck" | "quantum-lab" | "cyber-atrium" | "aurora-void";
  /** Equirectangular image, for `kind: "panorama"`. Relative to the app base. */
  panorama?: string;
  /**
   * Scene tint. Drives fog, rim light on the cards and the spatial-UI glow so
   * the board always looks like it belongs in the room rather than pasted on.
   */
  tint: string;
  /** Ambient light intensity, 0-2. Panoramas need less; dark scenes need more. */
  ambient: number;
  /** Key light intensity, 0-3. */
  key: number;
  /** Whether to draw a reflective floor under the board. */
  floor: boolean;
  /** Radians to rotate the panorama so its horizon feature faces the player. */
  yawOffset?: number;
}

export const ENVIRONMENTS: readonly EnvironmentSpec[] = [
  {
    id: "passthrough",
    name: "Your Room",
    blurb: "Mixed reality — the board appears on your real table.",
    kind: "passthrough",
    tint: "#00E5C7",
    ambient: 1.15,
    key: 0.85,
    floor: false,
  },
  {
    id: "neon-vault",
    name: "Neon Vault",
    blurb: "A dark vault ribbed with reactive light.",
    kind: "procedural",
    preset: "neon-vault",
    tint: "#1E6BFF",
    ambient: 0.35,
    key: 1.6,
    floor: true,
  },
  {
    id: "orbital-deck",
    name: "Orbital Deck",
    blurb: "An observation deck with the planet turning below.",
    kind: "procedural",
    preset: "orbital-deck",
    tint: "#4F8DFF",
    ambient: 0.5,
    key: 2.1,
    floor: true,
  },
  {
    id: "quantum-lab",
    name: "Quantum Lab",
    blurb: "Clean white research floor, soft volumetric light.",
    kind: "procedural",
    preset: "quantum-lab",
    tint: "#00E5C7",
    ambient: 1.25,
    key: 1.2,
    floor: true,
  },
  {
    id: "cyber-atrium",
    name: "Cyber Atrium",
    blurb: "Rain on glass, signage bleeding into the dark.",
    kind: "procedural",
    preset: "cyber-atrium",
    tint: "#C77DFF",
    ambient: 0.4,
    key: 1.4,
    floor: true,
  },
  {
    id: "aurora-void",
    name: "Aurora Void",
    blurb: "Weightless colour field. The calmest way to play.",
    kind: "procedural",
    preset: "aurora-void",
    tint: "#6EE787",
    ambient: 0.8,
    key: 1.0,
    floor: false,
  },
  // ── Panorama slots ────────────────────────────────────────────────────────
  // `npm run environments` generates the shipped placeholders. Replace the JPGs
  // with a client's own 360 photography and the entries below need no changes.
  {
    id: "pano-showroom",
    name: "Showroom",
    blurb: "360° capture — swap for the client's own space.",
    kind: "panorama",
    panorama: "environments/showroom.jpg",
    tint: "#FFB020",
    ambient: 0.95,
    key: 1.0,
    floor: false,
  },
  {
    id: "pano-alpine",
    name: "Alpine Terrace",
    blurb: "360° capture — open air, high contrast.",
    kind: "panorama",
    panorama: "environments/alpine.jpg",
    tint: "#8FD3FF",
    ambient: 1.1,
    key: 1.3,
    floor: false,
  },
  {
    id: "pano-atelier",
    name: "Atelier",
    blurb: "360° capture — warm interior, close walls.",
    kind: "panorama",
    panorama: "environments/atelier.jpg",
    tint: "#FF8A3D",
    ambient: 0.9,
    key: 0.9,
    floor: false,
  },
];

export const DEFAULT_ENVIRONMENT_ID = "neon-vault";

export function getEnvironment(id: string): EnvironmentSpec {
  return (
    ENVIRONMENTS.find((e) => e.id === id) ??
    ENVIRONMENTS.find((e) => e.id === DEFAULT_ENVIRONMENT_ID)!
  );
}

/**
 * A 360 image loaded by the operator at runtime (Enterprise edition). Stored in
 * IndexedDB on the headset so it survives a restart without a round trip.
 */
export interface CustomPanorama {
  id: string;
  name: string;
  /** Object URL or data URL for the equirectangular image. */
  src: string;
  addedAt: number;
}

export function customToSpec(p: CustomPanorama): EnvironmentSpec {
  return {
    id: p.id,
    name: p.name,
    blurb: "Your uploaded 360° environment.",
    kind: "panorama",
    panorama: p.src,
    tint: "#00E5C7",
    ambient: 1.0,
    key: 1.1,
    floor: false,
  };
}
