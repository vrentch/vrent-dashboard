import { useEffect, useState } from "react";

// A progress ring that sweeps to its value on mount — the "moving graph" that
// makes the overview feel live. Gradient stroke, rounded cap, and a soft glow
// track behind it so it reads on both light and dark glass.
export default function StatRing({
  pct,
  size = 74,
  stroke = 7,
  from,
  to,
  children,
  glow = true,
}: {
  pct: number;              // 0–1 (values above 1 clamp, ring turns "full")
  size?: number;
  stroke?: number;
  from: string;
  to: string;
  children?: React.ReactNode;
  glow?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, pct || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  const id = `ring-${from.replace("#", "")}-${to.replace("#", "")}`;

  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(clamped); return; }
    const t = setTimeout(() => setShown(clamped), 80);
    return () => clearTimeout(t);
  }, [clamped]);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-slate-900/8 dark:stroke-white/10"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          stroke={`url(#${id})`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{
            transition: "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)",
            filter: glow ? `drop-shadow(0 0 5px ${to}66)` : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">{children}</div>
    </div>
  );
}
