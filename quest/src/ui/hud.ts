/**
 * The in-game HUD.
 *
 * Anchored in world space just above the board rather than to the face: a
 * head-locked scoreboard is the single fastest way to make a mixed-reality game
 * feel cheap, and it fights with the passthrough view of the real table. The
 * HUD sits where the player is already looking, tilts up towards the eyes, and
 * scales with the board placement.
 *
 * The one thing it will not let you miss is whose turn it is. Group play falls
 * apart the moment four people in a room are unsure who should move, so "your
 * turn" gets a full-width band, the largest type on the panel, a caret pointing
 * at your own score chip and a controller-side colour rail — four independent
 * cues, none of them colour on its own.
 */

import * as THREE from "three";
import { palette, rgba, text as ink, tokens } from "../../shared/brand.ts";
import type { GameMode } from "../../shared/game.ts";
import { EMOTES } from "../../shared/protocol.ts";
import type { EmoteId, PlayerView } from "../../shared/protocol.ts";
import type { Engine, NetStatus, PointerState } from "../contracts.ts";
import type { Gfx, Rect } from "./panel.ts";
import { Panel, colsIn, gridIn, theme } from "./panel.ts";
import {
  avatar,
  connectionPip,
  formatDuration,
  icon,
  iconButton,
  seatColor,
} from "./widgets.ts";

// ── Public shape ────────────────────────────────────────────────────────────

export interface HudProps {
  players: readonly PlayerView[];
  /** Player id of the local user, for the "your turn" state. */
  selfId: string | null;
  /** Seat whose turn it is. Ignored in Time Attack. */
  turnSeat: number;
  mode: GameMode;
  pairsLeft: number;
  pairsTotal: number;
  /** Epoch ms; 0 when the turn is untimed. */
  turnDeadline: number;
  /** Full length of a turn in seconds, so the ring knows what "full" means. */
  turnSeconds: number;
  status: NetStatus;
  latencyMs: number;
  /** Epoch ms the match began, for the elapsed readout. 0 hides it. */
  startedAt: number;
  /** Corner mark, Demo edition only. */
  watermark: boolean;
}

export type HudAction =
  | { type: "sendEmote"; emote: EmoteId }
  | { type: "openMenu" };

export interface Hud {
  readonly group: THREE.Group;
  set(props: Partial<HudProps>): void;
  setVisible(visible: boolean): void;
  setPlacement(mode: "table" | "room"): void;
  /**
   * Where seat `n` sits, in the HUD parent's space (`engine.world` by default).
   * Emotes float above that point; return null to fall back to the HUD itself.
   */
  setSeatAnchor(fn: ((seat: number) => THREE.Vector3 | null) | null): void;
  playEmote(seat: number, emote: EmoteId): void;
  /** Opens the radial picker; hold the grip, release to commit. */
  openEmoteWheel(pointerId: number): void;
  /** Closes it. With `commit`, the highlighted emote is emitted. */
  closeEmoteWheel(commit: boolean): EmoteId | null;
  emoteWheelOpen(): boolean;
  update(dt: number, pointers: readonly PointerState[]): void;
  onAction(cb: (a: HudAction) => void): () => void;
  dispose(): void;
}

