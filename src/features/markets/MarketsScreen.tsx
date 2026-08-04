import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { fetchQuotes, fetchHistory, type Quote } from "../../lib/api";
import { usePrefs, activeWatchlist } from "../../lib/store";
import { usePoll } from "../../lib/usePoll";
import { fmtPct, displayPrice } from "../../lib/format";
import { REGIONS, primaryIndex, NO_SIGNAL_REGIONS, type MarketRegion } from "../../data/markets";
import Sparkline from "../../components/Sparkline";
import RegionView from "./RegionView";
import StockDetail from "./StockDetail";
import WatchlistEditor from "./WatchlistEditor";
import WatchlistCard from "./WatchlistCard";

export default function MarketsScreen() {
  const prefs = usePrefs();
  const [indexQuotes, setIndexQuotes] = useState<Record<string, Quote>>({});
  const [histories, setHistories] = useState<Record<string, number[]>>({});
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

  // One-off sparkline history for each region's primary index (1-month trend).
  const loadHistories = useCallback(async () => {
    const symbols = REGIONS.map((r) => primaryIndex(r).symbol);
    const results = await Promise.allSettled(symbols.map((s) => fetchHistory(s, "1mo")));
    const map: Record<string, number[]> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") map[symbols[i].toUpperCase()] = (r.value.closes || []).filter((n) => n != null);
    });
    setHistories(map);
  }, []);

  useEffect(() => {
    loadIndexes();
    loadHistories();
  }, [loadIndexes, loadHistories]);
  usePoll(() => loadIndexes(true), 60_000);

  // Overall sentiment across the tracked markets.
  const sentiment = useMemo(() => {
    const qs = REGIONS.map((r) => indexQuotes[primaryIndex(r).symbol.toUpperCase()]).filter((q) => q?.changePercent != null);
    const up = qs.filter((q) => (q!.changePercent ?? 0) >= 0).length;
    const down = qs.length - up;
    const avg = qs.length ? qs.reduce((a, q) => a + (q!.changePercent ?? 0), 0) / qs.length : null;
    return { up, down, avg, total: qs.length };
  }, [indexQuotes]);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Markets</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">Tap a market to see its movers</p>
          </div>
          <button
            onClick={() => loadIndexes(true)}
            className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-4 space-y-6">
        {/* Market sentiment hero */}
        {sentiment.total > 0 && (
          <div className="rounded-3xl p-5 text-white relative overflow-hidden accent-gradient shadow-accent">
            <div className="absolute -right-6 -top-8 w-36 h-36 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Markets today</p>
                <p className="mt-1 text-[30px] font-extrabold display-num tabular-nums">{sentiment.avg != null ? fmtPct(sentiment.avg) : "—"}</p>
                <p className="text-xs text-white/80 mt-0.5">average across {sentiment.total} markets</p>
              </div>
              <div className="flex flex-col gap-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15"><TrendingUp size={14} /> {sentiment.up} up</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15"><TrendingDown size={14} /> {sentiment.down} down</span>
              </div>
            </div>
          </div>
        )}

        {/* Personal watchlist — teaser preview */}
        <WatchlistCard
          onOpenList={() => setOpenWatchlist(true)}
          onEdit={() => {
            setOpenWatchlist(true);
            setEditorOpen(true);
          }}
          onSelect={setSelected}
        />

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Markets</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {REGIONS.map((r) => {
            const idx = primaryIndex(r);
            const q = indexQuotes[idx.symbol.toUpperCase()];
            const up = (q?.changePercent ?? 0) >= 0;
            const hist = histories[idx.symbol.toUpperCase()] || [];
            const sparkUp = hist.length > 1 && hist[hist.length - 1] >= hist[0];
            return (
              <button
                key={r.key}
                onClick={() => setOpenRegion(r)}
                className="text-left rounded-2xl glass p-4 active:scale-[0.98] transition"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl leading-none">{r.flag}</span>
                  <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 mt-1" />
                </div>
                <h2 className="mt-2 text-[15px] font-bold text-slate-900 dark:text-slate-100">{r.name}</h2>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">{idx.label}</p>
                <div className="mt-2">
                  {!loaded && !q ? (
                    <div className="h-5 w-20 rounded skeleton" />
                  ) : (
                    <p className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {q ? displayPrice(q.price, q.currency, q.symbol) : "—"}
                    </p>
                  )}
                  {q?.changePercent != null && (
                    <span
                      className={`inline-block mt-0.5 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                        up ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15" : "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15"
                      }`}
                    >
                      {fmtPct(q.changePercent)}
                    </span>
                  )}
                </div>
                {hist.length > 2 && (
                  <div className="mt-2 h-8">
                    <Sparkline values={hist} width={150} height={32} className="w-full h-8" color={sparkUp ? "#10b981" : "#f43f5e"} fill />
                  </div>
                )}
              </button>
            );
          })}
          </div>
        </section>
      </div>

      {/* Region window */}
      <RegionView
        open={!!openRegion}
        onClose={() => setOpenRegion(null)}
        title={openRegion?.name ?? ""}
        flag={openRegion?.flag ?? ""}
        indices={openRegion?.indices}
        enableSignals={openRegion ? !NO_SIGNAL_REGIONS.has(openRegion.key) : true}
        converter={openRegion?.key === "fx"}
        onSelect={setSelected}
      />

      {/* Custom list window */}
      <RegionView
        open={openWatchlist}
        onClose={() => setOpenWatchlist(false)}
        title={activeWatchlist(prefs).name}
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
