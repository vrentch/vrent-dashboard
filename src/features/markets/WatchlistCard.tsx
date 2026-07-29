import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Star, Pencil, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { fetchQuotes, type Quote } from "../../lib/api";
import { usePrefs, activeWatchlist, setActiveWatchlist } from "../../lib/store";
import { fmtPct, cleanSymbol, displayPrice } from "../../lib/format";

// Deterministic pastel gradient per symbol, so each row has a stable "coin".
function monogramStyle(sym: string): React.CSSProperties {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 75% 62%), hsl(${(h + 40) % 360} 75% 52%))` };
}

export default function WatchlistCard({
  onOpenList,
  onEdit,
  onSelect,
}: {
  onOpenList: () => void;
  onEdit: () => void;
  onSelect: (q: Quote) => void;
}) {
  const prefs = usePrefs();
  const active = activeWatchlist(prefs);
  const symbols = prefs.watchlist;
  const key = symbols.join(",");

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbols.length) {
      setQuotes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchQuotes(symbols)
      .then((r) => !cancelled && setQuotes(r.quotes))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const withPct = useMemo(() => quotes.filter((q) => q.changePercent != null), [quotes]);
  const avg = withPct.length ? withPct.reduce((a, b) => a + (b.changePercent ?? 0), 0) / withPct.length : null;
  const up = withPct.filter((q) => (q.changePercent ?? 0) > 0).length;
  const down = withPct.filter((q) => (q.changePercent ?? 0) < 0).length;
  const teaser = useMemo(
    () => [...withPct].sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0)).slice(0, 4),
    [withPct]
  );
  const avgUp = (avg ?? 0) >= 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">My list</h2>
          {prefs.watchlists.length > 1 && (
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">· {active.name}</span>
          )}
        </div>
        <button onClick={onOpenList} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
          View all <ChevronRight size={14} />
        </button>
      </div>

      <div className="rounded-3xl glass p-4 space-y-4">
        {/* List switcher */}
        {prefs.watchlists.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            {prefs.watchlists.map((w) => (
              <button
                key={w.id}
                onClick={() => setActiveWatchlist(w.id)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition border ${
                  w.id === prefs.activeWatchlistId
                    ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700"
                    : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}

        {loading && symbols.length > 0 ? (
          <div className="space-y-2.5">
            <div className="h-16 rounded-2xl skeleton" />
            {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-xl skeleton" />)}
          </div>
        ) : symbols.length === 0 ? (
          <EmptyState onEdit={onEdit} />
        ) : (
          <>
            {/* Summary hero */}
            <button
              onClick={onOpenList}
              className="w-full text-left relative overflow-hidden rounded-2xl p-4 active:scale-[0.99] transition"
              style={{
                background: avgUp
                  ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                  : "linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)",
                boxShadow: `0 10px 30px ${avgUp ? "rgba(16,185,129,0.30)" : "rgba(244,63,94,0.30)"}`,
              }}
            >
              <div className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-white/15 blur-2xl" />
              <div className="relative flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Today · average</p>
                  <p className="text-3xl font-bold text-white tabular-nums leading-tight mt-0.5">
                    {avg != null ? fmtPct(avg) : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-white/95 text-sm font-semibold">
                  <span className="inline-flex items-center gap-1"><TrendingUp size={15} /> {up}</span>
                  <span className="inline-flex items-center gap-1"><TrendingDown size={15} /> {down}</span>
                </div>
              </div>
            </button>

            {/* Teaser rows */}
            <div className="space-y-1">
              {teaser.map((q) => {
                const rowUp = (q.changePercent ?? 0) >= 0;
                const sym = cleanSymbol(q.symbol);
                return (
                  <button
                    key={q.symbol}
                    onClick={() => onSelect(q)}
                    className="w-full flex items-center gap-3 py-2 px-1 rounded-xl active:bg-black/[0.03] dark:active:bg-white/5 transition text-left"
                  >
                    <span
                      className="grid place-items-center w-9 h-9 shrink-0 rounded-xl text-white text-[11px] font-bold shadow-sm"
                      style={monogramStyle(sym)}
                    >
                      {sym.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{sym}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{q.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {displayPrice(q.price, q.currency, q.symbol)}
                      </p>
                      <p className={`text-xs font-semibold tabular-nums ${rowUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {fmtPct(q.changePercent)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={onOpenList}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl glass-subtle text-sm font-semibold text-slate-700 dark:text-slate-200 active:scale-[0.98]"
              >
                <Star size={15} className="text-amber-500" fill="currentColor" />
                View all {symbols.length}
              </button>
              <button
                onClick={onEdit}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]"
              >
                <Pencil size={15} /> Edit
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EmptyState({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="mx-auto w-12 h-12 grid place-items-center rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 mb-3">
        <Star size={22} fill="currentColor" />
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Build your watchlist</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-4">Track the stocks, crypto & indices you care about.</p>
      <button
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-95"
      >
        <Plus size={15} /> Add symbols
      </button>
    </div>
  );
}
