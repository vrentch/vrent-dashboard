import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Settings, Plus, Check, Sparkles, Droplets, ScanLine, Wand2, CalendarPlus } from "lucide-react";
import { fetchQuotes, fetchSignals, fetchNews, fetchHistory, type Quote, type Signal, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { usePoll } from "../../lib/usePoll";
import { greeting } from "../../lib/marketStatus";
import { useEvents, eventsOn, upcoming, todayKey, categoryOf, toggleDone } from "../../lib/calendar";
import { fmtPct } from "../../lib/format";
import StockDetail from "../markets/StockDetail";
import NewsCard from "../news/NewsCard";
import ArticleReader from "../news/ArticleReader";
import { useMoney, isConfigured as moneyConfigured, dailyAllowance, spentOnDay, spentInMonth, spendableMonthly, meterBreakdown, addExpense, todayKey as moneyToday } from "../../lib/money/store";
import { useHealth, macrosOn, calorieTarget, addWater, waterOn, todayKey as healthToday } from "../../lib/health";
import StatRing from "../../components/StatRing";
import Sparkline from "../../components/Sparkline";
import { useCountUp } from "../../lib/useCountUp";
import { chf } from "../../lib/business/format";

type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "calendar" | "settings" | "briefing" | "money";

// One-tap spend amounts — the everyday sums that shouldn't need typing.
const SPEND_CHIPS = [20, 50, 100];

export default function HomeScreen({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const prefs = usePrefs();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [signals, setSignals] = useState<Record<string, Signal>>({});
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [reading, setReading] = useState<NewsItem | null>(null);
  const [heroHist, setHeroHist] = useState<number[]>([]);
  const [heroSym, setHeroSym] = useState<string>("");

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
      setNews(n.items.slice(0, 8));
      if (prefs.watchlist.length) {
        fetchSignals(prefs.watchlist)
          .then((r) => {
            const map: Record<string, Signal> = {};
            r.signals.forEach((s) => (map[s.symbol.toUpperCase()] = s));
            setSignals(map);
          })
          .catch(() => {});
      }
    } catch {
      /* sections show their empty state */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wKey, nKey]);

  useEffect(() => { load(); }, [load]);
  usePoll(load, 60_000);

  const movers = useMemo(
    () =>
      [...quotes]
        .filter((q) => q.changePercent != null)
        .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
        .slice(0, 3),
    [quotes]
  );

  // The market graph: one month of the biggest mover, fetched once per symbol.
  useEffect(() => {
    const top = movers[0]?.symbol;
    if (!top || top === heroSym) return;
    setHeroSym(top);
    fetchHistory(top, "1M")
      .then((h) => setHeroHist(Array.isArray(h?.closes) ? h.closes.filter((n) => n != null) : []))
      .catch(() => setHeroHist([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movers]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const money = useMoney();
  const health = useHealth();
  const events = useEvents();
  const [spend, setSpend] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const hToday = healthToday();
  const eaten = Math.round(macrosOn(health, hToday).calories);
  const calTarget = calorieTarget(health.profile);
  const water = waterOn(health, hToday);
  const moneyOn = moneyConfigured(money);
  const cur = money.settings.currency || "CHF";
  const daily = dailyAllowance(money);
  const carry = (() => { const c = meterBreakdown(money).carryover; return Math.abs(c) >= 0.5 ? c : 0; })();
  const spentToday = spentOnDay(money, moneyToday());
  const leftToday = Math.max(0, daily + carry) - spentToday;
  const monthBudget = spendableMonthly(money);
  const monthSpent = spentInMonth(money, moneyToday().slice(0, 7));
  const monthPct = monthBudget > 0 ? Math.min(1, monthSpent / monthBudget) : 0;
  const leftShown = useCountUp(moneyOn ? leftToday : 0);
  const calShown = useCountUp(eaten);

  // Every quick edit answers back — a small flash beats silent success.
  function note(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash((f) => (f === msg ? null : f)), 1500);
  }
  function logSpend(amount: number) {
    if (!(amount > 0)) return;
    addExpense({ amount, category: "other" });
    note(`− ${chf(amount, cur)} ✓`);
    setSpend("");
  }

  const todayEvents = useMemo(() => eventsOn(events, todayKey()), [events]);
  const upcomingEvents = useMemo(() => {
    const later = upcoming(events, todayKey()).filter((e) => e.date !== todayKey());
    return later.slice(0, Math.max(0, 4 - todayEvents.length));
  }, [events, todayEvents.length]);
  const avgChange = useMemo(() => {
    const w = quotes.filter((q) => q.changePercent != null);
    return w.length ? w.reduce((a, b) => a + (b.changePercent ?? 0), 0) / w.length : null;
  }, [quotes]);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-2.5 flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-extrabold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{greeting()}</h1>
            <p className="text-[12px] font-medium text-slate-400 dark:text-slate-500">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            {flash && <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400 animate-in">{flash}</span>}
            <button onClick={() => onNavigate("settings")} className="grid place-items-center w-9 h-9 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Settings">
              <Settings size={17} />
            </button>
            <button onClick={load} className="grid place-items-center w-9 h-9 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Refresh">
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-3.5 space-y-3.5">
        {/* ── Money ⇄ Health bento ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:gap-3.5">
          {/* Money: left today, month bar, one-tap spends, manual field */}
          <section className="rounded-3xl p-3.5 text-white relative overflow-hidden accent-gradient shadow-accent">
            <div className="absolute -right-6 -top-8 w-28 h-28 rounded-full bg-white/15 blur-2xl" />
            <button onClick={() => onNavigate("money")} className="relative w-full text-left active:opacity-80 transition-opacity">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">Left today</p>
              {moneyOn ? (
                <p className={`text-[24px] leading-tight font-extrabold display-num tabular-nums ${leftToday <= -0.005 ? "text-rose-200" : ""}`}>
                  {chf(leftShown, cur)}
                </p>
              ) : (
                <p className="text-[15px] font-bold mt-0.5">Set up →</p>
              )}
              {moneyOn && (
                <>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/25 overflow-hidden">
                    <div className="h-full rounded-full bg-white/90 transition-[width] duration-700" style={{ width: `${Math.round(monthPct * 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-white/75 mt-1 tabular-nums">month {chf(monthSpent, cur)} / {chf(monthBudget, cur)}</p>
                </>
              )}
            </button>
            {moneyOn && (
              <div className="relative mt-2.5 space-y-1.5">
                <div className="flex gap-1.5">
                  {SPEND_CHIPS.map((a) => (
                    <button
                      key={a}
                      onClick={() => logSpend(a)}
                      className="flex-1 py-1.5 rounded-lg bg-white/15 text-[12px] font-bold tabular-nums transition-transform duration-150 active:scale-[0.93]"
                    >
                      −{a}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={spend}
                    onChange={(e) => setSpend(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") logSpend(parseFloat(spend.replace(",", "."))); }}
                    type="text" inputMode="decimal" placeholder="amount…"
                    className="flex-1 min-w-0 rounded-lg bg-white/15 placeholder-white/50 px-2.5 py-1.5 text-[12.5px] font-semibold tabular-nums text-white outline-none"
                  />
                  <button
                    onClick={() => logSpend(parseFloat(spend.replace(",", ".")))}
                    disabled={!(parseFloat(spend.replace(",", ".")) > 0)}
                    className="grid place-items-center w-8 rounded-lg bg-white text-brand-700 transition-transform duration-150 active:scale-[0.9] disabled:opacity-40"
                    aria-label="Add expense"
                  >
                    <Plus size={15} strokeWidth={2.6} />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Health: calories ring + water / scan / AI quick entries */}
          <section className="rounded-3xl glass p-3.5 flex flex-col">
            <button onClick={() => onNavigate("health")} className="flex items-center gap-2.5 text-left active:opacity-70 transition-opacity">
              <StatRing pct={calTarget ? eaten / calTarget : 0} size={54} stroke={6} from="#818cf8" to="#4f46e5">
                <span className="text-[12px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{Math.round((calTarget ? eaten / calTarget : 0) * 100)}%</span>
              </StatRing>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Calories</p>
                <p className="text-[17px] font-extrabold tabular-nums leading-tight text-slate-900 dark:text-slate-100">{Math.round(calShown)}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">of {calTarget}</p>
              </div>
            </button>
            <div className="mt-auto pt-2.5 grid grid-cols-3 gap-1.5">
              <button
                onClick={() => { addWater(250); note("💧 +250 ml"); }}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg glass-subtle transition-transform duration-150 active:scale-[0.93]"
              >
                <Droplets size={15} className="text-sky-500" />
                <span className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">{(water / 1000).toFixed(1)}L</span>
              </button>
              <button
                onClick={() => onNavigate("scan")}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg glass-subtle transition-transform duration-150 active:scale-[0.93]"
              >
                <ScanLine size={15} className="text-brand-600 dark:text-brand-400" />
                <span className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400">Scan</span>
              </button>
              <button
                onClick={() => onNavigate("health")}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg glass-subtle transition-transform duration-150 active:scale-[0.93]"
              >
                <Wand2 size={15} className="text-violet-500" />
                <span className="text-[9.5px] font-semibold text-slate-500 dark:text-slate-400">AI food</span>
              </button>
            </div>
          </section>
        </div>

        {/* ── Markets — one card: sentiment, graph, movers ─────────────── */}
        <section className="rounded-3xl glass p-3.5">
          <button onClick={() => onNavigate("markets")} className="w-full flex items-center justify-between text-left active:opacity-70 transition-opacity">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Markets</p>
            <span className="inline-flex items-center gap-1">
              {avgChange != null && (
                <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md ${avgChange >= 0 ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" : "text-rose-700 dark:text-rose-300 bg-rose-500/10"}`}>
                  {fmtPct(avgChange)}
                </span>
              )}
              <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
            </span>
          </button>
          {heroHist.length > 2 && (
            <div className="mt-1.5 relative">
              <Sparkline values={heroHist} width={340} height={44} className="w-full h-11" fill strokeWidth={2} />
              <span className="absolute top-0 left-0 text-[9px] font-semibold text-slate-400 dark:text-slate-500">{heroSym} · 1M</span>
            </div>
          )}
          {loading && !quotes.length ? (
            <div className="mt-2 space-y-1.5">{[0, 1].map((i) => <div key={i} className="h-8 rounded-xl skeleton" />)}</div>
          ) : movers.length ? (
            <div className="mt-2 space-y-1">
              {movers.map((q) => {
                const up = (q.changePercent ?? 0) >= 0;
                const sig = signals[q.symbol.toUpperCase()];
                return (
                  <button key={q.symbol} onClick={() => setSelected(q)} className="w-full flex items-center gap-2 py-1 text-left active:opacity-70 transition-opacity">
                    <span className="w-14 text-[12.5px] font-extrabold text-slate-900 dark:text-slate-100">{q.symbol}</span>
                    {sig && (
                      <span className={`text-[9px] font-bold px-1.5 py-px rounded-full ${sig.tone === "pos" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : sig.tone === "neg" ? "bg-rose-500/12 text-rose-600 dark:text-rose-400" : "bg-slate-500/12 text-slate-500 dark:text-slate-400"}`}>
                        {sig.label}
                      </span>
                    )}
                    <span className="ml-auto text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{q.price != null ? q.price.toFixed(2) : "—"}</span>
                    <span className={`w-[52px] text-right text-[12px] font-bold tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {q.changePercent != null ? fmtPct(q.changePercent) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <button onClick={() => onNavigate("markets")} className="mt-2 w-full py-3 rounded-xl glass-subtle text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Add stocks in Markets → My list
            </button>
          )}
        </section>

        {/* ── News — a swipeable strip instead of a tall list ──────────── */}
        <section>
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Top stories</h2>
            <button onClick={() => onNavigate("news")} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 dark:text-brand-400">
              All <ChevronRight size={12} />
            </button>
          </div>
          {loading && !news.length ? (
            <div className="flex gap-2.5 overflow-hidden -mx-4 px-4">{[0, 1, 2].map((i) => <div key={i} className="shrink-0 w-40 h-40 rounded-2xl skeleton" />)}</div>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar snap-row -mx-4 px-4 pb-1">
              {news.map((it, i) => (
                <NewsCard key={it.id} item={it} index={i} variant="compact" onOpen={setReading} />
              ))}
            </div>
          )}
        </section>

        {/* ── Calendar & tasks — visible, and done in one tap ──────────── */}
        <section className="rounded-3xl glass p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Calendar & tasks</p>
            <button onClick={() => onNavigate("calendar")} className="grid place-items-center w-7 h-7 rounded-full accent-gradient-soft text-brand-600 dark:text-brand-300 active:scale-90 transition-transform" aria-label="Add event">
              <CalendarPlus size={14} />
            </button>
          </div>
          {todayEvents.length === 0 && upcomingEvents.length === 0 ? (
            <button onClick={() => onNavigate("calendar")} className="mt-2 w-full py-3 rounded-xl glass-subtle text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Nothing planned — tap to add your first event
            </button>
          ) : (
            <div className="mt-2 space-y-1">
              {[...todayEvents, ...upcomingEvents].map((e) => {
                const isToday = e.date === todayKey();
                const cat = categoryOf(e.category);
                return (
                  <div key={e.id} className="flex items-center gap-2.5 py-1.5">
                    {/* Tick it off right here — tasks you can't touch don't get done. */}
                    <button
                      onClick={() => toggleDone(e.id)}
                      aria-label={e.done ? "Mark as open" : "Mark as done"}
                      className={`grid place-items-center w-5 h-5 rounded-full border-2 shrink-0 transition-all duration-200 active:scale-[0.85] ${
                        e.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600 text-transparent"
                      }`}
                    >
                      <Check size={11} strokeWidth={3.5} />
                    </button>
                    <span className="w-1 h-7 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <button onClick={() => onNavigate("calendar")} className="min-w-0 flex-1 text-left active:opacity-70 transition-opacity">
                      <p className={`text-[13px] font-semibold truncate ${e.done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>{e.title}</p>
                    </button>
                    <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${isToday ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
                      {isToday
                        ? (e.allDay ? "today" : e.start ?? "today")
                        : new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Briefing — one confident line, opens the full page ───────── */}
        <button
          onClick={() => onNavigate("briefing")}
          className="w-full text-left relative overflow-hidden rounded-3xl px-4 py-3.5 text-white active:scale-[0.99] transition-transform duration-150"
          style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b10 100%)", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}
        >
          <div className="absolute -right-6 -top-8 w-28 h-28 rounded-full bg-white/12 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-white/12 shrink-0"><Sparkles size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold">Your AI briefing</p>
              <p className="text-[11.5px] text-white/75 truncate">
                {avgChange != null ? `Watchlist ${avgChange >= 0 ? "up" : "down"} ${fmtPct(avgChange)}` : "Markets"}
                {" · "}{todayEvents.length ? `${todayEvents.length} event${todayEvents.length > 1 ? "s" : ""} today` : "free day"}
                {news[0] ? ` · ${news[0].title}` : ""}
              </p>
            </div>
            <ChevronRight size={16} className="text-white/70 shrink-0" />
          </div>
        </button>
      </div>

      <StockDetail quote={selected} onClose={() => setSelected(null)} />
      <ArticleReader item={reading} onClose={() => setReading(null)} />
    </div>
  );
}
