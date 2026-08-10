import { useEffect, useRef, useState } from "react";

// Count a number up to its target the first time it lands (and whenever it
// changes), so figures feel alive instead of snapping into place. Honest about
// motion preferences: reduced-motion users get the final value immediately.
export function useCountUp(target: number, ms = 750): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !isFinite(target)) { from.current = target; setShown(target); return; }
    const start = performance.now();
    const a = from.current;
    const b = target;
    if (a === b) return;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      // easeOutCubic — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (b - a) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, ms]);

  return shown;
}
