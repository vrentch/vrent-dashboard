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
import { ChevronRight as Chev, CalendarDays, Plus, Sparkles, ScanLine, HeartPulse, CalendarPlus, Wallet } from "lucide-react";
import { useMoney, isConfigured as moneyConfigured, dailyAllowance, spentOnDay, spentInMonth, spendableMonthly, meterBreakdown, addExpense, lastNDaysSpend, CATEGORIES, todayKey as moneyToday } from "../../lib/money/store";
import { useHealth, macrosOn, calorieTarget, stepsOn, addWater, waterOn, todayKey as healthToday } from "../../lib/health";
import StatRing from "../../components/StatRing";
import Sparkline from "../../components/Sparkline";
import { useCountUp } from "../../lib/useCountUp";
import { chf } from "../../lib/business/format";

type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "calendar" | "settings" | "briefing" | "money";

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

  const money = useMoney();
  const health = useHealth();
  const events = useEvents();
  const [spend, setSpend] = useState("");
  const [spendCat, setSpendCat] = useState("food");

  // Today at a glance — the three numbers worth seeing without tapping.
  const hToday = healthToday();
  const eaten = Math.round(macrosOn(health, hToday).calories);
  const calTarget = calorieTarget(health.profile);
  const steps = stepsOn(health, hToday);
  const water = waterOn(health, hToday);
  const moneyOn = moneyConfigured(money);
  const cur = money.settings.currency || "CHF";
  const daily = dailyAllowance(money);
  const carry = (() => { const c = meterBreakdown(money).carryover; return Math.abs(c) >= 0.5 ? c : 0; })();
  const spentToday = spentOnDay(money, moneyToday());
  const leftToday = Math.max(0, daily + carry) - spentToday;
  const trend = useMemo(() => lastNDaysSpend(money, 7), [money]);
  const calShown = useCountUp(eaten);
  const stepShown = useCountUp(steps);
  const leftShown = useCountUp(moneyOn ? leftToday : 0);

  function quickSpend() {
    const a = parseFloat(spend.replace(",", "."));
    if (!(a > 0)) return;
    addExpense({ amount: a, category: spendCat });
    setSpend("");
  }
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
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[26px] font-extrabold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{greeting()}</h1>
            <p className="text-[13px] font-medium text-slate-400 dark:text-slate-500">{today}</p>
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

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-4 space-y-6">
        {/* Today — live rings + inline edits, the app's command panel */}
        <section className="rounded-3xl glass p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Today</h2>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => onNavigate("health")} className="flex flex-col items-center gap-1.5 transition-transform duration-150 active:scale-[0.96]">
              <StatRing pct={calTarget ? eaten / calTarget : 0} from="#818cf8" to="#4f46e5">
                <span className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{Math.round(calShown)}</span>
                <span className="block text-[9px] text-slate-400 dark:text-slate-500">kcal</span>
              </StatRing>
              <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">of {calTarget}</span>
            </button>

            <button onClick={() => onNavigate("health")} className="flex flex-col items-center gap-1.5 transition-transform duration-150 active:scale-[0.96]">
              <StatRing pct={steps / 10000} from="#5eead4" to="#0d9488">
                <span className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{Math.round(stepShown / 100) / 10}k</span>
                <span className="block text-[9px] text-slate-400 dark:text-slate-500">steps</span>
              </StatRing>
              <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">goal 10k</span>
            </button>

            <button onClick={() => onNavigate("money")} className="flex flex-col items-center gap-1.5 transition-transform duration-150 active:scale-[0.96]">
              <StatRing pct={moneyOn && daily + carry > 0 ? leftToday / (daily + carry) : 0} from="#fbbf24" to="#f59e0b">
                <span className="text-[13.5px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{moneyOn ? Math.round(leftShown) : "—"}</span>
                <span className="block text-[9px] text-slate-400 dark:text-slate-500">{moneyOn ? cur : "set up"}</span>
              </StatRing>
              <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">left today</span>
            </button>
          </div>

          {/* Inline quick edits — log without leaving the overview */}
          <div className="mt-3.5 flex gap-1.5">
            {[250, 500].map((ml) => (
              <button
                key={ml}
                onClick={() => addWater(ml)}
                className="flex-1 py-2 rounded-xl glass-subtle text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 transition-transform duration-150 active:scale-[0.96]"
              >
                💧 +{ml}ml
              </button>
            ))}
            <span className="flex-1 grid place-items-center py-2 rounded-xl glass-subtle text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              {(water / 1000).toFixed(1)}L today
            </span>
          </div>

          {moneyOn && (
            <div className="mt-1.5">
              <div className="flex gap-1.5">
                <input
                  value={spend}
                  onChange={(e) => setSpend(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") quickSpend(); }}
                  type="text" inputMode="decimal" placeholder={`Spent… (${cur})`}
                  className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2 text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
                />
                <button
                  onClick={quickSpend}
                  disabled={!(parseFloat(spend.replace(",", ".")) > 0)}
                  className="grid place-items-center w-11 rounded-xl accent-gradient text-white shadow-accent transition-transform duration-150 active:scale-[0.94] disabled:opacity-40"
                  aria-label="Add expense"
                >
                  <Plus size={18} />
                </button>
              </div>
              {parseFloat(spend.replace(",", ".")) > 0 && (
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto no-scrollbar animate-in">
                  {CATEGORIES.slice(0, 5).map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setSpendCat(c.key)}
                      className={`shrink-0 px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 ${
                        spendCat === c.key ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {c.emoji} {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Quick actions — one tap to the things used most */}
        <div className="grid grid-cols-4 gap-2.5">
          {([
            { label: "Briefing", icon: Sparkles, tab: "briefing" as Tab },
            { label: "Scan", icon: ScanLine, tab: "scan" as Tab },
            { label: "Health", icon: HeartPulse, tab: "health" as Tab },
            { label: "Add event", icon: CalendarPlus, tab: "calendar" as Tab },
          ]).map(({ label, icon: Icon, tab }) => (
            <button key={label} onClick={() => onNavigate(tab)} className="flex flex-col items-center gap-1.5 rounded-2xl glass py-3 transition-transform duration-150 active:scale-[0.95]">
              <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300">
                <Icon size={18} />
              </span>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
            </button>
          ))}
        </div>

        {/* Money — live affordability meter (opens the full tracker) */}
        <button
          onClick={() => onNavigate("money")}
          className="w-full text-left rounded-3xl p-5 text-white relative overflow-hidden accent-gradient shadow-accent active:scale-[0.99] transition"
        >
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex items-center justify-between gap-3">
            {moneyConfigured(money) ? (
              <>
                <div className="min-w-0">
                  {(() => {
                    // "Left today" already has a ring above — this card earns its
                    // place by showing the month, which nothing else does.
                    const spentMonth = trend.reduce((a, t) => a + t.amount, 0);
                    const monthBudget = spendableMonthly(money);
                    const monthSpent = spentInMonth(money, moneyToday().slice(0, 7));
                    const pct = monthBudget > 0 ? Math.min(1, monthSpent / monthBudget) : 0;
                    return (
                      <>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">This month</p>
                        <p className="text-[26px] leading-tight font-extrabold display-num tabular-nums">{chf(monthSpent, cur)}</p>
                        <p className="text-xs text-white/80">of {chf(monthBudget, cur)} · {chf(spentMonth, cur)} in the last 7 days</p>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-white/25 overflow-hidden">
                          <div className="h-full rounded-full bg-white/90 transition-[width] duration-700" style={{ width: `${Math.round(pct * 100)}%` }} />
                        </div>
                      </>
                    );
                  })()}
                </div>
                {/* Last 7 days of spending — the shape of the week at a glance */}
                <div className="shrink-0 w-24 opacity-90">
                  <Sparkline values={trend.map((t) => t.amount)} width={96} height={38} className="w-full h-[38px]" color="#ffffff" fill strokeWidth={2} />
                  <p className="text-[9px] text-white/70 text-center mt-0.5">last 7 days</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-base font-bold">Money & Affordability</p>
                  <p className="text-xs text-white/80 mt-0.5">Track all spending in one place — see exactly what's left to spend today.</p>
                </div>
                <span className="grid place-items-center w-11 h-11 rounded-2xl bg-white/15 shrink-0"><Wallet size={20} /></span>
              </>
            )}
          </div>
        </button>

        {/* Daily briefing — tap to expand into the full one-pager */}
        <button
          onClick={() => onNavigate("briefing")}
          className="w-full text-left relative overflow-hidden rounded-3xl p-5 text-white active:scale-[0.99] transition"
          style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b14 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
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