export interface HudDeps {
  parent?: THREE.Object3D;
  /** Shown in the corner when the edition asks for it. */
  watermarkText?: string;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const HUD_W = 1.0;
const HUD_H = 0.23;

const PLACEMENTS = {
  table: { scale: 0.78, pos: new THREE.Vector3(0, 1.05, -0.78), tilt: -0.24 },
  room: { scale: 1.15, pos: new THREE.Vector3(0, 1.62, -1.62), tilt: -0.06 },
} as const;

const WHEEL_M = 0.32;
const WHEEL_DEAD_ZONE = 0.3; // fraction of the radius that means "cancel"

const DEFAULT_PROPS: HudProps = {
  players: [],
  selfId: null,
  turnSeat: 0,
  mode: "classic",
  pairsLeft: 0,
  pairsTotal: 0,
  turnDeadline: 0,
  turnSeconds: 0,
  status: "offline",
  latencyMs: 0,
  startedAt: 0,
  watermark: false,
};

// ── Implementation ──────────────────────────────────────────────────────────

export function createHud(engine: Engine, deps: HudDeps = {}): Hud {
  const anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
  const parent = deps.parent ?? engine.world;

  const group = new THREE.Group();
  group.name = "vr-hud";
  parent.add(group);

  const board = new Panel({
    width: HUD_W,
    height: HUD_H,
    curveRadius: 2.4,
    padding: 26,
    name: "vr-hud-panel",
    renderOrder: 12,
    reticle: false,
    anisotropy,
    onHoverChange: (id, pointerId) => {
      if (id) engine.haptic(pointerId, 0.12, 12);
    },
  });
  group.add(board.group);

  /**
   * A thin plane behind the band that pulses on your turn. Animating a material
   * costs nothing; animating the canvas would mean a texture upload per frame.
   */
  const pulseGeo = new THREE.PlaneGeometry(HUD_W * 1.02, HUD_H * 0.46);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.accent),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const pulse = new THREE.Mesh(pulseGeo, pulseMat);
  pulse.position.set(0, HUD_H * 0.24, -0.004);
  pulse.renderOrder = 11;
  board.group.add(pulse);

  let props: HudProps = { ...DEFAULT_PROPS };
  let placement: "table" | "room" = "table";
  let visible = false;
  let lastSecondsLeft = -1;
  let lastElapsed = -1;
  let pulseT = 0;

  const listeners = new Set<(a: HudAction) => void>();
  const emit = (a: HudAction) => listeners.forEach((l) => l(a));

  // ── Turn helpers ──────────────────────────────────────────────────────────

  const selfPlayer = () => props.players.find((p) => p.id === props.selfId) ?? null;
  const turnPlayer = () => props.players.find((p) => p.seat === props.turnSeat) ?? null;
  const isFreeForAll = () => props.mode === "timeattack";
  const isMyTurn = () => {
    if (isFreeForAll()) return true;
    const me = selfPlayer();
    return !!me && !me.out && me.seat === props.turnSeat;
  };

  function secondsLeft(): number {
    if (props.turnDeadline <= 0) return -1;
    return Math.max(0, Math.ceil((props.turnDeadline - Date.now()) / 1000));
  }

  // ── HUD panel drawing ─────────────────────────────────────────────────────

  function render(g: Gfx): void {
    const area = g.area;
    const bandH = 118;
    const band: Rect = { x: area.x, y: area.y, w: area.w, h: bandH };
    const chips: Rect = { x: area.x, y: area.y + bandH + 20, w: area.w, h: area.h - bandH - 20 };

    drawBand(g, band);
    g.hairline(area.x, band.y + bandH + 9, area.x + area.w, band.y + bandH + 9);
    drawChips(g, chips);

    if (props.watermark && deps.watermarkText) {
      g.text(deps.watermarkText, area.x + area.w, area.y + area.h + 6, {
        role: "label",
        size: 17,
        align: "right",
        color: theme.fgMuted,
        alpha: 0.55,
        upper: true,
      });
    }
  }

