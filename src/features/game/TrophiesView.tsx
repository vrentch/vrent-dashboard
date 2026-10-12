import { useMemo, useState } from "react";
import { Trophy, Medal as MedalIcon, Lock, ChevronRight, Sparkles } from "lucide-react";
import { type GameState, todayKey, prettyDay } from "../../lib/game/store";
import { timeline } from "../../lib/game/scoring";
import {
  achievements, badgeSummary, medals, seasons, TIER_STYLE, MEDAL_STYLE,
  type AchievementState, type Medal, type Recap,
} from "../../lib/game/achievements";

// The cabinet. Weekly, monthly and yearly medals are earned by doing the work
// *and* doing it well — each rung asks for both an average and a number of
// days played, so you can't buy a platinum with three heroic days.

export default function TrophiesView({ s }: { s: GameState }) {
  const today = todayKey();
  const tl = timeline(s, today);
  const list = useMemo(() => achievements(tl), [tl]);
  const sum = useMemo(() => badgeSummary(list), [list]);
  const m = useMemo(() => medals(tl, today), [tl, today]);
  const recaps = useMemo(() => seasons(tl), [tl]);
  const [tab, setTab] = useState<"badges" | "medals" | "seasons">("badges");

  const groups = useMemo(() => {
    const byGroup = new Map<string, AchievementState[]>();
    for (const b of list) {
      const arr = byGroup.get(b.group);
      if (arr) arr.push(b);
      else byGroup.set(b.group, [b]);
    }
    return [...byGroup.entries()];
  }, [list]);

  return (
    <div className="space-y-3.5">
      {/* ── The haul ──────────────────────────────────────────────────── */}
      <section className="rounded-3xl p-5 relative overflow-hidden hero-ink text-white">
        <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-amber-500/20 blur-2xl" aria-hidden />
        <div className="relative flex items-center gap-3.5">
          <span className="grid place-items-center w-14 h-14 rounded-2xl bg-white/10 shrink-0">
            <Trophy size={26} className="text-amber-300" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Trophy cabinet</p>
            <p className="text-[22px] font-extrabold leading-tight tabular-nums">
              {sum.earned} <span className="text-[13px] font-semibold text-white/55">of {sum.total} achievements</span>
            </p>
            <p className="text-[11.5px] text-white/65">
              {m.haul.platinum > 0 && `${m.haul.platinum}🏆 `}
              {m.haul.gold > 0 && `${m.haul.gold}🥇 `}
              {m.haul.silver > 0 && `${m.haul.silver}🥈 `}
              {m.haul.bronze > 0 && `${m.haul.bronze}🥉 `}
              {!m.haul.platinum && !m.haul.gold && !m.haul.silver && !m.haul.bronze && "No medals yet — your first week is in play"}
            </p>
          </div>
        </div>
        <div className="relative mt-4 h-2 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-200 transition-[width] duration-700"
            style={{ width: `${Math.round((sum.earned / Math.max(1, sum.total)) * 100)}%` }}
          />
        </div>
        <div className="relative mt-3 grid grid-cols-4 gap-2 text-center">
          {([["bronze", sum.bronze], ["silver", sum.silver], ["gold", sum.gold], ["legend", sum.legend]] as const).map(([t, n]) => (
            <div key={t} className="rounded-xl bg-white/10 py-2">
              <p className="text-[15px] font-extrabold tabular-nums leading-none">{n}</p>
              <p className="text-[9px] text-white/55 mt-0.5 capitalize">{t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live medals ───────────────────────────────────────────────── */}
      <div className="grid gap-3">
        {([m.thisWeek, m.thisMonth, m.thisYear].filter(Boolean) as Medal[]).map((md) => (
          <LiveMedal key={`${md.period}-${md.key}`} m={md} />
        ))}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="segment grid grid-cols-3 gap-0">
        {([["badges", "Achievements"], ["medals", "Medals"], ["seasons", "Seasons"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`py-2 rounded-[9px] text-[12px] font-bold transition-all ${
              tab === k ? "segment-pill text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "badges" && (
        <div className="space-y-4">
          {sum.next.length > 0 && (
            <section className="rounded-3xl glass p-4">
              <div className="flex items-center gap-1.5 mb-2.5">
                <Sparkles size={12} className="text-brand-500" />
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Closest to unlocking</h2>
              </div>
              <div className="space-y-2">
                {sum.next.map((b) => (
                  <div key={b.id} className="flex items-center gap-2.5">
                    <span className="text-[17px] leading-none shrink-0 opacity-50">{b.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 truncate">{b.name}</p>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full accent-gradient transition-[width] duration-700" style={{ width: `${Math.round(b.progress * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                      {Math.round(b.value)}/{b.goal}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {groups.map(([group, items]) => (
            <section key={group}>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{group}</h2>
                <span className="text-[10px] font-semibold text-slate-300 dark:text-slate-600 tabular-nums">
                  {items.filter((i) => i.unlocked).length}/{items.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {items.map((b) => <BadgeTile key={b.id} b={b} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "medals" && (
        <div className="space-y-4">
          {([["Years", m.years], ["Months", m.months], ["Weeks", m.weeks.slice(0, 16)]] as const).map(([label, rows]) => (
            rows.length > 0 && (
              <section key={label}>
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5 px-1">{label}</h2>
                <div className="space-y-2">
                  {rows.map((md) => (
                    <div
                      key={`${md.period}-${md.key}`}
                      className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${md.tier === "none" ? "glass-subtle" : "glass"}`}
                    >
                      <span className="text-[22px] leading-none shrink-0">{MEDAL_STYLE[md.tier].emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 truncate">
                          {md.label}{md.current ? " · in play" : ""}
                        </p>
                        <p className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
                          avg {md.avg} · {md.days} day{md.days === 1 ? "" : "s"} · {md.wins}W · {md.perfect} flawless
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-bold" style={{ color: MEDAL_STYLE[md.tier].color }}>
                          {MEDAL_STYLE[md.tier].label}
                        </p>
                        {md.xp > 0 && <p className="text-[9.5px] text-slate-400 dark:text-slate-500">+{md.xp} XP</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          ))}
        </div>
      )}

      {tab === "seasons" && (
        <div className="space-y-2.5">
          {recaps.length === 0 ? (
            <p className="rounded-3xl glass p-5 text-center text-[12.5px] text-slate-500 dark:text-slate-400">
              Each calendar month is a season. The recap lands as soon as it has days in it.
            </p>
          ) : (
            recaps.map((r) => <SeasonCard key={r.key} r={r} />)
          )}
        </div>
      )}
    </div>
  );
}

function LiveMedal({ m }: { m: Medal }) {
  const style = MEDAL_STYLE[m.tier];
  const next = m.next;
  const needDays = next ? Math.max(0, next.days - m.days) : 0;
  const needAvg = next ? Math.max(0, next.avg - m.avg) : 0;
  const toward = next ? Math.min(1, (m.days / next.days) * 0.5 + (m.avg / next.avg) * 0.5) : 1;

  return (
    <section className={`rounded-3xl p-4 ${m.tier === "none" ? "glass" : "trophy-gold"}`}>
      <div className="flex items-center gap-3">
        <span className="text-[26px] leading-none shrink-0">{style.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {m.period === "week" ? "This week" : m.period === "month" ? "This month" : "This year"}
          </p>
          <p className="text-[14px] font-extrabold text-slate-900 dark:text-slate-100">
            {m.tier === "none" ? "No medal yet" : `${style.label} on track`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[18px] font-extrabold tabular-nums leading-none text-slate-900 dark:text-slate-100">{m.avg}</p>
          <p className="text-[9.5px] text-slate-400 dark:text-slate-500">avg · {m.days}d</p>
        </div>
      </div>
      {next ? (
        <>
          <div className="mt-2.5 h-2 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${Math.round(toward * 100)}%`, background: `linear-gradient(90deg, ${MEDAL_STYLE[next.tier].color}, #fbbf24)` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {MEDAL_STYLE[next.tier].emoji} {MEDAL_STYLE[next.tier].label} wants an average of {next.avg} across {next.days} days
            {needAvg > 0 && needDays > 0 ? ` — ${needAvg} more points and ${needDays} more day${needDays === 1 ? "" : "s"}.` :
             needAvg > 0 ? ` — ${needAvg} more points.` :
             needDays > 0 ? ` — ${needDays} more day${needDays === 1 ? "" : "s"} at this standard.` : " — it's yours if you hold this."}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Top of the ladder. Nothing above this one.</p>
      )}
    </section>
  );
}

function BadgeTile({ b }: { b: AchievementState }) {
  const t = TIER_STYLE[b.tier];
  return (
    <div
      className={`rounded-2xl p-2.5 text-center ${b.unlocked ? "" : "trophy-locked"}`}
      style={b.unlocked ? { background: `linear-gradient(150deg, ${t.glow} 0%, transparent 100%)`, border: `1px solid ${t.ring}66` } : undefined}
    >
      <span className={`block text-[24px] leading-none ${b.unlocked ? "" : "grayscale opacity-30"}`}>{b.emoji}</span>
      <p className={`mt-1.5 text-[10.5px] font-bold leading-tight ${b.unlocked ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>
        {b.name}
      </p>
      <p className="mt-0.5 text-[8.5px] leading-tight text-slate-400 dark:text-slate-500 line-clamp-2">{b.desc}</p>
      {b.unlocked ? (
        <p className="mt-1 text-[8.5px] font-bold" style={{ color: t.ring }}>
          {b.at ? prettyDay(b.at) : t.label}
        </p>
      ) : (
        <div className="mt-1.5 flex items-center justify-center gap-1">
          <Lock size={8} className="text-slate-300 dark:text-slate-600" />
          <span className="text-[8.5px] font-bold tabular-nums text-slate-400 dark:text-slate-500">
            {Math.round(b.value)}/{b.goal}
          </span>
        </div>
      )}
    </div>
  );
}

function SeasonCard({ r }: { r: Recap }) {
  const [open, setOpen] = useState(false);
  const style = MEDAL_STYLE[r.medal];
  return (
    <section className="rounded-3xl glass overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 p-4 text-left active:opacity-70">
        <span className="text-[24px] leading-none shrink-0">{style.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100 truncate">
            Season {r.seasonNo} · {r.label}
          </p>
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
            avg {r.avg} · {r.wins}W {r.losses}L · {r.perfect} flawless · {r.xp.toLocaleString()} XP
          </p>
        </div>
        <ChevronRight size={15} className={`text-slate-300 dark:text-slate-600 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 animate-in">
          <div className="grid grid-cols-3 gap-2 text-center">
            {([["days played", r.days], ["targets done", r.completions], ["best day", r.bestDay?.score ?? 0]] as const).map(([l, v]) => (
              <div key={l} className="rounded-xl glass-subtle py-2.5">
                <p className="text-[16px] font-extrabold tabular-nums leading-none text-slate-900 dark:text-slate-100">{v}</p>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 space-y-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
            {r.bestDay && <p>🏅 Best day: <strong className="text-slate-700 dark:text-slate-200">{r.bestDay.label}</strong> at {r.bestDay.score} points.</p>}
            {r.topCategory && <p>{r.topCategory.emoji} Most of the work went into <strong className="text-slate-700 dark:text-slate-200">{r.topCategory.label}</strong> — {r.topCategory.count} completions.</p>}
            {r.vsPrevious != null && (
              <p>
                {r.vsPrevious >= 0 ? "📈" : "📉"} {Math.abs(r.vsPrevious)} point{Math.abs(r.vsPrevious) === 1 ? "" : "s"}{" "}
                {r.vsPrevious >= 0 ? "better" : "worse"} than the season before.
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <MedalIcon size={12} style={{ color: style.color }} /> Season medal: <strong style={{ color: style.color }}>{style.label}</strong>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
