import { useEffect, useRef, useState } from "react";
import { X, BookOpen, ExternalLink, ChevronUp } from "lucide-react";
import type { NewsItem } from "../../lib/api";
import { timeAgo, hostOf } from "../../lib/format";
import { markSeen } from "../../lib/seen";
import HeadlineImage from "./HeadlineImage";

/** Full-screen, swipeable (vertical scroll-snap) news reader — Shorts/Stories style. */
export default function StoriesViewer({
  open,
  items,
  onClose,
  onOpenArticle,
}: {
  open: boolean;
  items: NewsItem[];
  onClose: () => void;
  onOpenArticle: (it: NewsItem) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    scroller.current?.scrollTo({ top: 0 });
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Mark the current story as seen so Shorts stops resurfacing it.
  useEffect(() => {
    if (open && items[idx]) markSeen(items[idx].id);
  }, [open, idx, items]);

  if (!open || items.length === 0) return null;

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== idx) setIdx(Math.max(0, Math.min(items.length - 1, i)));
  }

  return (
    <div className="fixed inset-0 z-[45] bg-black">
      {/* Top bar: progress segments + close */}
      <div className="absolute top-0 inset-x-0 z-20 safe-top">
        <div className="flex gap-1 px-3 pt-3">
          {items.slice(0, 40).map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full bg-white/25 overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: i < idx ? "100%" : i === idx ? "100%" : "0%", opacity: i <= idx ? 1 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-4 pt-2">
          <span className="text-xs font-semibold text-white/80">{idx + 1} / {items.length}</span>
          <button onClick={onClose} className="grid place-items-center w-9 h-9 rounded-full bg-white/15 backdrop-blur text-white active:scale-90" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto snap-y snap-mandatory no-scrollbar"
      >
        {items.map((it) => (
          <section key={it.id} className="relative h-[100dvh] snap-start snap-always overflow-hidden">
            <HeadlineImage item={it} size="lg" className="absolute inset-0 w-full h-full" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.92) 100%)" }} />

            <div className="absolute inset-x-0 bottom-0 p-5 pb-10 safe-bottom">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/90 bg-white/15 backdrop-blur px-2 py-0.5 rounded-full">{it.source || hostOf(it.link)}</span>
                <span className="text-[11px] text-white/70">{timeAgo(it.publishedAt)}</span>
              </div>
              <h2 className="text-[22px] leading-tight font-bold text-white">{it.title}</h2>
              {it.summary && <p className="mt-2 text-sm text-white/80 line-clamp-4">{it.summary}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={() => onOpenArticle(it)} className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-white text-slate-900 text-sm font-bold active:scale-[0.98]">
                  <BookOpen size={16} /> Read
                </button>
                <button onClick={() => window.open(it.link, "_blank")} className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white/15 backdrop-blur text-white text-sm font-semibold active:scale-95">
                  <ExternalLink size={16} /> Open
                </button>
              </div>
            </div>

            {/* Swipe hint on the first slide */}
            {idx === 0 && items.length > 1 && (
              <div className="absolute bottom-2 inset-x-0 flex flex-col items-center text-white/60 animate-in">
                <ChevronUp size={18} className="animate-bounce" />
                <span className="text-[10px] font-medium">swipe up</span>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
