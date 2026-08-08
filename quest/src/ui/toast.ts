/**
 * Transient in-world notices — "Player joined", "Reconnecting…", "Room full".
 *
 * Placement is the whole design problem. Head-locked text is nauseating and
 * reads as a bug; a notice pinned to the board is missed when you are looking
 * elsewhere. So the stack soft-follows the head with a ~0.2 s lag and sits low
 * in the field of view: it settles where you are looking, drifts rather than
 * snaps when you turn, and never covers the board.
 *
 * The whole stack shares one canvas and one texture. Toasts are frequent but
 * short-lived, and three separate panels would mean three uploads per change.
 */

import * as THREE from "three";
import { palette, rgba, tokens } from "../../shared/brand.ts";
import type { Engine } from "../contracts.ts";
import type { Gfx, Rect } from "./panel.ts";
import { Panel, inset, theme } from "./panel.ts";
import { CONTROL, icon, toneColor, toneIcon } from "./widgets.ts";
import type { Tone } from "./widgets.ts";

export interface ToastOptions {
  text: string;
  detail?: string;
  tone?: Tone;
  /** Lifetime in ms. Defaults scale with tone — errors linger. */
  ms?: number;
  /**
   * Replaces any existing toast with the same key instead of stacking, so a
   * flapping connection produces one line that updates, not twelve.
   */
  key?: string;
}

export interface ToastLayer {
  readonly group: THREE.Group;
  push(o: ToastOptions | string): number;
  dismiss(id: number): void;
  /** Removes a keyed toast, e.g. when the connection recovers. */
  dismissKey(key: string): void;
  clear(): void;
  update(dt: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface Entry {
  id: number;
  key?: string;
  text: string;
  detail?: string;
  tone: Tone;
  born: number;
  expires: number;
  /** 0→1 in, 1→0 out. */
  life: number;
  dying: boolean;
}

const MAX_VISIBLE = 3;
const CARD_H = 108;
const CARD_GAP = 12;

const WIDTH_M = 0.5;
const HEIGHT_M = (CARD_H * MAX_VISIBLE + CARD_GAP * (MAX_VISIBLE - 1)) / 1600;

export interface ToastOptionsInit {
  parent?: THREE.Object3D;
  /** Metres in front of the head. */
  distance?: number;
  /** Metres below the view axis. */
  drop?: number;
}

export function createToastLayer(engine: Engine, init: ToastOptionsInit = {}): ToastLayer {
  const distance = init.distance ?? 1.05;
  const drop = init.drop ?? 0.3;

  const panel = new Panel({
    width: WIDTH_M,
    height: HEIGHT_M,
    curveRadius: 0,
    chrome: false,
    padding: 0,
    reticle: false,
    name: "vr-toasts",
    renderOrder: 40,
    anisotropy: engine.renderer.capabilities.getMaxAnisotropy(),
  });
  panel.mesh.material.depthTest = false;

  // Parented to the scene, not `engine.world`: recentring the board must not
  // drag the notices with it.
  const parent = init.parent ?? engine.scene;
  parent.add(panel.group);

  const entries: Entry[] = [];
  let nextId = 1;
  let visible = true;

  const target = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  let settled = false;

  function defaultMs(tone: Tone): number {
    return tone === "danger" ? 6000 : tone === "warn" ? 4800 : 3200;
  }

  function push(o: ToastOptions | string): number {
    const opts: ToastOptions = typeof o === "string" ? { text: o } : o;
    const tone = opts.tone ?? "info";
    const now = performance.now();

    if (opts.key) {
      const existing = entries.find((e) => e.key === opts.key && !e.dying);
      if (existing) {
        existing.text = opts.text;
        existing.detail = opts.detail;
        existing.tone = tone;
        existing.expires = now + (opts.ms ?? defaultMs(tone));
        panel.markDirty();
        return existing.id;
      }
    }

    const entry: Entry = {
      id: nextId++,
      key: opts.key,
      text: opts.text,
      detail: opts.detail,
      tone,
      born: now,
      expires: now + (opts.ms ?? defaultMs(tone)),
      life: 0,
      dying: false,
    };
    entries.push(entry);
    // Oldest gives way once the stack is full; a wall of notices is noise.
    const live = entries.filter((e) => !e.dying);
    if (live.length > MAX_VISIBLE) live[0].dying = true;
    panel.markDirty();
    return entry.id;
  }

  function dismiss(id: number): void {
    const e = entries.find((x) => x.id === id);
    if (e && !e.dying) {
      e.dying = true;
      panel.markDirty();
    }
  }

  function dismissKey(key: string): void {
    for (const e of entries) if (e.key === key && !e.dying) e.dying = true;
    panel.markDirty();
  }

  function clear(): void {
    for (const e of entries) e.dying = true;
    panel.markDirty();
  }

  function render(g: Gfx): void {
    const live = entries.filter((e) => e.life > 0.001);
    if (live.length === 0) return;

    // Newest at the bottom, closest to where the eye already is.
    let slot = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      drawCard(g, e, slot, g.bounds);
      slot += 1;
      if (slot >= MAX_VISIBLE) break;
    }
  }

  function drawCard(g: Gfx, e: Entry, slot: number, bounds: Rect): void {
    const col = toneColor(e.tone);
    const baseY = bounds.y + bounds.h - CARD_H - slot * (CARD_H + CARD_GAP);
    const ease = e.life * e.life * (3 - 2 * e.life);
    const r: Rect = {
      x: bounds.x + 4 + (1 - ease) * 26,
      y: baseY + (1 - ease) * 18,
      w: bounds.w - 8,
      h: CARD_H,
    };

    g.save();
    g.alpha(ease);

    g.ctx.save();
    g.ctx.shadowColor = rgba(palette.ink, 0.6);
    g.ctx.shadowBlur = 18;
    g.ctx.shadowOffsetY = 5;
    g.fillRound(r, tokens.radius.md, rgba(palette.surface, 0.97));
    g.ctx.restore();

    g.strokeRound(r, tokens.radius.md, rgba(col, 0.5));
    // Leading colour rail plus an icon — never colour alone.
    g.fillRound({ x: r.x, y: r.y + 10, w: 5, h: r.h - 20 }, 3, col);
    icon(g, toneIcon(e.tone), r.x + 40, r.y + r.h / 2, 26, col, 3);

    const tx = r.x + 70;
    const tw = r.w - 90;
    if (e.detail) {
      g.text(e.text, tx, r.y + r.h * 0.36, { role: "bodyStrong", color: theme.fg, maxWidth: tw });
      g.text(e.detail, tx, r.y + r.h * 0.68, { role: "caption", color: theme.fg2, maxWidth: tw });
    } else {
      g.text(e.text, tx, r.y + r.h / 2 + 1, { role: "bodyStrong", color: theme.fg, maxWidth: tw });
    }

    // A hairline countdown along the bottom edge — quiet, but it explains why
    // the notice is about to vanish.
    const remain = Math.max(0, Math.min(1, (e.expires - performance.now()) / Math.max(1, e.expires - e.born)));
    if (!e.dying && remain > 0) {
      const bar = inset(r, 0, 14, 6, 14);
      g.hairline(bar.x, r.y + r.h - 7, bar.x + bar.w * remain, r.y + r.h - 7, rgba(col, 0.55));
    }

    g.restore();
  }

  panel.setRenderer(render);

  function update(dt: number): void {
    const now = performance.now();
    let changed = false;

    for (const e of entries) {
      if (!e.dying && now >= e.expires) e.dying = true;
      const target = e.dying ? 0 : 1;
      if (e.life !== target) {
        const rate = 1 - Math.exp(-dt * (5000 / tokens.motion.base));
        e.life += (target - e.life) * rate;
        if (Math.abs(target - e.life) < 0.01) e.life = target;
        changed = true;
      }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].dying && entries[i].life === 0) {
        entries.splice(i, 1);
        changed = true;
      }
    }
    if (changed) panel.markDirty();

