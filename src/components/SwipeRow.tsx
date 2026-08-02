import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

// Swipe a row left to reveal a Delete button (iOS-style). Tap Delete to confirm,
// or a long swipe deletes directly. Vertical scrolling still works — the row
// only captures clearly-horizontal drags.
const OPEN = 84;      // revealed width
const SNAP = 42;      // past this → stay open
const COMMIT = 150;   // past this → delete immediately

export default function SwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [tx, setTx] = useState(0);
  const [open, setOpen] = useState(false);
  const txRef = useRef(0);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");

  // Keep a ref in sync so the pointerup handler reads the live position (state
  // may not have flushed yet after the final move).
  function apply(v: number) { txRef.current = v; setTx(v); }

  function onDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY, base: open ? -OPEN : 0 };
    axis.current = "none";
  }
  function onMove(e: React.PointerEvent) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axis.current === "h") (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (axis.current !== "h") return;
    e.preventDefault();
    apply(Math.max(-COMMIT - 20, Math.min(0, start.current.base + dx)));
  }
  function onUp() {
    if (axis.current === "h") {
      if (txRef.current <= -COMMIT) { apply(0); setOpen(false); onDelete(); start.current = null; axis.current = "none"; return; }
      const willOpen = txRef.current <= -SNAP;
      setOpen(willOpen);
      apply(willOpen ? -OPEN : 0);
    }
    start.current = null;
    axis.current = "none";
  }

  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ touchAction: "pan-y" }}>
      {/* Delete action behind the row */}
      <button
        onClick={onDelete}
        className="absolute inset-y-0 right-0 w-20 flex items-center justify-center gap-1 bg-rose-500 text-white active:bg-rose-600"
        aria-label="Delete"
        tabIndex={tx < -8 ? 0 : -1}
      >
        <Trash2 size={16} />
      </button>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ transform: `translateX(${tx}px)`, transition: start.current ? "none" : "transform 0.22s cubic-bezier(0.22,1,0.36,1)" }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}
