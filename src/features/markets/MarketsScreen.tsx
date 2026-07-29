import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Star, ChevronRight } from "lucide-react";
import { fetchQuotes, type Quote } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { fmtPrice, fmtPct } from "../../lib/format";
import { REGIONS, primaryIndex, type MarketRegion } from "../../data/markets";
import RegionView from "./RegionView";
import StockDetail from "./StockDetail";
import WatchlistEditor from "./WatchlistEditor";

export default function MarketsScreen() {
  const prefs = usePrefs();
  const [indexQuotes, setIndexQuotes] = useState<Record<string, Quote>>({});
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openRegion, setOpenRegion] = useState<MarketRegion | null>(null);
  const [openWatchlist, setOpenWatchlist] = useState(false);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadIndexes = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const symbols = REGIONS.map((r) => primaryIndex(r).symbol);
      const res = await fetchQuotes(symbols);
      const map: Record<string, Quote> = {};
      res.quotes.forEach((q) => (map[q.symbol.toUpperCase()] = q));
      setIndexQuotes(map);
    } catch {
      /* tiles just show a dash */
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadIndexes();
  }, [loadIndexes]);

  return (
    <div>
      <header className="sticky top-0 z-30 bg-[#f6f7f9]/85 backdrop-blur-xl border-b border-slate-200/70 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Markets</h1>
            <p className="text-xs text-slate-400">Tap a market to see its movers</p>
          </div>
          <button
            onClick={() => loadIndexes(true)}
            className="grid place-items-center w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-600 active:scale-95"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          {REGIONS.map((r) => {
            const idx = primaryIndex(r);
            const q = indexQuotes[idx.symbol.toUpperCase()];
            const up = (q?.changePercent ?? 0) >= 0;
            return (
              <button
                key={r.key}
                onClick={() => setOpenRegion(r)}
                className="text-left rounded-2xl bg-white border border-slate-200/70 card-shadow p-4 active:scale-[0.98] transition"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl leading-none">{r.flag}</span>
                  <ChevronRight size={16} className="text-slate-300 mt-1" />
                </div>
                <h2 className="mt-2 text-[15px] font-bold text-slate-900">{r.name}</h2>
                <p className="text-[11px] text-slate-400">{idx.label}</p>
                <div className="mt-2">
                  {!loaded && !q ? (
                    <div className="h-5 w-20 rounded skeleton" />
                  ) : (
                    <p className="text-base font-bold text-slate-900 tabular-nums">
                      {q ? fmtPrice(q.price, q.currency) : "—"}
                    </p>
                  )}
                  {q?.changePercent != null && (
                    <span
                      className={`inline-block mt-0.5 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                        up ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"
                      }`}
                    >
                      {fmtPct(q.changePercent)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Custom list tile */}
          <button
            onClick={() => setOpenWatchlist(true)}
            className="text-left rounded-2xl bg-brand-600 card-shadow p-4 active:scale-[0.98] transition col-span-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star size={20} className="text-white" fill="currentColor" />
                <h2 className="text-[15px] font-bold text-white">My list</h2>
              </div>
              <ChevronRight size={18} className="text-white/70" />
            </div>
            <p className="mt-1 text-xs text-white/80">
              {prefs.watchlist.length
                ? `${prefs.watchlist.length} symbols you picked · tap to view & edit`
                : "Build your own watchlist — tap to add symbols"}
            </p>
          </button>
        </div>
      </div>

      {/* Region window */}
      <RegionView
        open={!!openRegion}
        onClose={() => setOpenRegion(null)}
        title={openRegion?.name ?? ""}
        flag={openRegion?.flag ?? ""}
        indices={openRegion?.indices}
        onSelect={setSelected}
      />

      {/* Custom list window */}
      <RegionView
        open={openWatchlist}
        onClose={() => setOpenWatchlist(false)}
        title="My list"
        flag="⭐"
        symbols={prefs.watchlist}
        onSelect={setSelected}
        watchlist
        onEdit={() => setEditorOpen(true)}
      />

      <StockDetail quote={selected} onClose={() => setSelected(null)} />
      <WatchlistEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
