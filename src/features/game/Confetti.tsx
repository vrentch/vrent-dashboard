import { useEffect, useRef } from "react";

// A small canvas confetti burst — no dependency, no DOM thrash. Particles get
// gravity, drag and spin so the paper tumbles instead of raining straight down.
// Honours prefers-reduced-motion by simply not firing.

interface Particle {
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; rot: number; vr: number; color: string;
}

const WIN_COLORS = ["#6366f1", "#818cf8", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#ffffff"];
const LOSS_COLORS = ["#64748b", "#475569", "#94a3b8", "#334155"];

export default function Confetti({ mode = "win", count = 140 }: { mode?: "win" | "loss"; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const colors = mode === "win" ? WIN_COLORS : LOSS_COLORS;
    const parts: Particle[] = [];
    // Two cannons at the lower corners, angled inwards — reads as a celebration
    // rather than a weather event.
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const spread = (Math.random() * 50 + 40) * (Math.PI / 180);
      const angle = left ? -spread : -Math.PI + spread;
      const speed = 7 + Math.random() * 9;
      parts.push({
        x: left ? w * 0.08 : w * 0.92,
        y: h * 0.82,
        vx: Math.cos(angle) * speed * (left ? 1 : -1),
        vy: Math.sin(angle) * speed,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    let raf = 0;
    const started = performance.now();
    const tick = () => {
      const elapsed = performance.now() - started;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.26;        // gravity
        p.vx *= 0.992;       // drag
        p.vy *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > h + 24) continue;
        alive++;
        const fade = Math.max(0, 1 - Math.max(0, elapsed - 1800) / 1400);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive > 0 && elapsed < 3400) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, count]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 w-full h-full" aria-hidden />;
}
