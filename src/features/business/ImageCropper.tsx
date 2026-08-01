import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCw, Check, X, Maximize } from "lucide-react";

type Box = { x: number; y: number; w: number; h: number };
type Fit = { w: number; h: number };
type DragMode = "move" | "nw" | "ne" | "sw" | "se" | null;

// Full-screen crop + rotate editor. `src` is a data URL; `onDone` returns the
// cropped region as a JPEG data URL. Rotation is baked into a working image so
// the crop math never has to account for it.
export default function ImageCropper({
  src,
  onCancel,
  onDone,
  busy,
}: {
  src: string;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
  busy?: boolean;
}) {
  const [work, setWork] = useState<{ url: string; w: number; h: number } | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: DragMode; px: number; py: number; start: Box } | null>(null);

  // Load the source into a working image (natural size known).
  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => { if (alive) setWork({ url: src, w: im.naturalWidth || 1, h: im.naturalHeight || 1 }); };
    im.src = src;
    return () => { alive = false; };
  }, [src]);

  // Compute the on-screen fit (contain) and reset the crop box to the full image.
  const recomputeFit = useCallback(() => {
    if (!work || !stageRef.current) return;
    const el = stageRef.current;
    const availW = el.clientWidth;
    const availH = el.clientHeight;
    if (availW < 2 || availH < 2) return;
    const scale = Math.min(availW / work.w, availH / work.h);
    const w = Math.max(1, work.w * scale);
    const h = Math.max(1, work.h * scale);
    setFit({ w, h });
    setBox({ x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.92 });
  }, [work]);

  useLayoutEffect(() => { recomputeFit(); }, [recomputeFit]);
  useEffect(() => {
    const onResize = () => recomputeFit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeFit]);

  function rotate() {
    if (!work) return;
    const c = document.createElement("canvas");
    c.width = work.h; c.height = work.w;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const im = new Image();
    im.onload = () => {
      ctx.translate(c.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(im, 0, 0);
      setWork({ url: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height });
    };
    im.src = work.url;
  }

  function reset() { recomputeFit(); }

  // Pointer drag: move the whole box or resize from a corner, clamped to bounds.
  function onDown(mode: DragMode, e: React.PointerEvent) {
    if (!box) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: { ...box } };
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !box || !fit) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const MIN = 40;
    let { x, y, w, h } = d.start;
    if (d.mode === "move") {
      x = Math.min(Math.max(0, d.start.x + dx), fit.w - w);
      y = Math.min(Math.max(0, d.start.y + dy), fit.h - h);
    } else {
      let left = d.start.x, top = d.start.y, right = d.start.x + d.start.w, bottom = d.start.y + d.start.h;
      if (d.mode === "nw") { left = d.start.x + dx; top = d.start.y + dy; }
      if (d.mode === "ne") { right = d.start.x + d.start.w + dx; top = d.start.y + dy; }
      if (d.mode === "sw") { left = d.start.x + dx; bottom = d.start.y + d.start.h + dy; }
      if (d.mode === "se") { right = d.start.x + d.start.w + dx; bottom = d.start.y + d.start.h + dy; }
      left = Math.max(0, Math.min(left, right - MIN));
      top = Math.max(0, Math.min(top, bottom - MIN));
      right = Math.min(fit.w, Math.max(right, left + MIN));
      bottom = Math.min(fit.h, Math.max(bottom, top + MIN));
      x = left; y = top; w = right - left; h = bottom - top;
    }
    setBox({ x, y, w, h });
  }
  function onUp(e: React.PointerEvent) {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }

  function apply() {
    if (!work || !fit || !box) return;
    const sx = work.w / fit.w;
    const sy = work.h / fit.h;
    const cw = Math.max(1, Math.round(box.w * sx));
    const ch = Math.max(1, Math.round(box.h * sy));
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const im = new Image();
    im.onload = () => {
      ctx.drawImage(im, box.x * sx, box.y * sy, cw, ch, 0, 0, cw, ch);
      onDone(c.toDataURL("image/jpeg", 0.9));
    };
    im.src = work.url;
  }

  const H = 34; // handle hit-size (px)

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col safe-top safe-bottom" style={{ touchAction: "none" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button onClick={onCancel} className="grid place-items-center w-10 h-10 rounded-full bg-white/10 active:scale-95" aria-label="Cancel"><X size={20} /></button>
        <span className="text-sm font-semibold">Crop</span>
        <div className="flex gap-2">
          <button onClick={reset} className="grid place-items-center w-10 h-10 rounded-full bg-white/10 active:scale-95" aria-label="Reset"><Maximize size={18} /></button>
          <button onClick={rotate} className="grid place-items-center w-10 h-10 rounded-full bg-white/10 active:scale-95" aria-label="Rotate"><RotateCw size={18} /></button>
        </div>
      </div>

      <div ref={stageRef} className="flex-1 relative overflow-hidden mx-2 mb-2 grid place-items-center">
        {work && fit && box && (
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <img src={work.url} alt="" className="absolute inset-0 w-full h-full select-none" draggable={false} />
            {/* dim outside the crop box */}
            <div className="absolute inset-0 pointer-events-none" style={{
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.55)`,
              // clip the shadow to the crop rect by insetting a transparent window
              clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.x}px ${box.y}px, ${box.x}px ${box.y + box.h}px, ${box.x + box.w}px ${box.y + box.h}px, ${box.x + box.w}px ${box.y}px, ${box.x}px ${box.y}px)`,
            }} />
            {/* crop rectangle */}
            <div
              className="absolute border-2 border-white"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              onPointerDown={(e) => onDown("move", e)}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {(["nw", "ne", "sw", "se"] as const).map((m) => (
                <span
                  key={m}
                  onPointerDown={(e) => { e.stopPropagation(); onDown(m, e); }}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className="absolute bg-white rounded-full border border-black/20"
                  style={{
                    width: H, height: H,
                    left: m.includes("w") ? -H / 2 : undefined,
                    right: m.includes("e") ? -H / 2 : undefined,
                    top: m.includes("n") ? -H / 2 : undefined,
                    bottom: m.includes("s") ? -H / 2 : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-3">
        <button
          onClick={apply}
          disabled={busy || !box}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-white text-black text-sm font-bold active:scale-[0.98] disabled:opacity-60"
        >
          <Check size={18} /> {busy ? "Reading…" : "Use this"}
        </button>
      </div>
    </div>
  );
}
