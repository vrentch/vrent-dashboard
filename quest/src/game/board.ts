/**
 * The card board.
 *
 * Owns the deck's geometry, materials, layout, picking and feedback. It knows
 * nothing about turns, scoring or the network — it is told what happened and
 * it shows it, and it reports what the player pointed at.
 *
 * Performance shape, because this runs at 90 Hz on a mobile GPU:
 *   • one BufferGeometry shared by every card
 *   • one compiled shader program shared by every card material
 *   • one symbol atlas and one card-back texture for the whole board
 *   • picking is a hand-rolled broad/narrow phase against cached slot matrices,
 *     so `update()` performs no allocation and no matrix inversions per card
 */

import * as THREE from "three";
import type { BoardController, BoardEvents, Engine, PointerState, XrMode } from "../contracts.ts";
import type { BoardPreset, Card, GameSettings } from "../../shared/game.ts";
import { presetForPairs } from "../../shared/game.ts";
import { hex, onThemeChange, seatColors } from "../../shared/brand.ts";
import { getEnvironment } from "../../shared/environments.ts";
import { currentTint } from "../env/controller.ts";
import { buildSymbolAtlas, type SymbolAtlas } from "./symbols.ts";
import { computeLayout, type BoardLayout, type Placement } from "./layout.ts";
import {
  buildCardGeometry,
  createCard,
  createCardResources,
  type CardResources,
  type CardView,
} from "./card.ts";

/**
 * Ceiling on cards animating at once. The rules only ever flip two, but a
 * rejoin or a rules variant could ask for more; past this point new
 * transitions snap rather than turning the board into a slideshow.
 */
const MAX_ACTIVE_ANIMATIONS = 12;

// Scratch objects. Reused every frame by every pointer — `update()` allocates
// nothing.
const _groupInv = /*@__PURE__*/ new THREE.Matrix4();
const _boardRay = /*@__PURE__*/ new THREE.Ray();
const _localRay = /*@__PURE__*/ new THREE.Ray();
const _hit = /*@__PURE__*/ new THREE.Vector3();
const _seat = /*@__PURE__*/ new THREE.Color();

function seatColor(seat: number, target: THREE.Color): THREE.Color {
  const i = ((seat % seatColors.length) + seatColors.length) % seatColors.length;
  return target.setHex(hex(seatColors[i]));
}

/**
 * Falls back to a wide grid if a caller hands us a card count no preset
 * covers, so a custom deck never lands in a pile at the origin.
 */