    const active = visible && entries.length > 0;
    panel.setVisible(active);
    if (active) followHead(dt);
    panel.update(dt, []);
  }

  function followHead(dt: number): void {
    engine.camera.updateWorldMatrix(true, false);
    engine.camera.getWorldPosition(camPos);
    engine.camera.getWorldQuaternion(camQuat);

    forward.set(0, 0, -1).applyQuaternion(camQuat);
    // Level the follow direction so the stack does not swing up when you look
    // at the ceiling — only its yaw tracks the head.
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    up.set(0, 1, 0);

    target.copy(camPos).addScaledVector(forward, distance).addScaledVector(up, -drop);

    if (!settled) {
      panel.group.position.copy(target);
      settled = true;
    } else {
      // ~0.2 s time constant: it trails the head instead of being nailed to it.
      const k = 1 - Math.exp(-dt * 5.5);
      panel.group.position.lerp(target, k);
    }

    // Face the head, but stay upright.
    const look = camPos.clone();
    look.y = panel.group.position.y;
    panel.group.lookAt(look);
    panel.group.rotateX(-0.12);
  }

  return {
    group: panel.group,
    push,
    dismiss,
    dismissKey,
    clear,
    update,
    setVisible(v: boolean): void {
      visible = v;
      if (!v) settled = false;
    },
    dispose(): void {
      entries.length = 0;
      panel.dispose();
    },
  };
}

/** Convenience matching the widget tone vocabulary. */
export const toastMetrics = { CARD_H, CARD_GAP, MAX_VISIBLE, CONTROL } as const;
