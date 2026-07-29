import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCw, AlertCircle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { fetchQuotes, fetchHistory, type Quote } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { fmtPct } from "../../lib/format";
import StockRow from "./StockRow";
import StockDetail from "./StockDetail";
import WatchlistEditor from "./WatchlistEditor";

export default function MarketsScreen() {
  const prefs = usePrefs();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Quote | null>(null);

  const key = prefs.watchlist.join(",");

  const loadSparks = useCallback((symbols: string[]) => {
    symbols.forEach((s) => {
      fetchHistory(s, "1M")
        .then((h) => setSparks((prev) => ({ ...prev, [s]: h.closes })))
        .catch(() => {});
    });
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!prefs.watchlist.length) {
        setQuotes([]);
        setLoading(false);
        return;
      }
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const res = await fetchQuotes(prefs.watchlist);
        setQuotes(res.quotes);
        if (!res.quotes.length) setError("Couldn't load market data. Check your symbols.");
        loadSparks(res.quotes.map((q) => q.symbol));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load markets");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, loadSparks]
  );

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const withPct = quotes.filter((q) => q.changePercent != null);
    const gainers = withPct.filter((q) => (q.changePercent ?? 0) > 0).length;
    const losers = withPct.filter((q) => (q.changePercent ?? 0) < 0).length;
    const best = [...withPct].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
    const worst = [...withPct].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))[0];
    return { gainers, losers, best, worst };
  }, [quotes]);

  return (
    <div>
      <header className="sticky top-0 z-30 bg-ink-950/85 backdrop-blur-xl border-b border-white/5 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Markets</h1>
              <p className="text-xs text-slate-500">{prefs.watchlist.length} instruments · live</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(true)}
                className="grid place-items-center w-10 h-10 rounded-full bg-white/5 text-slate-300 active:scale-95"
                aria-label="Refresh"
              >
                <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setEditorOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-sky-500 text-white text-sm font-semibold active:scale-95"
              >
                <Pencil size={15} /> Edit
              </button>
            </div>
          </div>

          {!loading && quotes.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MoverCard label="Top gainer" quote={summary.best} up />
              <MoverCard label="Top loser" quote={summary.worst} up={false} />
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-2.5">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[68px] rounded-2xl skeleton" />
          ))}

        {!loading && error && quotes.length === 0 && (
          <div className="text-center py-16 px-6">
            <AlertCircle className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-400 text-sm">{error}</p>
            <button
              onClick={() => setEditorOpen(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-semibold"
            >
              Edit watchlist
            </button>
          </div>
        )}

        {!loading && !prefs.watchlist.length && (
          <div className="text-center py-16 px-6">
            <p className="text-slate-400 text-sm">Your watchlist is empty.</p>
            <button
              onClick={() => setEditorOpen(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-semibold"
            >
              Add symbols
            </button>
          </div>
        )}

        {!loading &&
          quotes.map((q) => (
            <StockRow key={q.symbol} quote={q} spark={sparks[q.symbol]} onClick={() => setSelected(q)} />
          ))}
      </div>

      <StockDetail quote={selected} onClose={() => setSelected(null)} />
      <WatchlistEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

function MoverCard({ label, quote, up }: { label: string; quote?: Quote; up: boolean }) {
  if (!quote) return <div className="rounded-xl bg-white/5 h-14" />;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const color = (quote.changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="rounded-xl bg-white/5 border border-white/5 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex items-center justify-between mt-0.5">
        <span className="font-semibold text-white text-sm">{quote.symbol}</span>
        <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${color}`}>
          <Icon size={14} />
          {fmtPct(quote.changePercent)}
        </span>
      </div>
    </div>
  );
}