function gridFor(count: number, pairs: number): BoardPreset {
  const preset = presetForPairs(pairs);
  if (preset.cols * preset.rows === count) return preset;
  const cols = Math.max(2, Math.ceil(Math.sqrt(count * 1.5)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { pairs: Math.floor(count / 2), cols, rows, label: `${count} cards` };
}

export function createBoard(engine: Engine, events: BoardEvents): BoardController {
  const group = new THREE.Group();
  group.name = "board";
  group.matrixAutoUpdate = true;

  let placement: Placement = "room";
  let layout: BoardLayout | null = null;
  /** The grid the current deck was built with — reused on a placement change. */
  let preset: BoardPreset | null = null;
  let resources: CardResources | null = null;
  let atlas: SymbolAtlas | null = null;
  let cards: CardView[] = [];
  /**
   * Seat that owns each card's highlight, -1 for none. Seat colours are parsed
   * out of the palette, so a theme switch has to re-tint every claimed card —
   * and the board is the only thing that remembers who claimed what.
   */
  let cardSeat = new Int16Array(0);

  /** Cached inverse of each slot's board-local matrix — slots never move. */
  let slotInverse: THREE.Matrix4[] = [];
  /** Board-local slot centres, for the broad phase. */
  let slotCentre: THREE.Vector3[] = [];
  const pickBox = new THREE.Box3();
  let broadRadiusSq = 0;

  let interactive = true;
  let hoverIndex: number | null = null;
  let intentIndex: number | null = null;
  /** Pointer id → card index armed on press, so a drag off the card cancels. */
  const armed = new Map<number, number>();

  let ambient = 1;
  let mode: XrMode = engine.mode;

  const anisotropy = Math.min(4, engine.renderer.capabilities.getMaxAnisotropy());

  // ── Lighting response ─────────────────────────────────────────────────────

  /**
   * The rim light and the self-lit floor are what keep faces readable in both
   * shipping extremes: a blown-out 360 panorama and unlit passthrough at night.
   * These are the *environment's* demands; the theme's own `rimScale` and
   * `cardFaceScale` are folded on top inside `setEnvResponse`.
   */
  function applyLighting(): void {
    if (!resources) return;
    const dark = 1 - Math.max(0, Math.min(1, ambient / 1.25));
    resources.setEnvResponse(0.35 + 0.5 * dark, 0.05 + 0.12 * dark + (mode === "ar" ? 0.06 : 0));
  }

  const offModeChange = engine.onModeChange((next) => {
    mode = next;
    applyLighting();
  });

  // The atlas repaints itself and the card resources re-derive their own tints
  // and theme multipliers. The one thing neither of them can know is which seat
  // owns which card, so those colours are re-pushed from here. Nothing is
  // rebuilt: a theme switch mid-turn must not interrupt a flip.
  const offThemeChange = onThemeChange(() => {
    for (let i = 0; i < cards.length; i++) {
      const seat = cardSeat[i];
      if (seat >= 0) cards[i].setSeatColor(seatColor(seat, _seat));
    }
  });

  // ── Layout ────────────────────────────────────────────────────────────────

  function applyLayout(next: BoardLayout): void {
    layout = next;
    group.position.copy(next.groupPosition);
    group.rotation.set(next.groupTilt, 0, 0);

    for (let i = 0; i < cards.length; i++) {
      const slot = next.slots[i];
      const card = cards[i];
      card.pivot.position.copy(slot.position);
      card.pivot.rotation.copy(slot.rotation);
      card.pivot.updateMatrix();
      slotInverse[i].copy(card.pivot.matrix).invert();
      slotCentre[i].copy(slot.position);
    }

    // The pick volume is the card at rest plus the headroom it can rise into,
    // so a hovered or flipping card stays under the pointer.
    const lift = next.cardThickness * 2 + Math.min(0.008, next.cardHeight * 0.11) + next.cardHeight * 0.055;
    pickBox.min.set(-next.cardWidth / 2, -next.cardHeight / 2, -next.cardThickness);
    pickBox.max.set(next.cardWidth / 2, next.cardHeight / 2, lift);
    const broad = next.cardRadius + lift;
    broadRadiusSq = broad * broad;
  }

  // ── Build / teardown ──────────────────────────────────────────────────────

  function teardown(): void {
    for (const card of cards) {
      group.remove(card.pivot);
      card.dispose();
    }
    cards = [];
    slotInverse = [];
    slotCentre = [];
    cardSeat = new Int16Array(0);
    resources?.dispose();
    resources = null;
    atlas?.dispose();
    atlas = null;
    layout = null;
    preset = null;
    hoverIndex = null;
    intentIndex = null;
    armed.clear();
  }

  function build(settings: GameSettings, deck: readonly Card[]): void {
    teardown();

    preset = gridFor(deck.length, settings.pairs);
    const next = computeLayout(preset, placement);
    const spec = getEnvironment(settings.environmentId);
    ambient = spec.ambient;

    // Size the atlas from the deck as well as the settings: a tile shortfall
    // would wrap two different pairs onto the same face.
    const symbolCount = Math.max(1, settings.pairs, Math.ceil(deck.length / 2));
    atlas = buildSymbolAtlas(settings.symbolSetId, symbolCount, { anisotropy });
    resources = createCardResources(next, atlas, {
      anisotropy,
      rim: hex(spec.tint),
      rimStrength: 0.5,
      selfLit: 0.1,
    });
    applyLighting();

    cardSeat = new Int16Array(deck.length).fill(-1);
    for (let i = 0; i < deck.length; i++) {
      const card = createCard(resources, i);
      cards.push(card);
      slotInverse.push(new THREE.Matrix4());
      slotCentre.push(new THREE.Vector3());
      group.add(card.pivot);
    }

    applyLayout(next);

    // Restore whatever the match already knows. `symbol` is withheld from
    // clients until a card is revealed, so only trust a non-negative value.
    for (let i = 0; i < deck.length; i++) {
      const state = deck[i];
      const view = cards[i];
      if (state.symbol >= 0) view.setSymbol(state.symbol);
      if (state.matched) {
        cardSeat[i] = state.matchedBy ?? 0;
        view.markMatched(seatColor(cardSeat[i], _seat), false);
      } else if (state.faceUp) {
        view.setFaceUp(true, false);
      }
    }
  }

  /**
   * Swaps card geometry and repaints the back in place when the board changes
   * size. Card materials, uniforms and animation state all survive, which is
   * why a placement change never interrupts a turn.
   */
  function resize(next: BoardLayout): void {
    if (!resources) {
      layout = next;
      return;
    }
    const geometry = buildCardGeometry(
      next.cardWidth,
      next.cardHeight,
      next.cardThickness,
      next.cornerRadius,
      next.bevel,
    );
    resources.back.redraw(next.cardWidth / next.cardHeight);

    const oldGeometry = resources.geometry;
    resources.geometry = geometry;

    // `metrics` is captured by reference inside every card, so mutating it in
    // place rescales the motion along with the geometry.
    const m = resources.metrics;
    m.width = next.cardWidth;
    m.height = next.cardHeight;
    m.thickness = next.cardThickness;
    m.hoverLift = Math.min(0.008, next.cardHeight * 0.11);
    m.flipLift = next.cardHeight * 0.055;
    m.matchLift = next.cardHeight * 0.19;
    m.claimSink = next.cardThickness * 1.1;
    m.shakeAmp = next.cardWidth * 0.05;

    for (const card of cards) card.mesh.geometry = geometry;

    oldGeometry.dispose();
    applyLayout(next);
  }

  // ── Animation budget ──────────────────────────────────────────────────────

  function busyCount(): number {
    let n = 0;
    for (let i = 0; i < cards.length; i++) if (cards[i].busy()) n++;
    return n;
  }

  // ── Picking ───────────────────────────────────────────────────────────────

  function pickable(card: CardView): boolean {
    return !card.matched() && !card.faceUp();
  }

  /** Nearest pickable card under `ray`, or -1. Board-local, allocation free. */
  function pick(ray: THREE.Ray): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!pickable(card)) continue;
      if (ray.distanceSqToPoint(slotCentre[i]) > broadRadiusSq) continue;

      _localRay.copy(ray).applyMatrix4(slotInverse[i]);
      if (_localRay.intersectBox(pickBox, _hit) === null) continue;
      // Slot matrices are rigid, so local distance is world distance.
      const d = _hit.distanceToSquared(_localRay.origin);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function setHover(next: number | null, pointerId: number): void {
    if (next === hoverIndex) return;
    if (hoverIndex !== null && cards[hoverIndex]) cards[hoverIndex].setHover(false);
    hoverIndex = next;
    if (next !== null && cards[next]) {
      cards[next].setHover(true);
      engine.haptic(pointerId, 0.18, 10);
    }
    events.onCardHovered(next);
  }

  function handlePointers(pointers: readonly PointerState[]): void {
    if (!layout || cards.length === 0) return;

    group.updateWorldMatrix(true, false);
    _groupInv.copy(group.matrixWorld).invert();

    let nearest = -1;
    let nearestDist = Infinity;
    let nearestPointer = -1;

    for (let p = 0; p < pointers.length; p++) {
      const pointer = pointers[p];
      _boardRay.copy(pointer.ray).applyMatrix4(_groupInv);

      const hitIndex = pick(_boardRay);

      if (hitIndex >= 0) {
        const d = _boardRay.origin.distanceToSquared(slotCentre[hitIndex]);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = hitIndex;
          nearestPointer = pointer.id;
        }
      }

      // Arm on press, fire on release over the same card. A pointer that
      // slides off cancels, which is what stops a stray trigger from burning
      // someone's turn.
      if (pointer.pressed) {
        if (hitIndex >= 0) armed.set(pointer.id, hitIndex);
        else armed.delete(pointer.id);
      }
      if (pointer.released) {
        const target = armed.get(pointer.id);
        armed.delete(pointer.id);
        if (target !== undefined && target === hitIndex && cards[target] && pickable(cards[target])) {
          engine.haptic(pointer.id, 0.6, 22);
          events.onCardActivated(target);
        }
      }
    }

    setHover(nearest >= 0 ? nearest : null, nearestPointer);
  }

  // ── Controller ────────────────────────────────────────────────────────────

  return {
    group,

    build,

    reveal(index, symbol) {
      const card = cards[index];
      if (!card || card.matched()) return;
      card.setSymbol(symbol);
      card.setFaceUp(true, busyCount() < MAX_ACTIVE_ANIMATIONS);
      if (hoverIndex === index) setHover(null, -1);
    },

    hide(indices) {
      let budget = MAX_ACTIVE_ANIMATIONS - busyCount();
      for (const index of indices) {
        const card = cards[index];
        if (!card || card.matched()) continue;
        card.setFaceUp(false, budget-- > 0);
      }
    },

    markMatched(indices, seat) {
      seatColor(seat, _seat);
      let budget = MAX_ACTIVE_ANIMATIONS - busyCount();
      for (const index of indices) {
        const card = cards[index];
        if (!card) continue;
        // A match always ends face-up. Normally it already is; forcing it here
        // means an out-of-order network message self-heals instead of leaving
        // a claimed card showing its back.
        if (!card.faceUp()) card.setFaceUp(true, budget-- > 0);
        card.markMatched(_seat);
        cardSeat[index] = seat;
        if (hoverIndex === index) setHover(null, -1);
        if (intentIndex === index) intentIndex = null;
      }
    },

    markMissed(indices) {
      for (const index of indices) cards[index]?.markMissed();
    },

    setInteractive(on) {
      interactive = on;
      if (resources) resources.shared.uEnv.value.y = on ? 0 : 1;
      if (!on) {
        setHover(null, -1);
        armed.clear();
      }
    },

    showIntent(index, seat) {
      if (intentIndex !== null && intentIndex !== index) {
        cards[intentIndex]?.setIntent(false, _seat);
      }
      intentIndex = index;
      if (index === null) return;
      seatColor(seat, _seat);
      const card = cards[index];
      if (!card) return;
      card.setIntent(true, _seat);
      if (!card.matched()) cardSeat[index] = seat;
    },

    update(dt, now, pointers) {
      // Track the environment's live tint rather than the one captured at
      // build time. The board is not rebuilt when the player changes room, so
      // reading it once left the cards rimmed in the previous environment's
      // colour; following it here also inherits the 600ms cross-fade for free.
      if (resources) resources.shared.uRim.value.copy(currentTint());

      for (let i = 0; i < cards.length; i++) cards[i].update(dt, now);
      if (!interactive || pointers.length === 0) {
        if (hoverIndex !== null) setHover(null, -1);
        return;
      }
      handlePointers(pointers);
    },

    setPlacement(next) {
      if (next === placement) return;
      placement = next;
      if (!layout || !preset) return;
      resize(computeLayout(preset, placement));
    },

    dispose() {
      offModeChange();
      offThemeChange();
      teardown();
      group.clear();
    },
  };
}
