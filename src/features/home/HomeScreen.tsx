import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Settings, Plus, Check, Sparkles, Droplets, ScanLine, Wand2, CalendarPlus, Timer } from "lucide-react";
import { fetchQuotes, fetchNews, fetchHistory, type Quote, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { usePoll } from "../../lib/usePoll";
import { greeting } from "../../lib/marketStatus";
import { useEvents, eventsOn, upcoming, todayKey, toKey, categoryOf, toggleDone } from "../../lib/calendar";
import { fmtPct } from "../../lib/format";
import StockDetail from "../markets/StockDetail";
import NewsCard from "../news/NewsCard";
import ArticleReader from "../news/ArticleReader";
import { useMoney, isConfigured as moneyConfigured, dailyAllowance, spentOnDay, spentInMonth, spendableMonthly, meterBreakdown, addExpense, lastNDaysSpend, todayKey as moneyToday } from "../../lib/money/store";
import { useHealth, macrosOn, macroTargets, calorieTarget, addWater, waterOn, fastingStatus, todayKey as healthToday } from "../../lib/health";
import StatRing from "../../components/StatRing";
import Sparkline from "../../components/Sparkline";
import { useCountUp } from "../../lib/useCountUp";
import { chf, chfRound } from "../../lib/business/format";

type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "calendar" | "settings" | "briefing" | "money";

// One-tap spend amounts — the everyday sums that shouldn't need typing.
const SPEND_CHIPS = [20, 50, 100];

// The world at a glance: different markets, not the personal watchlist
// (that lives in the Markets tab).
const WORLD_MARKETS: { symbol: string; flag: string; label: string }[] = [
  { symbol: "^GSPC", flag: "🇺🇸", label: "S&P 500" },
  { symbol: "^SSMI", flag: "🇨🇭", label: "SMI" },
  { symbol: "^STOXX50E", flag: "🇪🇺", label: "Euro Stoxx" },
  { symbol: "BTC-USD", flag: "🪙", label: "Bitcoin" },
  { symbol: "XAU=", flag: "🥇", label: "Gold" },
];

function fmtDur(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export default function HomeScreen({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const prefs = usePrefs();
  const [markets, setMarkets] = useState<Record<string, Quote>>({});
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [reading, setReading] = useState<NewsItem | null>(null);
  const [heroHist, setHeroHist] = useState<number[]>([]);

  const nKey = `${prefs.countries.join(",")}|${prefs.topics.join(",")}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, n] = await Promise.all([
        fetchQuotes(WORLD_MARKETS.map((m) => m.symbol)),
        fetchNews({ countries: prefs.countries, topics: prefs.topics }),
      ]);
      const map: Record<string, Quote> = {};
      q.quotes.forEach((x) => (map[x.symbol.toUpperCase()] = x));
      setMarkets(map);
      setNews(n.items.slice(0, 8));
    } catch {
      /* sections show their empty state */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nKey]);

  useEffect(() => { load(); }, [load]);
  usePoll(load, 60_000);

  // One real graph: the S&P over a month sets the market mood.
  useEffect(() => {
    fetchHistory("^GSPC", "1M")
      .then((h) => setHeroHist(Array.isArray(h?.closes) ? h.closes.filter((n) => n != null) : []))
      .catch(() => setHeroHist([]));
  }, []);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const money = useMoney();
  const health = useHealth();
  const events = useEvents();
  const [spend, setSpend] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  // Health numbers for the tile.
  const hToday = healthToday();
  const eatenM = macrosOn(health, hToday);
  const eaten = Math.round(eatenM.calories);
  const calTarget = calorieTarget(health.profile);
  const mTargets = macroTargets(health.profile);
  const water = waterOn(health, hToday);
  const fast = fastingStatus(health);
  const calShown = useCountUp(eaten);

  // Money numbers for the tile.
  const moneyOn = moneyConfigured(money);
  const cur = money.settings.currency || "CHF";
  const daily = dailyAllowance(money);
  const carry = (() => { const c = meterBreakdown(money).carryover; return Math.abs(c) >= 0.5 ? c : 0; })();
  const spentToday = spentOnDay(money, moneyToday());
  const leftToday = Math.max(0, daily + carry) - spentToday;
  const monthBudget = spendableMonthly(money);
  const monthSpent = spentInMonth(money, moneyToday().slice(0, 7));
  const monthPct = monthBudget > 0 ? Math.min(1, monthSpent / monthBudget) : 0;
  const trend = useMemo(() => lastNDaysSpend(money, 7), [money]);
  const leftShown = useCountUp(moneyOn ? leftToday : 0);

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

  // This week for the calendar strip: Monday-start, dots where events are.
  const week = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = toKey(d);
      return {
        key,
        dow: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        day: d.getDate(),
        isToday: key === todayKey(),
        cats: [...new Set(eventsOn(events, key).map((e) => categoryOf(e.category).color))].slice(0, 3),
      };
    });
  }, [events]);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const todayEvents = useMemo(() => eventsOn(events, todayKey()), [events]);
  const upcomingEvents = useMemo(() => {
    const later = upcoming(events, todayKey()).filter((e) => e.date !== todayKey());
    return later.slice(0, Math.max(0, 5 - todayEvents.length));
  }, [events, todayEvents.length]);

  const marketAvg = useMemo(() => {
    const qs = WORLD_MARKETS.map((m) => markets[m.symbol.toUpperCase()]).filter((q) => q?.changePercent != null);
    return qs.length ? qs.reduce((a, b) => a + (b.changePercent ?? 0), 0) / qs.length : null;
  }, [markets]);

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
        {/* ── Calendar — the day's spine, so it leads ──────────────────── */}
        <section className="rounded-3xl glass p-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{monthLabel}</p>
            <button onClick={() => onNavigate("calendar")} className="grid place-items-center w-8 h-8 rounded-full accent-gradient text-white shadow-accent active:scale-90 transition-transform" aria-label="Add event">
              <CalendarPlus size={15} />
            </button>
          </div>

          {/* Week strip — a real calendar row with event dots */}
          <div className="mt-3 grid grid-cols-7 gap-1">
            {week.map((d) => (
              <button
                key={d.key}
                onClick={() => onNavigate("calendar")}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-2xl transition-all duration-200 active:scale-[0.93] ${
                  d.isToday ? "accent-gradient text-white shadow-accent" : "glass-subtle text-slate-700 dark:text-slate-200"
                }`}
              >
                <span className={`text-[9.5px] font-semibold ${d.isToday ? "text-white/80" : "text-slate-400 dark:text-slate-500"}`}>{d.dow}</span>
                <span className="text-[15px] font-extrabold tabular-nums leading-none">{d.day}</span>
                <span className="flex gap-0.5 h-1.5 items-center">
                  {d.cats.length
                    ? d.cats.map((c, i) => <span key={i} className="w-1 h-1 rounded-full" style={{ backgroundColor: d.isToday ? "rgba(255,255,255,0.9)" : c }} />)
                    : <span className="w-1 h-1" />}
                </span>
              </button>
            ))}
          </div>

          {/* Today + upcoming, tickable right here */}
          {todayEvents.length === 0 && upcomingEvents.length === 0 ? (
            <button onClick={() => onNavigate("calendar")} className="mt-3 w-full py-3 rounded-xl glass-subtle text-[12px] font-medium text-slate-500 dark:text-slate-400">
              Nothing planned — tap ＋ to add an event or task
            </button>
          ) : (
            <div className="mt-2.5 space-y-0.5">
              {[...todayEvents, ...upcomingEvents].map((e) => {
                const isToday = e.date === todayKey();
                const cat = categoryOf(e.category);
                return (
                  <div key={e.id} className="flex items-center gap-2.5 py-1.5">
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
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{cat.label}</p>
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

        {/* ── Money ⇄ Health — taller tiles, more signal ───────────────── */}
        <div className="grid grid-cols-2 gap-3 md:gap-3.5">
          {/* Money */}
          <section className="rounded-3xl p-3.5 text-white relative overflow-hidden accent-gradient shadow-accent flex flex-col">
            <div className="absolute -right-6 -top-8 w-28 h-28 rounded-full bg-white/15 blur-2xl" />
            <button onClick={() => onNavigate("money")} className="relative w-full text-left active:opacity-80 transition-opacity">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">Left today</p>
              {moneyOn ? (
                <p className={`text-[24px] leading-tight font-extrabold display-num tabular-nums ${leftToday <= -0.005 ? "text-rose-200" : ""}`}>
                  {chfRound(leftShown, cur)}
                </p>
              ) : (
                <p className="text-[15px] font-bold mt-0.5">Set up →</p>
              )}
              {moneyOn && (
                <>
                  <p className="text-[10.5px] text-white/80 tabular-nums mt-0.5">{chf(daily, cur)}/day · spent {chf(spentToday, cur)}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-white/25 overflow-hidden">
                    <div className="h-full rounded-full bg-white/90 transition-[width] duration-700" style={{ width: `${Math.round(monthPct * 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-white/75 mt-1 tabular-nums">month {chfRound(monthSpent, cur)} / {chfRound(monthBudget, cur)}</p>
                  <div className="mt-1.5 opacity-90">
                    <Sparkline values={trend.map((t) => t.amount)} width={130} height={26} className="w-full h-[26px]" color="#ffffff" fill strokeWidth={1.75} />
                    <p className="text-[8.5px] text-white/60 mt-0.5">last 7 days</p>
                  </div>
                </>
              )}
            </button>
            {moneyOn && (
              <div className="relative mt-auto pt-2 space-y-1.5">
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

          {/* Health */}
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

            {/* Macros — three slim meters */}
            <div className="mt-2.5 space-y-1.5">
              {([
                ["P", eatenM.protein_g, mTargets.protein_g, "#6366f1"],
                ["C", eatenM.carbs_g, mTargets.carbs_g, "#14b8a6"],
                ["F", eatenM.fat_g, mTargets.fat_g, "#f59e0b"],
              ] as const).map(([l, v, t, c]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <span className="w-3 text-[9.5px] font-bold text-slate-400 dark:text-slate-500">{l}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, t ? (v / t) * 100 : 0)}%`, backgroundColor: c }} />
                  </div>
                  <span className="w-10 text-right text-[9.5px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{Math.round(v)}/{t}g</span>
                </div>
              ))}
            </div>

            {/* Fasting state, when it's on */}
            {health.fasting.enabled && fast.phase !== "idle" && (
              <button onClick={() => onNavigate("health")} className="mt-2 flex items-center gap-1.5 rounded-lg glass-subtle px-2 py-1.5 text-left active:opacity-70 transition-opacity">
                <Timer size={12} className={fast.phase === "fasting" ? "text-brand-500" : "text-emerald-500"} />
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                  {fast.phase === "fasting" ? `Fasting · ${fmtDur(fast.remainMs)}` : `Eating · ${fmtDur(fast.remainMs)}`}
                </span>
              </button>
            )}

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

        {/* ── World markets — S&P graph + five different markets ───────── */}
        <section className="rounded-3xl glass p-3.5">
          <button onClick={() => onNavigate("markets")} className="w-full flex items-center justify-between text-left active:opacity-70 transition-opacity">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">World markets</p>
            <span className="inline-flex items-center gap-1">
              {marketAvg != null && (
                <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md ${marketAvg >= 0 ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" : "text-rose-700 dark:text-rose-300 bg-rose-500/10"}`}>
                  {fmtPct(marketAvg)}
                </span>
              )}
              <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
            </span>
          </button>
          {heroHist.length > 2 && (
            <div className="mt-1.5 relative">
              <Sparkline values={heroHist} width={340} height={44} className="w-full h-11" fill strokeWidth={2} />
              <span className="absolute top-0 left-0 text-[9px] font-semibold text-slate-400 dark:text-slate-500">S&P 500 · 1M</span>
            </div>
          )}
          {loading && !Object.keys(markets).length ? (
            <div className="mt-2 space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-7 rounded-xl skeleton" />)}</div>
          ) : (
            <div className="mt-2 space-y-0.5">
              {WORLD_MARKETS.map((m) => {
                const q = markets[m.symbol.toUpperCase()];
                const up = (q?.changePercent ?? 0) >= 0;
                return (
                  <button key={m.symbol} onClick={() => q && setSelected(q)} className="w-full flex items-center gap-2 py-1 text-left active:opacity-70 transition-opacity">
                    <span className="text-[14px] leading-none w-5">{m.flag}</span>
                    <span className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100">{m.label}</span>
                    <span className="ml-auto text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {q?.price != null ? q.price.toLocaleString(undefined, { maximumFractionDigits: q.price > 1000 ? 0 : 2 }) : "—"}
                    </span>
                    <span className={`w-[52px] text-right text-[12px] font-bold tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {q?.changePercent != null ? fmtPct(q.changePercent) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── News — swipeable strip, below the day's essentials ───────── */}
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
                {marketAvg != null ? `Markets ${marketAvg >= 0 ? "up" : "down"} ${fmtPct(marketAvg)}` : "Markets"}
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
