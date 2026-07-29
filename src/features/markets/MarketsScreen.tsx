import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCw, AlertCircle } from "lucide-react";
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

  // Group by region, preserving the order regions first appear in the watchlist.
  const groups = useMemo(() => {
    const map = new Map<string, { region: string; flag: string; items: Quote[] }>();
    for (const q of quotes) {
      const g = map.get(q.region) ?? { region: q.region, flag: q.flag, items: [] };
      g.items.push(q);
      map.set(q.region, g);
    }
    return [...map.values()].map((g) => {
      const withPct = g.items.filter((q) => q.changePercent != null);
      const avg = withPct.length
        ? withPct.reduce((a, b) => a + (b.changePercent ?? 0), 0) / withPct.length
        : null;
      return { ...g, avg };
    });
  }, [quotes]);

  return (
    <div>
      <header className="sticky top-0 z-30 bg-[#f6f7f9]/85 backdrop-blur-xl border-b border-slate-200/70 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Markets</h1>
              <p className="text-xs text-slate-400">{prefs.watchlist.length} instruments · live</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(true)}
                className="grid place-items-center w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-600 active:scale-95"
                aria-label="Refresh"
              >
                <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setEditorOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-slate-900 text-white text-sm font-semibold active:scale-95"
              >
                <Pencil size={15} /> Edit
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[68px] rounded-2xl skeleton mb-2.5" />
          ))}

        {!loading && error && quotes.length === 0 && (
          <Empty message={error} onAction={() => setEditorOpen(true)} label="Edit watchlist" />
        )}

        {!loading && !prefs.watchlist.length && (
          <Empty message="Your watchlist is empty." onAction={() => setEditorOpen(true)} label="Add symbols" />
        )}

        {!loading &&
          groups.map((g) => (
            <section key={g.region} className="mb-6">
              <div className="flex items-center justify-between mb-2.5 px-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">{g.flag}</span>
                  <h2 className="text-[15px] font-bold text-slate-900">{g.region}</h2>
                  <span className="text-xs text-slate-400 font-medium">{g.items.length}</span>
                </div>
                {g.avg != null && (
                  <span
                    className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md ${
                      g.avg >= 0 ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"
                    }`}
                  >
                    avg {fmtPct(g.avg)}
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {g.items.map((q) => (
                  <StockRow key={q.symbol} quote={q} spark={sparks[q.symbol]} onClick={() => setSelected(q)} />
                ))}
              </div>
            </section>
          ))}
      </div>

      <StockDetail quote={selected} onClose={() => setSelected(null)} />
      <WatchlistEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

function Empty({ message, onAction, label }: { message: string; onAction: () => void; label: string }) {
  return (
    <div className="text-center py-16 px-6">
      <AlertCircle className="mx-auto text-slate-300 mb-3" size={32} />
      <p className="text-slate-500 text-sm">{message}</p>
      <button onClick={onAction} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold">
        {label}
      </button>
    </div>
  );
}
