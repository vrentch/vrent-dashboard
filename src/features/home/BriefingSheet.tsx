import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import { fetchQuotes, type Quote, type NewsItem } from "../../lib/api";
import { fmtPct, displayPrice, timeAgo } from "../../lib/format";
import { greeting } from "../../lib/marketStatus";
import { categoryOf, type CalEvent } from "../../lib/calendar";
import HeadlineImage from "../news/HeadlineImage";
import { TrendingUp, TrendingDown, CalendarDays, Newspaper } from "lucide-react";

const INDICES = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "^DJI", label: "Dow" },
  { symbol: "^SSMI", label: "SMI" },
  { symbol: "^STOXX50E", label: "Euro Stoxx" },
  { symbol: "BTC-USD", label: "Bitcoin" },
];

export default function BriefingSheet({
  open,
  onClose,
  movers,
  avgChange,
  news,
  events,
  onOpenArticle,
}: {
  open: boolean;
  onClose: () => void;
  movers: Quote[];
  avgChange: number | null;
  news: NewsItem[];
  events: CalEvent[];
  onOpenArticle: (n: NewsItem) => void;
}) {
  const [indices, setIndices] = useState<Quote[]>([]);

  useEffect(() => {
    if (!open) return;
    let c = false;
    fetchQuotes(INDICES.map((i) => i.symbol))
      .then((r) => !c && setIndices(r.quotes))
      .catch(() => {});
    return () => {
      c = true;
    };
  }, [open]);

  const best = movers.find((q) => (q.changePercent ?? 0) > 0);
  const worst = [...movers].reverse().find((q) => (q.changePercent ?? 0) < 0);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <Sheet open={open} onClose={onClose} title="Today's briefing">
      <div className="space-y-6">
        <div>
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{greeting()} 👋</p>
          <p className="text-sm text-slate-400 dark:text-slate-500">{today}</p>
        </div>

        {/* Markets */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Markets</h3>
          <div className="grid grid-cols-2 gap-2">
            {indices.length === 0
              ? INDICES.map((i) => <div key={i.symbol} className="h-16 rounded-xl skeleton" />)
              : INDICES.map((def) => {
                  const q = indices.find((x) => x.symbol.toUpperCase() === def.symbol.toUpperCase());
                  const up = (q?.changePercent ?? 0) >= 0;
                  return (
                    <div key={def.symbol} className="rounded-xl glass-subtle p-3">
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{def.label}</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{q ? displayPrice(q.price, q.currency, q.symbol) : "—"}</p>
                      {q?.changePercent != null && (
                        <p className={`text-xs font-semibold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{fmtPct(q.changePercent)}</p>
                      )}
                    </div>
                  );
                })}
          </div>
        </section>

        {/* Your watchlist */}
        {movers.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Your watchlist</h3>
            <div className="rounded-2xl glass-subtle p-4 space-y-2">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                On average {avgChange != null ? (avgChange >= 0 ? "up" : "down") : "flat"}{" "}
                <b className={avgChange != null && avgChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{fmtPct(avgChange)}</b> today.
              </p>
              <div className="flex gap-2">
                {best && (
                  <div className="flex-1 flex items-center gap-1.5 text-sm">
                    <TrendingUp size={14} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{best.symbol}</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{fmtPct(best.changePercent)}</span>
                  </div>
                )}
                {worst && (
                  <div className="flex-1 flex items-center gap-1.5 text-sm">
                    <TrendingDown size={14} className="text-rose-600 dark:text-rose-400" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{worst.symbol}</span>
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">{fmtPct(worst.changePercent)}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Today's events */}
        {events.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
              <CalendarDays size={12} /> Your day
            </h3>
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-xl glass-subtle p-3">
                  <span className="w-1.5 h-8 rounded-full" style={{ backgroundColor: categoryOf(e.category).color }} />
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${e.done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>{e.title}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{e.allDay ? "All day" : e.start}{e.location ? ` · ${e.location}` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Top stories */}
        {news.length > 0 && (
          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
              <Newspaper size={12} /> Top stories for you
            </h3>
            <div className="space-y-2">
              {news.slice(0, 6).map((n) => (
                <button key={n.id} onClick={() => onOpenArticle(n)} className="w-full flex items-center gap-3 rounded-xl glass-subtle p-2.5 text-left active:scale-[0.99]">
                  <HeadlineImage item={n} size="sm" className="w-14 h-14 rounded-lg shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">{n.title}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{n.source} · {timeAgo(n.publishedAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
