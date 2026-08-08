/**
 * Grid → world placement.
 *
 * Cards are laid on a gentle concave arc whose centre is the player's head, so
 * every card in the board is the same distance away and turned the same amount
 * toward the viewer. A card in the far corner is therefore no smaller, no more
 * foreshortened and no harder to reach than the one dead ahead — which is the
 * whole reason a 48-card board is playable at all.
 *
 * Card size and spacing are solved from the preset rather than authored per
 * preset: the board's footprint stays roughly constant (~0.7 m on a desk,
 * ~2 m in a room) and the cards shrink into it. That keeps the framing
 * identical across every board size and keeps the vertical extent inside a
 * comfortable field of view, so a 48-card board never asks for neck movement.
 */

import * as THREE from "three";
import type { BoardPreset } from "../../shared/game.ts";

export type Placement = "table" | "room";

export interface PlacementSpec {
  id: Placement;
  /** Widest the board may be, in metres. */
  maxWidth: number;
  /** Tallest the board may be, in metres — the neck-strain budget. */
  maxHeight: number;
  /** Largest a single card may get on a sparse board. */
  maxCard: number;
  /** Distance from the player to the board centre. */
  distance: number;
  /** Height of the board centre above the floor. */
  height: number;
  /** Backward lean of the whole board, radians (negative = top away). */
  tilt: number;
  /** Horizontal arc radius. Matching `distance` puts the player at the centre. */
  arcRadius: number;
  /** Vertical arc radius. Larger than horizontal — a gentler bow. */
  arcRadiusV: number;
}

/**
 * "table" is sized for passthrough: it lands on a real desk, raked back like a
 * card display. "room" is the large virtual board for a standing player.
 */
export const PLACEMENTS: Readonly<Record<Placement, PlacementSpec>> = {
  table: {
    id: "table",
    maxWidth: 0.78,
    maxHeight: 0.46,
    maxCard: 0.125,
    distance: 0.6,
    height: 0.83,
    tilt: -1.2566, // 72° back — 18° off the desk surface
    arcRadius: 0.95,
    arcRadiusV: 1.05,
  },
  room: {
    id: "room",
    maxWidth: 2.35,
    maxHeight: 1.34,
    maxCard: 0.36,
    distance: 2.05,
    height: 1.34,
    tilt: -0.157, // 9° back
    arcRadius: 2.05,
    arcRadiusV: 3.1,
  },
};

/** A card may be up to this much wider than it is tall, never more. */
const MAX_ASPECT = 1.18;

export interface CardSlot {
  index: number;
  col: number;
  row: number;
  /** Board-local position. */
  position: THREE.Vector3;
  /** Board-local orientation, YXZ so yaw composes over pitch. */
  rotation: THREE.Euler;
}

export interface BoardLayout {
  placement: Placement;
  cols: number;
  rows: number;
  count: number;

  cardWidth: number;
  cardHeight: number;
  cardThickness: number;
  cornerRadius: number;
  bevel: number;

  gapX: number;
  gapY: number;
  boardWidth: number;
  boardHeight: number;

  /** Where the board group sits relative to the player pivot. */
  groupPosition: THREE.Vector3;
  /** Rotation about X applied to the board group. */
  groupTilt: number;
  /** Player-to-board-centre distance, for scaling motion and pick tolerance. */
  viewDistance: number;
  /** Radius of a sphere around one card, for broad-phase picking. */
  cardRadius: number;

  slots: readonly CardSlot[];
}

/**
 * Spacing tightens as the board grows: a 12-card board can afford air, a
 * 48-card board would rather spend that space on legible card faces.
 */
function gapRatioFor(count: number): number {
  const t = Math.max(0, Math.min(1, (count - 12) / 36));
  return 0.17 + (0.11 - 0.17) * t;
}

export function computeLayout(preset: BoardPreset, placement: Placement): BoardLayout {
  const spec = PLACEMENTS[placement];
  const cols = Math.max(1, preset.cols);
  const rows = Math.max(1, preset.rows);
  const count = cols * rows;

  const g = gapRatioFor(count);
  const spanW = cols + (cols - 1) * g;
  const spanH = rows + (rows - 1) * g;

  // Height is the binding constraint on every shipped preset — the vertical
  // field of view is the scarce resource, not the horizontal one.
  const cardHeight = Math.min(spec.maxHeight / spanH, spec.maxCard);
  const cardWidth = Math.min(spec.maxWidth / spanW, cardHeight * MAX_ASPECT);

  const gapX = cardWidth * g;
  const gapY = cardHeight * g;
  const pitchX = cardWidth + gapX;
  const pitchY = cardHeight + gapY;
  const boardWidth = cols * pitchX - gapX;
  const boardHeight = rows * pitchY - gapY;

  const cardThickness = Math.max(0.0022, Math.min(0.014, cardHeight * 0.052));
  const cornerRadius = cardHeight * 0.085;
  const bevel = Math.min(cardThickness * 0.42, cardHeight * 0.016);

  const R = spec.arcRadius;
  const Rv = spec.arcRadiusV;
  const slots: CardSlot[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col - (cols - 1) / 2) * pitchX;
      const v = ((rows - 1) / 2 - row) * pitchY;

      // Arc length → angle, so spacing stays even along the curve.
      const yaw = u / R;
      const pitch = v / Rv;

      const position = new THREE.Vector3(
        R * Math.sin(yaw),
        Rv * Math.sin(pitch),
        // Both arcs pull their outer cards toward the player. Concave, not bowed.
        R * (1 - Math.cos(yaw)) + Rv * (1 - Math.cos(pitch)),
      );

      // Rotating +Z by -yaw about Y and +pitch about X aims the face at the
      // arc centre, i.e. straight back at the player.
      const rotation = new THREE.Euler(pitch, -yaw, 0, "YXZ");

      slots.push({ index: row * cols + col, col, row, position, rotation });
    }
  }

  return {
    placement,
    cols,
    rows,
    count,
    cardWidth,
    cardHeight,
    cardThickness,
    cornerRadius,
    bevel,
    gapX,
    gapY,
    boardWidth,
    boardHeight,
    groupPosition: new THREE.Vector3(0, spec.height, -spec.distance),
    groupTilt: spec.tilt,
    viewDistance: spec.distance,
    cardRadius: 0.5 * Math.hypot(cardWidth, cardHeight) + cardThickness,
    slots,
  };
}