  function drawBand(g: Gfx, r: Rect): void {
    const mine = isMyTurn();
    const active = turnPlayer();
    const col = mine ? palette.accent : active ? seatColor(active.seat) : ink.muted;

    // Status cluster gets carved off the right first so the turn text can use
    // everything that is left without ever colliding with it.
    let right = r.x + r.w;

    const pipW = connectionPip(g, right - 190, r.y + 26, props.status, props.latencyMs);
    if (props.startedAt > 0) {
      g.text(formatDuration(Date.now() - props.startedAt), right - 190 + 36, r.y + 58, {
        role: "mono",
        size: 24,
        color: theme.fgMuted,
      });
    }
    right -= Math.max(190, pipW + 20);

    const menuBox: Rect = { x: r.x + r.w - 62, y: r.y + r.h - 62, w: 62, h: 62 };
    if (iconButton(g, menuBox, { id: "hud:menu", icon: "settings", label: "Menu" })) emit({ type: "openMenu" });

    const timerBox: Rect = { x: right - 148, y: r.y + 4, w: 130, h: r.h - 8 };
    const secs = secondsLeft();
    if (secs >= 0) {
      drawTimer(g, timerBox, secs);
      right = timerBox.x - 18;
    }

    const progressBox: Rect = { x: right - 176, y: r.y + 8, w: 168, h: r.h - 16 };
    drawProgress(g, progressBox);
    right = progressBox.x - 22;

    // The band itself.
    const bandRect: Rect = { x: r.x, y: r.y, w: Math.max(320, right - r.x), h: r.h };
    g.fillRound(bandRect, tokens.radius.md, rgba(col, mine ? 0.2 : 0.1));
    g.strokeRound(bandRect, tokens.radius.md, rgba(col, mine ? 0.8 : 0.34), mine ? 2 : 1);
    g.fillRound({ x: bandRect.x, y: bandRect.y + 10, w: 7, h: bandRect.h - 20 }, 4, col);

    const tx = bandRect.x + 30;
    if (isFreeForAll()) {
      icon(g, "spark", tx + 12, bandRect.y + bandRect.h / 2, 32, col, 3);
      g.text("EVERYONE PLAYS", tx + 44, bandRect.y + bandRect.h * 0.38, {
        role: "h2",
        size: 44,
        color: col,
        tracking: 1.5,
      });
      g.text("Time Attack — clear the board first", tx + 46, bandRect.y + bandRect.h * 0.74, {
        role: "caption",
        color: theme.fg2,
        maxWidth: bandRect.w - 90,
      });
      return;
    }

    if (mine) {
      // A forward caret plus the largest type on the panel. Unmissable.
      icon(g, "forward", tx + 14, bandRect.y + bandRect.h / 2, 38, col, 5);
      g.text("YOUR TURN", tx + 52, bandRect.y + bandRect.h * 0.4, {
        role: "h1",
        size: 56,
        color: col,
        tracking: 2,
      });
      g.text(hintForMode(props.mode), tx + 54, bandRect.y + bandRect.h * 0.78, {
        role: "caption",
        color: theme.fg2,
        maxWidth: bandRect.w - 100,
      });
    } else if (active) {
      avatar(g, tx + 30, bandRect.y + bandRect.h / 2, 30, {
        seat: active.seat,
        name: active.name,
        isAi: active.isAi,
        connected: active.connected,
        active: true,
      });
      g.text(`${active.name.toUpperCase()}`, tx + 74, bandRect.y + bandRect.h * 0.4, {
        role: "h2",
        size: 42,
        color: col,
        tracking: 1,
        maxWidth: bandRect.w - 200,
      });
      g.text(active.isAi ? "AI opponent is thinking" : "Waiting for their move", tx + 76, bandRect.y + bandRect.h * 0.76, {
        role: "caption",
        color: theme.fgMuted,
      });
      g.text("TO PLAY", bandRect.x + bandRect.w - 24, bandRect.y + bandRect.h * 0.4, {
        role: "label",
        align: "right",
        color: theme.fgMuted,
        upper: true,
      });
    } else {
      g.text("Waiting…", tx, bandRect.y + bandRect.h / 2, { role: "h2", color: theme.fgMuted });
    }
  }

  function hintForMode(mode: GameMode): string {
    switch (mode) {
      case "sudden":
        return "Sudden death — one miss and you are out";
      case "timeattack":
        return "Flip any two cards";
      default:
        return "Match a pair to keep the turn";
    }
  }

  function drawProgress(g: Gfx, r: Rect): void {
    const done = Math.max(0, props.pairsTotal - props.pairsLeft);
    g.text("PAIRS LEFT", r.x, r.y + 18, { role: "label", size: 18, color: theme.fgMuted, upper: true });
    g.text(String(props.pairsLeft), r.x, r.y + 62, { role: "h1", size: 46, color: theme.fg });
    const numW = g.measure(String(props.pairsLeft), { role: "h1", size: 46 });
    g.text(`of ${props.pairsTotal}`, r.x + numW + 12, r.y + 70, { role: "caption", color: theme.fgMuted });

    const bar: Rect = { x: r.x, y: r.y + r.h - 14, w: r.w, h: 8 };
    g.fillRound(bar, 4, rgba(palette.ink, 0.7));
    const t = props.pairsTotal > 0 ? done / props.pairsTotal : 0;
    if (t > 0) g.fillRound({ ...bar, w: Math.max(8, bar.w * t) }, 4, palette.accent);
  }

