import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Full-screen image viewer: pinch to zoom, drag to pan, double-tap to zoom
// in/out, tap ✕ (or the backdrop while un-zoomed) to close. Pointer-events
// based so it works with touch, trackpad and mouse alike.
const MIN_S = 1;
const MAX_S = 6;
const DTAP_S = 2.6;

export default function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [smooth, setSmooth] = useState(false);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ s: 1, x: 0, y: 0, dist: 0, mid: { x: 0, y: 0 }, moved: false });
  const lastTap = useRef(0);

  useEffect(() => {
    // No page scrolling behind the viewer.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function center(): { x: number; y: number } {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 };
  }

  function clamp(next: { s: number; x: number; y: number }) {
    const r = box.current?.getBoundingClientRect();
    const s = Math.max(MIN_S, Math.min(MAX_S, next.s));
    // Keep the image roughly on screen: the pannable range grows with zoom.
    const mx = r ? ((s - 1) * r.width) / 2 : 0;
    const my = r ? ((s - 1) * r.height) / 2 : 0;
    return { s, x: Math.max(-mx, Math.min(mx, next.x)), y: Math.max(-my, Math.min(my, next.y)) };
  }

  function snapshot() {
    const ps = [...ptrs.current.values()];
    if (ps.length >= 2) {
      start.current.dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      start.current.mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
    } else if (ps.length === 1) {
      start.current.mid = { ...ps[0] };
    }
    start.current.s = t.s;
    start.current.x = t.x;
    start.current.y = t.y;
  }

  function onDown(e: React.PointerEvent) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current.moved = false;
    setSmooth(false);
    snapshot();
  }

  function onMove(e: React.PointerEvent) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...ptrs.current.values()];
    const st = start.current;
    if (ps.length >= 2 && st.dist > 0) {
      // Pinch: scale about the fingers' midpoint.
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const s = Math.max(MIN_S, Math.min(MAX_S, (st.s * dist) / st.dist));
      const c = center();
      const v = { x: st.mid.x - c.x, y: st.mid.y - c.y };
      const k = s / st.s;
      setT(clamp({ s, x: v.x - k * (v.x - st.x), y: v.y - k * (v.y - st.y) }));
      st.moved = true;
    } else if (ps.length === 1) {
      const dx = ps[0].x - st.mid.x;
      const dy = ps[0].y - st.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true;
      if (t.s > 1) setT(clamp({ s: st.s, x: st.x + dx, y: st.y + dy }));
    }
  }

  function onUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size > 0) { snapshot(); return; }
    if (!start.current.moved) {
      const now = Date.now();
      if (now - lastTap.current < 320) {
        // Double-tap: zoom to the tapped spot, or reset when already zoomed.
        lastTap.current = 0;
        setSmooth(true);
        if (t.s > 1.05) setT({ s: 1, x: 0, y: 0 });
        else {
          const c = center();
          const v = { x: e.clientX - c.x, y: e.clientY - c.y };
          setT(clamp({ s: DTAP_S, x: v.x * (1 - DTAP_S), y: v.y * (1 - DTAP_S) }));
        }
      } else {
        lastTap.current = now;
        // A single un-zoomed tap closes (like the Photos app).
        if (t.s <= 1.05) setTimeout(() => { if (lastTap.current === now) onClose(); }, 330);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center" role="dialog" aria-label="Image viewer">
      <div
        ref={box}
        className="w-full h-full grid place-items-center"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
            transition: smooth ? "transform 0.25s cubic-bezier(0.22,1,0.36,1)" : "none",
          }}
        />
      </div>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 grid place-items-center w-10 h-10 rounded-full bg-white/15 text-white backdrop-blur active:scale-95 safe-top"
        aria-label="Close"
      >
        <X size={20} />
      </button>
      <p className="absolute bottom-6 inset-x-0 text-center text-[11px] text-white/50 pointer-events-none">Pinch or double-tap to zoom</p>
    </div>
  );
}
