import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Settings } from "lucide-react";
import { fetchQuotes, fetchSignals, fetchNews, type Quote, type Signal, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { usePoll } from "../../lib/usePoll";
import { greeting } from "../../lib/marketStatus";
import { useEvents, eventsOn, upcoming, todayKey, categoryOf } from "../../lib/calendar";
import { fmtPct } from "../../lib/format";
import MarketStatusBar from "../../components/MarketStatusBar";
import StockRow from "../markets/StockRow";
import StockDetail from "../markets/StockDetail";
import NewsCard from "../news/NewsCard";
import ArticleReader from "../news/ArticleReader";
import { ChevronRight as Chev, CalendarDays, Plus } from "lucide-react";

type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "calendar" | "settings" | "briefing";

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
  usePoll(load, 60_000);

  const movers = useMemo(
    () =>
      [...quotes]
        .filter((q) => q.changePercent != null)
        .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
        .slice(0, 5),
    [quotes]
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const events = useEvents();
  const todayEvents = useMemo(() => eventsOn(events, todayKey()), [events]);
  const upcomingEvents = useMemo(() => upcoming(events, todayKey()).slice(0, 3), [events]);
  const avgChange = useMemo(() => {
    const w = quotes.filter((q) => q.changePercent != null);
    return w.length ? w.reduce((a, b) => a + (b.changePercent ?? 0), 0) / w.length : null;
  }, [quotes]);
  const nextEvent = todayEvents.find((e) => !e.done);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{greeting()}</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate("settings")}
              className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
              aria-label="Settings"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={load}
              className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
              aria-label="Refresh"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {/* Daily briefing — tap to expand into the full one-pager */}
        <button
          onClick={() => onNavigate("briefing")}
          className="w-full text-left relative overflow-hidden rounded-3xl p-5 text-white active:scale-[0.99] transition"
          style={{ background: "linear-gradient(135deg, #27272a 0%, #18181b 55%, #09090b 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
        >
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-sm font-semibold text-white/85">Today's briefing</h2>
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-white/90">Open <Chev size={14} /></span>
            </div>
            <ul className="space-y-1.5 text-[15px] font-medium">
              <li className="flex items-center gap-2">
                <span>📈</span>
                {avgChange != null ? (
                  <span>Your watchlist is {avgChange >= 0 ? "up" : "down"} <b>{fmtPct(avgChange)}</b> on average today</span>
                ) : (
                  <span className="text-white/85">Add symbols to track your watchlist</span>
                )}
              </li>
              <li className="flex items-center gap-2">
                <span>🗓️</span>
                <span>
                  {todayEvents.length === 0
                    ? "No events scheduled today"
                    : `${todayEvents.length} event${todayEvents.length > 1 ? "s" : ""} today${nextEvent ? ` · next: ${nextEvent.title}${nextEvent.allDay ? "" : " " + (nextEvent.start ?? "")}` : ""}`}
                </span>
              </li>
              {news[0] && (
                <li className="flex items-start gap-2">
                  <span>📰</span>
                  <span className="line-clamp-2 text-white/95">{news[0].title}</span>
                </li>
              )}
            </ul>
            <p className="mt-3 text-xs text-white/70">Tap for your full AI briefing — top news, markets & health →</p>
          </div>
        </button>

        {/* Market status */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Markets</h2>
          <MarketStatusBar />
        </section>

        {/* Watchlist movers */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Your watchlist</h2>
            <button onClick={() => onNavigate("markets")} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
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
            <button onClick={() => onNavigate("markets")} className="w-full py-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/60 text-sm text-slate-500 dark:text-slate-400">
              Add stocks in Markets → My list
            </button>
          )}
        </section>

        {/* Calendar widget */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Your calendar</h2>
            <button onClick={() => onNavigate("calendar")} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
              Open <ChevronRight size={14} />
            </button>
          </div>
          <div className="rounded-2xl glass p-2">
            {upcomingEvents.length === 0 ? (
              <button onClick={() => onNavigate("calendar")} className="w-full flex items-center justify-center gap-2 py-4 text-sm text-slate-500 dark:text-slate-400">
                <Plus size={15} /> Add an event
              </button>
            ) : (
              <div className="divide-y divide-white/40 dark:divide-white/5">
                {upcomingEvents.map((e) => {
                  const isToday = e.date === todayKey();
                  return (
                    <button key={e.id} onClick={() => onNavigate("calendar")} className="w-full flex items-center gap-3 p-2.5 text-left active:opacity-70">
                      <div className="grid place-items-center w-10 shrink-0">
                        <CalendarDays size={14} className="text-slate-400 dark:text-slate-500" />
                      </div>
                      <span className="w-1.5 h-8 rounded-full shrink-0" style={{ backgroundColor: categoryOf(e.category).color }} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${e.done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>{e.title}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {isToday ? "Today" : new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                          {e.allDay ? "" : ` · ${e.start ?? ""}`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Top news */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Top stories</h2>
            <button onClick={() => onNavigate("news")} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">
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