  function drawTimer(g: Gfx, r: Rect, secs: number): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = Math.min(r.w, r.h) / 2 - 8;
    const total = props.turnSeconds > 0 ? props.turnSeconds : Math.max(1, secs);
    const frac = Math.max(0, Math.min(1, secs / total));
    const urgent = secs <= 5;
    const col = urgent ? palette.danger : palette.reward;

    g.ring(cx, cy, radius, rgba(ink.secondary, 0.22), 7);
    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.ctx.strokeStyle = col;
    g.ctx.lineWidth = 7;
    g.ctx.lineCap = "round";
    g.ctx.stroke();
    g.ctx.restore();

    g.text(String(secs), cx, cy + 2, { role: "h2", size: 40, align: "centre", color: urgent ? col : theme.fg });
    g.text("SEC", cx, cy + 34, { role: "label", size: 16, align: "centre", color: theme.fgMuted, upper: true });
  }

  function drawChips(g: Gfx, r: Rect): void {
    const list = props.players;
    if (list.length === 0) return;

    const perRow = list.length > 4 ? 4 : Math.max(1, list.length);
    const rows = Math.ceil(list.length / perRow);
    const cells = rows > 1 ? gridIn(r, perRow, rows, 10) : colsIn(r, perRow, 10);

    list.forEach((p, i) => {
      const cell = cells[i];
      if (!cell) return;
      drawChip(g, cell, p);
    });
  }

  function drawChip(g: Gfx, r: Rect, p: PlayerView): void {
    const col = seatColor(p.seat);
    const isTurn = !isFreeForAll() && p.seat === props.turnSeat && !p.out;
    const isSelf = p.id === props.selfId;

    g.fillRound(r, tokens.radius.md, isTurn ? rgba(col, 0.16) : rgba(palette.ink, 0.42));
    g.strokeRound(r, tokens.radius.md, isTurn ? rgba(col, 0.85) : theme.line, isTurn ? 2 : 1);

    // Caret above the active chip — the shape, not the fill, carries the state.
    if (isTurn) {
      const cx = r.x + r.w / 2;
      g.path([cx - 11, r.y - 3, cx, r.y - 14, cx + 11, r.y - 3], col, 3, true);
      g.ctx.fillStyle = col;
      g.ctx.fill();
    }

    const av = Math.min(26, r.h * 0.3);
    avatar(g, r.x + 16 + av, r.y + r.h * 0.42, av, {
      seat: p.seat,
      name: p.name,
      isAi: p.isAi,
      connected: p.connected,
      out: p.out,
    });

    const tx = r.x + 26 + av * 2;
    const label = isSelf ? `${p.name} (you)` : p.name;
    g.text(label, tx, r.y + r.h * 0.34, {
      role: "bodyStrong",
      size: 24,
      color: p.out ? theme.disabledFg : theme.fg,
      maxWidth: r.w - (tx - r.x) - 66,
    });

    g.text(String(p.score), r.x + r.w - 16, r.y + r.h * 0.4, {
      role: "h2",
      size: 38,
      align: "right",
      color: p.out ? theme.disabledFg : col,
    });

    // Second line: streak, or the reason this seat is inactive.
    let sub = "";
    let subCol: string = theme.fgMuted;
    if (p.out) {
      sub = "OUT";
      subCol = palette.danger;
    } else if (!p.connected) {
      sub = "RECONNECTING";
      subCol = palette.reward;
    } else if (p.streak > 1) {
      sub = `STREAK ×${p.streak}`;
      subCol = palette.reward;
    } else if (p.isHost) {
      sub = "HOST";
    }
    if (sub) {
      g.text(sub, tx, r.y + r.h * 0.72, { role: "label", size: 17, color: subCol, upper: true });
      if (p.streak > 1 && !p.out && p.connected) {
        const w = g.measure(sub, { role: "label", size: 17, upper: true });
        for (let i = 0; i < Math.min(3, p.streak - 1); i++) {
          icon(g, "up", tx + w + 14 + i * 15, r.y + r.h * 0.72, 13, palette.reward, 2.2);
        }
      }
    }
  }

  // ── Emote wheel ───────────────────────────────────────────────────────────

  const wheel = new Panel({
    width: WHEEL_M,
    height: WHEEL_M,
    curveRadius: 0,
    chrome: false,
    padding: 8,
    reticle: false,
    name: "vr-emote-wheel",
    renderOrder: 45,
    anisotropy,
  });
  wheel.mesh.material.depthTest = false;
  engine.scene.add(wheel.group);
  wheel.setVisible(false, false);

  let wheelPointer = -1;
  let wheelChoice = -1;

  function renderWheel(g: Gfx): void {
    const c = g.bounds;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const outer = Math.min(c.w, c.h) / 2 - 6;
    const inner = outer * WHEEL_DEAD_ZONE;
    const n = EMOTES.length;
    const step = (Math.PI * 2) / n;
    const start = -Math.PI / 2 - step / 2;

    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    g.ctx.fillStyle = rgba(palette.ink, 0.86);
    g.ctx.fill();
    g.ctx.restore();
    g.ring(cx, cy, outer, theme.line, 2);

    EMOTES.forEach((e, i) => {
      const a0 = start + i * step;
      const a1 = a0 + step;
      const mid = (a0 + a1) / 2;
      const selected = i === wheelChoice;
      const grow = g.anim(`wheel${i}`, selected ? 1 : 0, tokens.motion.fast);
      const ro = outer - 2 + grow * 3;

      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.arc(cx, cy, ro, a0 + 0.012, a1 - 0.012);
      g.ctx.arc(cx, cy, inner, a1 - 0.012, a0 + 0.012, true);
      g.ctx.closePath();
      g.ctx.fillStyle = selected ? rgba(palette.primary, 0.42) : rgba(palette.surfaceAlt, 0.55);
      g.ctx.fill();
      g.ctx.strokeStyle = selected ? palette.accent : theme.line;
      g.ctx.lineWidth = selected ? 3 : 1;
      g.ctx.stroke();
      g.ctx.restore();

      const gr = (inner + ro) / 2;
      const gx = cx + Math.cos(mid) * gr;
      const gy = cy + Math.sin(mid) * gr;
      g.text(e.glyph, gx, gy - 10, {
        role: "h1",
        size: 52 + grow * 6,
        align: "centre",
        color: selected ? theme.fg : theme.fg2,
      });
      g.text(e.label, gx, gy + 28, {
        role: "caption",
        size: 20,
        align: "centre",
        color: selected ? palette.accent : theme.fgMuted,
        maxWidth: 150,
      });
    });

    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.arc(cx, cy, inner - 4, 0, Math.PI * 2);
    g.ctx.fillStyle = rgba(palette.surface, 0.95);
    g.ctx.fill();
    g.ctx.restore();
    g.ring(cx, cy, inner - 4, theme.line, 1);
    g.text(wheelChoice < 0 ? "Release" : "Send", cx, cy - 11, {
      role: "caption",
      size: 21,
      align: "centre",
      color: theme.fg2,
    });
    g.text(wheelChoice < 0 ? "to cancel" : EMOTES[wheelChoice].label, cx, cy + 14, {
      role: "caption",
      size: 21,
      align: "centre",
      color: wheelChoice < 0 ? theme.fgMuted : palette.accent,
      maxWidth: inner * 1.7,
    });
  }
  wheel.setRenderer(renderWheel);

  function updateWheel(dt: number, pointers: readonly PointerState[]): void {
    if (wheelPointer < 0) {
      wheel.update(dt, []);
      return;
    }

    // Head-locked while open — a radial menu you have to chase is a bad radial
    // menu, and it is on screen for well under a second.
    engine.camera.updateWorldMatrix(true, false);
    const camPos = new THREE.Vector3();
    const camQuat = new THREE.Quaternion();
    engine.camera.getWorldPosition(camPos);
    engine.camera.getWorldQuaternion(camQuat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    wheel.group.position.copy(camPos).addScaledVector(fwd, 0.55);
    wheel.group.quaternion.copy(camQuat);

    const own = pointers.filter((p) => p.id === wheelPointer);
    wheel.update(dt, own);

    const pt = wheel.hitPoint();
    let choice = -1;
    if (pt) {
      const cx = wheel.designW / 2;
      const cy = wheel.designH / 2;
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const dist = Math.hypot(dx, dy);
      const outer = Math.min(wheel.designW, wheel.designH) / 2;
      if (dist > outer * WHEEL_DEAD_ZONE) {
        const n = EMOTES.length;
        const step = (Math.PI * 2) / n;
        let a = Math.atan2(dy, dx) - (-Math.PI / 2 - step / 2);
        a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        choice = Math.floor(a / step) % n;
      }
    }
    if (choice !== wheelChoice) {
      wheelChoice = choice;
      wheel.markDirty();
      if (choice >= 0) engine.haptic(wheelPointer, 0.2, 14);
    }
  }

  // ── Emote floaters ────────────────────────────────────────────────────────

  const emoteTextures = new Map<EmoteId, THREE.CanvasTexture>();
  for (const e of EMOTES) {
    emoteTextures.set(e.id, buildEmoteTexture(e.glyph, e.label));
  }

  interface Floater {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    t: number;
    base: THREE.Vector3;
    active: boolean;
  }

  const floaterGeo = new THREE.PlaneGeometry(0.19, 0.12);
  const floaters: Floater[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(floaterGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 30;
    parent.add(mesh);
    floaters.push({ mesh, t: 0, base: new THREE.Vector3(), active: false });
  }

  let seatAnchor: ((seat: number) => THREE.Vector3 | null) | null = null;

  function playEmote(seat: number, id: EmoteId): void {
    const slot = floaters.find((f) => !f.active) ?? floaters[0];
    const tex = emoteTextures.get(id);
    if (!tex) return;

    const anchor = seatAnchor?.(seat) ?? null;
    slot.base.copy(anchor ?? group.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
    slot.mesh.material.map = tex;
    slot.mesh.material.color.set(seatColor(seat));
    slot.mesh.material.needsUpdate = true;
    slot.mesh.position.copy(slot.base);
    slot.mesh.visible = true;
    slot.t = 0;
    slot.active = true;
  }

  function updateFloaters(dt: number): void {
    const camQuat = new THREE.Quaternion();
    let any = false;
    for (const f of floaters) {
      if (!f.active) continue;
      any = true;
      f.t += dt;
      const life = 1.8;
      const k = Math.min(1, f.t / life);
      // Rise fast, then settle; fade only at the end so it is readable first.
      const ease = 1 - Math.pow(1 - k, 3);
      f.mesh.position.copy(f.base);
      f.mesh.position.y += 0.14 + ease * 0.24;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, (k - 0.12) * 0.4);
      f.mesh.scale.setScalar(pop);
      f.mesh.material.opacity = k < 0.7 ? Math.min(1, k * 8) : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k >= 1) {
        f.active = false;
        f.mesh.visible = false;
      }
    }
    if (any) {
      engine.camera.getWorldQuaternion(camQuat);
      for (const f of floaters) if (f.active) f.mesh.quaternion.copy(camQuat);
    }
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  function update(dt: number, pointers: readonly PointerState[]): void {
    if (visible) {
      const secs = secondsLeft();
      if (secs !== lastSecondsLeft) {
        lastSecondsLeft = secs;
        board.markDirty();
      }
      if (props.startedAt > 0) {
        const el = Math.floor((Date.now() - props.startedAt) / 1000);
        if (el !== lastElapsed) {
          lastElapsed = el;
          board.markDirty();
        }
      }

      // Attention pulse for "your turn". Two slow breaths, then it stops —
      // a permanently pulsing element is just flicker.
      const mine = isMyTurn() && !isFreeForAll();
      if (mine) {
        pulseT += dt;
        const decay = Math.max(0, 1 - pulseT / 3.2);
        pulseMat.opacity = decay * 0.13 * (0.5 + 0.5 * Math.sin(pulseT * 3.4));
      } else {
        pulseT = 0;
        pulseMat.opacity = 0;
      }
    }

    board.update(dt, visible ? pointers : []);
    updateWheel(dt, pointers);
    updateFloaters(dt);
  }

  function applyPlacement(): void {
    const p = PLACEMENTS[placement];
    group.position.copy(p.pos);
    group.rotation.set(p.tilt, 0, 0);
    group.scale.setScalar(p.scale);
  }
  applyPlacement();

  board.setRenderer(render);

  return {
    group,
    set(patch: Partial<HudProps>): void {
      props = { ...props, ...patch };
      lastSecondsLeft = -1;
      board.markDirty();
    },
    setVisible(v: boolean): void {
      visible = v;
      board.setVisible(v);
      if (!v) pulseMat.opacity = 0;
    },
    setPlacement(mode: "table" | "room"): void {
      placement = mode;
      applyPlacement();
    },
    setSeatAnchor(fn): void {
      seatAnchor = fn;
    },
    playEmote,
    openEmoteWheel(pointerId: number): void {
      wheelPointer = pointerId;
      wheelChoice = -1;
      wheel.setVisible(true);
      wheel.markDirty();
      engine.haptic(pointerId, 0.3, 20);
    },
    closeEmoteWheel(commit: boolean): EmoteId | null {
      if (wheelPointer < 0) return null;
      const picked = commit && wheelChoice >= 0 ? EMOTES[wheelChoice].id : null;
      wheelPointer = -1;
      wheelChoice = -1;
      wheel.setVisible(false);
      if (picked) emit({ type: "sendEmote", emote: picked });
      return picked;
    },
    emoteWheelOpen(): boolean {
      return wheelPointer >= 0;
    },
    update,
    onAction(cb): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose(): void {
      listeners.clear();
      board.dispose();
      wheel.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      floaterGeo.dispose();
      for (const f of floaters) {
        f.mesh.material.dispose();
        f.mesh.removeFromParent();
      }
      for (const t of emoteTextures.values()) t.dispose();
      emoteTextures.clear();
      group.removeFromParent();
    },
  };
}

// ── Emote texture ───────────────────────────────────────────────────────────

/**
 * Emotes are drawn as an untinted mask on transparent, so one texture per emote
 * can be coloured to the sender's seat by the material — five small textures
 * for eight players, instead of forty.
 *
 * The mask colour is `text.onPrimary` rather than a literal white: it is the
 * palette's "reads on a saturated fill" value, so a re-skin carries through
 * here like everywhere else.
 */
function buildEmoteTexture(glyph: string, label: string): THREE.CanvasTexture {
  const mask = ink.onPrimary;
  const w = 304;
  const h = 192;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const r = 26;
    ctx.beginPath();
    ctx.moveTo(r, 8);
    ctx.arcTo(w - 8, 8, w - 8, h - 46, r);
    ctx.arcTo(w - 8, h - 46, 8, h - 46, r);
    ctx.arcTo(8, h - 46, 8, 8, r);
    ctx.arcTo(8, 8, w - 8, 8, r);
    ctx.closePath();
    ctx.fillStyle = rgba(mask, 0.16);
    ctx.fill();
    ctx.strokeStyle = rgba(mask, 0.9);
    ctx.lineWidth = 3;
    ctx.stroke();

    // Speech tail, so it reads as "someone said this".
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, h - 48);
    ctx.lineTo(w / 2, h - 12);
    ctx.lineTo(w / 2 + 20, h - 48);
    ctx.closePath();
    ctx.fillStyle = rgba(mask, 0.9);
    ctx.fill();

    ctx.fillStyle = mask;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 74px ${tokens.font.display}`;
    ctx.fillText(glyph, w / 2, 74);
    ctx.font = `600 26px ${tokens.font.body}`;
    ctx.fillText(label, w / 2, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
