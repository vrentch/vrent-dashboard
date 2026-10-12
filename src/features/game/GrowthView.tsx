import { useMemo } from "react";
import { TrendingUp, Flame, Star, Swords, Award, Calendar, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { type GameState, CATEGORIES, todayKey, addDays, prettyDay, monthKey, fromKey } from "../../lib/game/store";
import { timeline, xpAtLevel, titleFor, LEVEL_TITLES, type DayResult } from "../../lib/game/scoring";
import { recapFor } from "../../lib/game/achievements";
import { personalFacts } from "../../lib/game/facts";
import Sparkline from "../../components/Sparkline";
import StatRing from "../../components/StatRing";

// The growth path. The question this screen answers isn't "how did today go" —
// it's "am I actually becoming someone different?" So it leads with the level
// road, then the evidence: the shape of the last 90 days, the records, where
// the effort went, and the month-on-month delta.

const HEATMAP_DAYS = 91; // 13 clean weeks

export default function GrowthView({ s, onTrophies, onDay }: { s: GameState; onTrophies: () => void; onDay?: (date: string) => void }) {
  const today = todayKey();
  const tl = timeline(s, today);
  const figures = useMemo(() => personalFacts(s, tl, today), [s, tl, today]);

  const played = tl.days.filter((d) => !d.restDay);
  const trend = played.slice(-30).map((d) => d.score);
  const total = tl.record.win + tl.record.draw + tl.record.loss;
  const winRate = total ? Math.round((tl.record.win / total) * 100) : 0;

  const thisMonth = useMemo(() => recapFor(tl, monthKey(today)), [tl, today]);

  // Heatmap: a fixed 13-week window ending today, Monday at the top.
  const heat = useMemo(() => {
    const start = addDays(today, -(HEATMAP_DAYS - 1));
    const cells: { date: string; day: DayResult | undefined }[] = [];
    for (let i = 0; i < HEATMAP_DAYS; i++) {
      const date = addDays(start, i);
      cells.push({ date, day: tl.byDate[date] });
    }
    // Pad the front so each column is a Monday-start week.
    const lead = (fromKey(start).getDay() + 6) % 7;
    return { cells, lead };
  }, [tl, today]);

  const level = tl.level;
  const road = useMemo(() => {
    const from = Math.max(1, level.level - 2);
    return Array.from({ length: 9 }, (_, i) => from + i);
  }, [level.level]);

  const catRows = useMemo(() => {
    const max = Math.max(1, ...Object.values(tl.byCategory));
    return CATEGORIES.map((c) => ({ cat: c, n: tl.byCategory[c.key] || 0, pct: (tl.byCategory[c.key] || 0) / max }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n);
  }, [tl.byCategory]);

  if (!played.length) {
    return (
      <div className="rounded-3xl glass p-6 text-center">
        <TrendingUp size={26} className="mx-auto text-brand-500 mb-2" />
        <p className="text-[14.5px] font-bold text-slate-900 dark:text-slate-100">Your path starts tonight</p>
        <p className="mt-1.5 text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          Once the first day is scored, this page fills with the only chart that matters: whether the line goes up.
          Levels, streaks, records and a 13-week picture of how you actually spend your days.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* ── The level road ────────────────────────────────────────────── */}
      <section className="rounded-3xl p-5 relative overflow-hidden hero-ink text-white">
        <div className="absolute -right-10 -top-12 w-44 h-44 rounded-full bg-brand-500/25 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <StatRing pct={level.progress} size={78} stroke={7} from="#818cf8" to="#22d3ee">
            <div>
              <p className="text-[19px] font-black leading-none tabular-nums">{level.level}</p>
              <p className="text-[8px] font-bold uppercase tracking-wider text-white/55 mt-0.5">level</p>
            </div>
          </StatRing>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Growth path</p>
            <p className="text-[19px] font-extrabold leading-tight">{level.emoji} {level.title}</p>
            <p className="text-[11.5px] text-white/65 tabular-nums mt-0.5">
              {level.totalXp.toLocaleString()} XP · {level.xpForNext - level.xpIntoLevel} to level {level.level + 1}
            </p>
          </div>
        </div>

        {/* Stations along the road */}
        <div className="relative mt-5 -mx-5 px-5 overflow-x-auto no-scrollbar">
          <div className="flex items-end gap-0 min-w-max pb-1">
            {road.map((lv, i) => {
              const t = titleFor(lv);
              const milestone = LEVEL_TITLES.some((x) => x.from === lv);
              const reached = lv <= level.level;
              const current = lv === level.level;
              return (
                <div key={lv} className="flex items-end">
                  {i > 0 && (
                    <span
                      className="w-7 h-[3px] mb-[17px] rounded-full"
                      style={{ background: reached ? "rgba(129,140,248,0.9)" : "rgba(255,255,255,0.14)" }}
                      aria-hidden
                    />
                  )}
                  <div className="flex flex-col items-center gap-1 w-[52px]">
                    {milestone && (
                      <span className={`text-[13px] leading-none ${reached ? "" : "opacity-35 grayscale"}`}>{t.emoji}</span>
                    )}
                    <span
                      className={`grid place-items-center rounded-full text-[11px] font-black tabular-nums transition-all ${
                        current ? "w-9 h-9 bg-white text-slate-900 animate-aura" : reached ? "w-7 h-7 bg-brand-400/90 text-white" : "w-7 h-7 bg-white/10 text-white/45"
                      }`}
                    >
                      {lv}
                    </span>
                    <span className={`text-[8.5px] font-semibold text-center leading-tight ${current ? "text-white" : "text-white/40"}`}>
                      {milestone ? t.title : `${(xpAtLevel(lv) / 1000).toFixed(1)}k`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Records ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          icon={<Flame size={14} className="text-orange-500" />}
          label="Current streak"
          value={`${tl.dayStreak}`}
          unit="days"
          sub={`best ${tl.bestDayStreak}`}
          hot={tl.dayStreak >= 3 && tl.dayStreak >= tl.bestDayStreak}
        />
        <Card
          icon={<Swords size={14} className="text-brand-500" />}
          label="Win rate"
          value={`${winRate}`}
          unit="%"
          sub={`${tl.record.win}W ${tl.record.draw}D ${tl.record.loss}L`}
        />
        <Card
          icon={<Star size={14} className="text-amber-500" />}
          label="Flawless days"
          value={`${tl.perfectDays}`}
          unit={`/ ${tl.activeDays}`}
          sub={tl.activeDays ? `${Math.round((tl.perfectDays / tl.activeDays) * 100)}% of all days` : ""}
        />
        <Card
          icon={<TrendingUp size={14} className="text-emerald-500" />}
          label="30-day average"
          value={`${tl.avg30}`}
          unit="pts"
          sub={`7-day ${tl.avg7} · all time ${tl.avgAll}`}
        />
      </div>

      {/* ── The shape of the form ─────────────────────────────────────── */}
      <section className="rounded-3xl glass p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Last {trend.length} scored days</h2>
          {tl.best && (
            <span className="text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">
              best {tl.best.score} · {prettyDay(tl.best.date)}
            </span>
          )}
        </div>
        {trend.length > 1 ? (
          <div className="mt-2 relative">
            <Sparkline values={trend} width={340} height={70} className="w-full h-[70px]" color="#6366f1" fill strokeWidth={2.2} />
            <div
              className="absolute left-0 right-0 border-t border-dashed border-slate-300 dark:border-slate-600"
              style={{ top: `${Math.max(0, Math.min(100, 100 - s.settings.streakGoal))}%` }}
              aria-hidden
            />
            <span className="absolute right-0 text-[9px] font-semibold text-slate-400 dark:text-slate-500" style={{ top: `${Math.max(0, Math.min(92, 100 - s.settings.streakGoal))}%` }}>
              streak line {s.settings.streakGoal}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-slate-400 dark:text-slate-500">Two scored days and the line appears.</p>
        )}
      </section>

      {/* ── 13 weeks at a glance ──────────────────────────────────────── */}
      <section className="rounded-3xl glass p-4">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">13 weeks</h2>
        <div className="mt-2.5 overflow-x-auto no-scrollbar">
          <div className="grid grid-rows-7 grid-flow-col gap-[3px] min-w-max">
            {Array.from({ length: heat.lead }, (_, i) => <span key={`pad-${i}`} className="w-[11px] h-[11px]" aria-hidden />)}
            {heat.cells.map(({ date, day }) => (
              <button
                key={date}
                title={`${prettyDay(date)}${day && !day.restDay ? ` · ${day.score} pts · ${day.outcome}` : " · nothing due"}`}
                onClick={() => day && !day.restDay && onDay?.(date)}
                disabled={!day || day.restDay}
                className="w-[11px] h-[11px] rounded-[3px] transition-transform active:scale-125 disabled:cursor-default"
                style={{ background: heatColor(day) }}
                aria-label={`${prettyDay(date)}: ${day && !day.restDay ? `${day.score} points` : "nothing due"}`}
              />
            ))}
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[9.5px] text-slate-400 dark:text-slate-500">
          <span>low</span>
          {[0, 35, 55, 75, 90, 100].map((v) => (
            <span key={v} className="w-[11px] h-[11px] rounded-[3px]" style={{ background: heatColor({ score: v, restDay: false, outcome: "win" } as DayResult) }} />
          ))}
          <span>high</span>
          <span className="ml-auto">{onDay ? "tap a day for its verdict" : `${tl.activeDays} days played`}</span>
        </div>
      </section>

      {/* ── Where the effort goes ─────────────────────────────────────── */}
      {catRows.length > 0 && (
        <section className="rounded-3xl glass p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Where your days go</h2>
          <div className="mt-2.5 space-y-2">
            {catRows.map(({ cat, n, pct }) => (
              <div key={cat.key} className="flex items-center gap-2.5">
                <span className="w-5 text-[13px] text-center shrink-0">{cat.emoji}</span>
                <span className="w-[62px] shrink-0 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300 truncate">{cat.label}</span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.round(pct * 100)}%`, background: cat.color }} />
                </div>
                <span className="w-9 text-right text-[11.5px] font-bold tabular-nums text-slate-500 dark:text-slate-400">{n}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── This month vs last ────────────────────────────────────────── */}
      {thisMonth && thisMonth.days > 0 && (
        <section className="rounded-3xl glass p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Season {thisMonth.seasonNo} · {thisMonth.label}
            </h2>
            {thisMonth.vsPrevious != null && (
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md ${
                thisMonth.vsPrevious >= 0 ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" : "text-rose-700 dark:text-rose-300 bg-rose-500/10"
              }`}>
                {thisMonth.vsPrevious >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {Math.abs(thisMonth.vsPrevious)} vs last
              </span>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-2 text-center">
            {([["avg", thisMonth.avg], ["days", thisMonth.days], ["wins", thisMonth.wins], ["flawless", thisMonth.perfect]] as const).map(([l, v]) => (
              <div key={l} className="rounded-xl glass-subtle py-2.5">
                <p className="text-[16px] font-extrabold tabular-nums leading-none text-slate-900 dark:text-slate-100">{v}</p>
                <p className="text-[9.5px] text-slate-400 dark:text-slate-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          <button onClick={onTrophies} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-2xl glass-subtle text-[12.5px] font-bold text-brand-600 dark:text-brand-400 active:scale-[0.98]">
            <Award size={15} /> Season recaps & trophy cabinet
          </button>
        </section>
      )}

      {/* ── Your own numbers ──────────────────────────────────────────── */}
      {figures.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Calendar size={12} className="text-slate-400" />
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Facts & figures — yours</h2>
          </div>
          {figures.map((f, i) => (
            <div key={i} className="rounded-2xl glass p-3.5 flex items-start gap-3">
              <span className="text-[19px] leading-none shrink-0">{f.emoji}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{f.headline}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">{f.body}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Card({ icon, label, value, unit, sub, hot }: { icon: React.ReactNode; label: string; value: string; unit?: string; sub?: string; hot?: boolean }) {
  return (
    <div className={`rounded-3xl glass p-3.5 ${hot ? "animate-aura" : ""}`}>
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">{label}</p>
      </div>
      <p className="mt-1.5 text-[26px] font-extrabold leading-none tabular-nums display-num text-slate-900 dark:text-slate-100">
        {value}
        {unit && <span className="text-[12px] font-bold text-slate-400 dark:text-slate-500 ml-1">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums truncate">{sub}</p>}
    </div>
  );
}

function heatColor(day: DayResult | undefined): string {
  if (!day || day.restDay) return "rgba(120,120,140,0.14)";
  const s = day.score;
  if (s >= 100) return "#22d3ee";
  if (s >= 85) return "#4f46e5";
  if (s >= 70) return "#6366f1";
  if (s >= 50) return "#f59e0b";
  if (s > 0) return "rgba(244,63,94,0.55)";
  return "rgba(244,63,94,0.22)";
}
