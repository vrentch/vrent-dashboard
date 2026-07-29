import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { fetchQuotes, fetchSignals, fetchNews, type Quote, type Signal, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { greeting } from "../../lib/marketStatus";
import MarketStatusBar from "../../components/MarketStatusBar";
import StockRow from "../markets/StockRow";
import StockDetail from "../markets/StockDetail";
import NewsCard from "../news/NewsCard";
import ArticleReader from "../news/ArticleReader";

type Tab = "home" | "news" | "markets" | "settings";

export default function HomeScreen({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const prefs = usePrefs();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [signals, setSignals] = useState<Record<string, Signal>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [reading, setReading] = useState<NewsItem | null>(null);

  const wKey = prefs.watchlist.join(",");
  const nKey = `${prefs.countries.join(",")}|${prefs.topics.join(",")}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, n] = await Promise.all([
        prefs.watchlist.length ? fetchQuotes(prefs.watchlist) : Promise.resolve({ quotes: [], errors: [] }),
        fetchNews({ countries: prefs.countries, topics: prefs.topics }),
      ]);
      setQuotes(q.quotes);
      setNews(n.items.slice(0, 5));
      if (prefs.watchlist.length) {
        setSignalsLoading(true);
        fetchSignals(prefs.watchlist)
          .then((r) => {
            const map: Record<string, Signal> = {};
            r.signals.forEach((s) => (map[s.symbol.toUpperCase()] = s));
            setSignals(map);
          })
          .catch(() => {})
          .finally(() => setSignalsLoading(false));
      }
    } catch {
      /* sections show their empty state */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wKey, nKey]);

  useEffect(() => {
    load();
  }, [load]);

  const movers = useMemo(
    () =>
      [...quotes]
        .filter((q) => q.changePercent != null)
        .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
        .slice(0, 5),
    [quotes]
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div>
      <header className="sticky top-0 z-30 bg-[#f6f7f9]/85 backdrop-blur-xl border-b border-slate-200/70 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">{greeting()}</h1>
            <p className="text-xs text-slate-400">{today}</p>
          </div>
          <button
            onClick={load}
            className="grid place-items-center w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-600 active:scale-95"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {/* Market status */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Markets</h2>
          <MarketStatusBar />
        </section>

        {/* Watchlist movers */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900">Your watchlist</h2>
            <button onClick={() => onNavigate("markets")} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600">
              Markets <ChevronRight size={14} />
            </button>
          </div>
          {loading && !quotes.length ? (
            <div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-[64px] rounded-2xl skeleton" />)}</div>
          ) : movers.length ? (
            <div className="space-y-2.5">
              {movers.map((q) => (
                <StockRow key={q.symbol} quote={q} signal={signals[q.symbol.toUpperCase()]} signalLoading={signalsLoading} onClick={() => setSelected(q)} />
              ))}
            </div>
          ) : (
            <button onClick={() => onNavigate("markets")} className="w-full py-6 rounded-2xl bg-white border border-slate-200/70 text-sm text-slate-500">
              Add stocks in Markets → My list
            </button>
          )}
        </section>

        {/* Top news */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900">Top stories</h2>
            <button onClick={() => onNavigate("news")} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600">
              All news <ChevronRight size={14} />
            </button>
          </div>
          {loading && !news.length ? (
            <div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}</div>
          ) : (
            <div className="space-y-2.5">
              {news.map((it, i) => (
                <NewsCard key={it.id} item={it} index={i} onOpen={setReading} />
              ))}
            </div>
          )}
        </section>
      </div>

      <StockDetail quote={selected} onClose={() => setSelected(null)} />
      <ArticleReader item={reading} onClose={() => setReading(null)} />
    </div>
  );
}
