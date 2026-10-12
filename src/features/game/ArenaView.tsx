import { useEffect, useMemo, useState } from "react";
import { Plus, Check, X, Flame, Zap, Clock, Trophy, Swords, Lock, ChevronDown, Target as TargetIcon, Sparkles } from "lucide-react";
import {
  type GameState, type Target, categoryOf, priorityOf, todayKey, setLog, toggleLog, bumpLog, logValue, canLog, isFlexible,
} from "../../lib/game/store";
import { timeline, campaignOf, quotaOf, cadenceLabel, msToClose, isSealed, scoreDay, type DayItem } from "../../lib/game/scoring";
import { weeklyChallenges, bossFight, challengeXp, type Challenge } from "../../lib/game/challenges";
import { factOfDay, nudge } from "../../lib/game/facts";
import { useCountUp } from "../../lib/useCountUp";

// The Arena: today's board. One hero that answers "am I winning?", the list of
// what's actually on the line, this week's challenges, and one fact worth
// reading. Everything is one tap from here — the whole point is that logging a
// target should be faster than thinking about not logging it.

export default function ArenaView({
  s, onAddTarget, onEditTarget, onVerdict, onTrophies,
}: {
  s: GameState;
  onAddTarget: () => void;
  onEditTarget: (t: Target) => void;
  onVerdict: (date: string) => void;
  onTrophies: () => void;
}) {
  const today = todayKey();
  const tl = timeline(s, today);
  const day = tl.today;
  const sc = useMemo(() => scoreDay(s, today), [s, today]);

  // The hero shows a live countdown and flips to "sealed" on the hour, so it
  // has to re-render without a store write.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const sealed = isSealed(s, today);
  const open = canLog(today);
  const msLeft = msToClose(s);
  const challenges = useMemo(() => weeklyChallenges(s, tl, today), [s, tl, today]);
  const boss = useMemo(() => bossFight(s, tl, today), [s, tl, today]);
  const fact = useMemo(() => factOfDay(s, tl, today), [s, tl, today]);

  const required = sc.items.filter((i) => i.required);
  const optional = sc.items.filter((i) => !i.required);
  const openRequired = required.filter((i) => !i.done);
  const doneRequired = required.filter((i) => i.done);
  const scoreShown = useCountUp(day.score, 850);
  const ghostShown = useCountUp(day.ghost, 850);
  const cxp = challengeXp(challenges);

  const line = nudge({
    rival: s.settings.rivalName,
    score: day.score,
    ghost: day.ghost,
    dueLeft: openRequired.length,
    sealed,
    outcome: day.outcome,
    streak: tl.dayStreak,
  });

  const ahead = day.score >= day.ghost;
  const dayNo = tl.days.length;

  return (
    <div className="space-y-3.5">
      {/* ── The hero: today's duel ────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl p-5 text-white accent-gradient shadow-accent">
        <div className="absolute -right-10 -top-12 w-48 h-48 rounded-full bg-white/15 blur-2xl" aria-hidden />
        {sealed && ahead && day.outcome === "win" && (
          <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/20 blur-md animate-sheen" aria-hidden />
        )}

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
              Day {dayNo} · {sealed ? "sealed" : "in play"}
            </p>
            <div className="mt-1 flex items-end gap-1.5">
              <span className="text-[52px] leading-none font-black tabular-nums display-num">{Math.round(scoreShown)}</span>
              <span className="text-[15px] font-bold text-white/60 mb-1.5">/100</span>
            </div>
          </div>
          <div className="text-right">
            {sealed ? (
              <button
                onClick={() => onVerdict(today)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/18 text-[11.5px] font-bold active:scale-95"
              >
                <Trophy size={14} /> Verdict
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/15 text-[11.5px] font-bold tabular-nums">
                <Clock size={13} /> {fmtLeft(msLeft)} to {s.settings.closeTime}
              </span>
            )}
            <p className="mt-2 text-[11px] text-white/70 tabular-nums">
              {doneRequired.length}/{required.length || 0} done
              {optional.length ? ` · ${optional.length} optional` : ""}
            </p>
          </div>
        </div>

        {/* Two bars, one story */}
        <div className="relative mt-4 space-y-2">
          <Bar label="You" value={day.score} tone="you" />
          <Bar
            label={`${s.settings.rivalEmoji} ${s.settings.rivalName}`}
            value={day.restDay ? 0 : Math.round(ghostShown)}
            tone="rival"
          />
        </div>

        <p className="relative mt-3 text-[12.5px] leading-snug text-white/85">{line}</p>

        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <Mini icon={<Flame size={13} />} value={`${tl.dayStreak}`} label={tl.dayStreak === 1 ? "day streak" : "day streak"} hot={tl.dayStreak >= 3} />
          <Mini icon={<Zap size={13} />} value={`+${day.xp}`} label="XP today" />
          <Mini icon={<Swords size={13} />} value={`${tl.record.win}–${tl.record.loss}`} label="head to head" />
        </div>

        {!sealed && required.length > 0 && openRequired.length === 0 && (
          <button
            onClick={() => onVerdict(today)}
            className="relative mt-4 w-full h-11 rounded-2xl bg-white text-brand-700 text-[13px] font-bold active:scale-[0.98]"
          >
            Everything done — settle the day early
          </button>
        )}
      </section>

      {/* ── The board ─────────────────────────────────────────────────── */}
      {sc.items.length === 0 ? (
        <section className="rounded-3xl glass p-5 text-center">
          <TargetIcon size={26} className="mx-auto text-brand-500 mb-2" />
          <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100">Nothing on the board today</p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            {s.targets.length
              ? "None of your targets are scheduled for today. A rest day costs you nothing — and anything you log still pays bonus XP."
              : "Add your first target and the game starts tonight at " + s.settings.closeTime + "."}
          </p>
          <button onClick={onAddTarget} className="mt-3 inline-flex items-center gap-1.5 h-10 px-4 rounded-2xl accent-gradient text-white text-[13px] font-bold shadow-accent active:scale-95">
            <Plus size={16} /> New target
          </button>
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              On the line today
            </h2>
            <button onClick={onAddTarget} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-brand-600 dark:text-brand-400">
              <Plus size={13} /> Add
            </button>
          </div>

          {!open && (
            <div className="flex items-center gap-2 rounded-2xl glass-subtle px-3.5 py-2.5">
              <Lock size={14} className="text-slate-400 shrink-0" />
              <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                The day is sealed — logging closed at {s.settings.closeTime}. Turn on late edits in settings if you'd rather keep it open until midnight.
              </p>
            </div>
          )}

          {[...openRequired, ...optional.filter((i) => !i.done), ...doneRequired, ...optional.filter((i) => i.done)].map((item) => (
            <ArenaRow key={item.target.id} s={s} item={item} date={today} open={open} onEdit={() => onEditTarget(item.target)} />
          ))}
        </section>
      )}

      {/* ── Challenges ────────────────────────────────────────────────── */}
      {(challenges.length > 0 || boss) && (
        <section className="rounded-3xl glass p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">This week's challenges</h2>
            <span className="text-[10.5px] font-bold tabular-nums text-brand-600 dark:text-brand-400">
              {cxp.earned}/{cxp.available} XP
            </span>
          </div>
          <div className="mt-2.5 space-y-2">
            {challenges.map((c) => <ChallengeRow key={c.id} c={c} />)}
          </div>
          {boss && (
            <div className="mt-3 pt-3 border-t border-slate-900/8 dark:border-white/10">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-amber-500" />
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Monthly boss fight</h3>
              </div>
              <ChallengeRow c={boss} boss />
            </div>
          )}
        </section>
      )}

      {/* ── One fact ──────────────────────────────────────────────────── */}
      <section className="rounded-3xl p-4 relative overflow-hidden hero-ink text-white">
        <div className="absolute -right-6 -bottom-10 w-32 h-32 rounded-full bg-brand-500/20 blur-2xl" aria-hidden />
        <div className="relative flex items-start gap-3">
          <span className="text-[24px] leading-none shrink-0">{fact.emoji}</span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold">{fact.headline}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/70">{fact.body}</p>
          </div>
        </div>
      </section>

      {/* ── Trophy teaser ─────────────────────────────────────────────── */}
      <button onClick={onTrophies} className="w-full flex items-center gap-3 rounded-3xl glass p-4 text-left active:scale-[0.99] transition-transform">
        <span className="grid place-items-center w-11 h-11 rounded-2xl accent-gradient-soft shrink-0">
          <Trophy size={19} className="text-brand-600 dark:text-brand-300" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100">
            Level {tl.level.level} · {tl.level.title} {tl.level.emoji}
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full accent-gradient transition-[width] duration-700" style={{ width: `${Math.round(tl.level.progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500 tabular-nums">
            {tl.level.xpIntoLevel} / {tl.level.xpForNext} XP to level {tl.level.level + 1}
          </p>
        </div>
        <ChevronDown size={16} className="text-slate-300 dark:text-slate-600 -rotate-90 shrink-0" />
      </button>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function fmtLeft(ms: number): string {
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Bar({ label, value, tone }: { label: string; value: number; tone: "you" | "rival" }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-[92px] shrink-0 text-[11px] font-bold truncate ${tone === "you" ? "text-white" : "text-white/70"}`}>{label}</span>
      <div className="flex-1 h-3 rounded-full bg-white/18 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-[900ms] ease-out ${tone === "you" ? "bg-white" : "bg-white/45"}`}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
      <span className="w-7 text-right text-[12.5px] font-extrabold tabular-nums">{value}</span>
    </div>
  );
}

function Mini({ icon, value, label, hot }: { icon: React.ReactNode; value: string; label: string; hot?: boolean }) {
  return (
    <div className={`rounded-2xl px-2 py-2.5 text-center ${hot ? "bg-white/20" : "bg-white/12"}`}>
      <span className="inline-flex items-center justify-center text-white/65">{icon}</span>
      <p className="text-[15px] font-extrabold tabular-nums leading-none mt-0.5">{value}</p>
      <p className="text-[9.5px] text-white/60 mt-0.5">{label}</p>
    </div>
  );
}

function ChallengeRow({ c, boss }: { c: Challenge; boss?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-2.5 ${c.done ? "trophy-gold" : "glass-subtle"}`}>
      <div className="flex items-center gap-2.5">
        <span className="text-[17px] leading-none shrink-0">{c.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[12.5px] font-bold truncate ${c.done ? "text-amber-700 dark:text-amber-300" : "text-slate-900 dark:text-slate-100"}`}>
            {c.title}
          </p>
          <p className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate">{c.desc}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[12px] font-extrabold tabular-nums text-slate-700 dark:text-slate-200">
            {c.value}
            <span className="text-slate-400 dark:text-slate-500">/{c.goal}</span>
          </p>
          <p className={`text-[9.5px] font-bold ${c.done ? "text-amber-600 dark:text-amber-400" : "text-brand-600 dark:text-brand-400"}`}>
            {c.done ? "✓ claimed" : `+${c.xp} XP`}
          </p>
        </div>
      </div>
      <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${boss ? "bg-amber-500/15" : "bg-slate-900/8 dark:bg-white/10"}`}>
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${Math.round(c.progress * 100)}%`,
            background: c.done ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : boss ? "linear-gradient(90deg,#f59e0b,#f472b6)" : "linear-gradient(90deg,#6366f1,#22d3ee)",
          }}
        />
      </div>
    </div>
  );
}

/** One target on today's board, with its logging controls. */
function ArenaRow({ s, item, date, open, onEdit }: { s: GameState; item: DayItem; date: string; open: boolean; onEdit: () => void }) {
  const t = item.target;
  const cat = categoryOf(t.category);
  const prio = priorityOf(t.priority);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [pulse, setPulse] = useState(0);

  const campaign = campaignOf(s, t, date);
  const quota = quotaOf(s, t, date);
  const isNumber = t.measure === "number";
  const avoid = t.direction === "atMost";
  const value = logValue(s, date, t.id);
  const step = t.goal >= 1000 ? 500 : t.goal >= 100 ? 25 : t.goal >= 20 ? 5 : 1;

  function tick() {
    if (!open) return;
    toggleLog(date, t);
    setPulse((p) => p + 1);
  }

  return (
    <div className={`rounded-2xl overflow-hidden transition-colors ${item.done ? "glass-subtle" : "glass"}`}>
      <div className="flex items-stretch">
        {/* Category spine */}
        <span className="w-1 shrink-0" style={{ background: cat.color, opacity: item.done ? 0.4 : 1 }} aria-hidden />

        <button onClick={onEdit} className="flex-1 min-w-0 text-left px-3 py-3 active:opacity-70 transition-opacity">
          <div className="flex items-center gap-2">
            <span className={`text-[17px] leading-none ${item.done ? "opacity-60" : ""}`}>{t.emoji}</span>
            <p className={`text-[13.5px] font-bold truncate ${item.done ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-900 dark:text-slate-100"}`}>
              {t.title}
            </p>
            {!item.required && (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-900/8 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                OPTIONAL
              </span>
            )}
            {item.required && (t.priority === "must" || t.priority === "high") && (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md text-white" style={{ background: prio.color }}>
                {t.priority === "must" ? "MUST" : "KEY"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500 truncate">
            {cadenceLabel(t)}
            {isNumber ? ` · ${avoid ? "max " : ""}${t.goal}${t.unit ? ` ${t.unit}` : ""}` : avoid ? " · keep clean" : ""}
            {quota ? ` · ${quota.done}/${quota.need} ${quota.label}` : ""}
            {` · worth ${prio.weight} pt${prio.weight === 1 ? "" : "s"}`}
          </p>

          {/* Campaign bar — the longer timeline this target serves */}
          {campaign && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between text-[9.5px] font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
                <span>{campaign.period.label}: {round1(campaign.total)}/{campaign.goal}{t.unit ? ` ${t.unit}` : ""}</span>
                <span className={campaign.onTrack ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                  {campaign.daysLeft > 0 ? `${round1(campaign.pace)}${t.unit ? ` ${t.unit}` : ""}/day left` : "period over"}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.round(campaign.progress * 100)}%`, background: cat.color }}
                />
              </div>
            </div>
          )}
        </button>

        {/* Logging control */}
        <div className="shrink-0 pr-3 py-3 flex items-center">
          {isNumber ? (
            <button
              onClick={() => setExpanded((e) => !e)}
              disabled={!open}
              className={`min-w-[70px] px-2.5 py-2 rounded-xl text-center transition-all active:scale-95 disabled:opacity-50 ${
                item.done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "glass-subtle text-slate-700 dark:text-slate-200"
              }`}
            >
              <span key={pulse} className="block text-[15px] font-extrabold tabular-nums leading-none animate-tick">
                {round1(value)}
              </span>
              <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                {avoid ? "max" : "of"} {t.goal}
              </span>
            </button>
          ) : (
            <button
              onClick={tick}
              disabled={!open}
              aria-label={item.done ? "Mark as not done" : "Mark as done"}
              className={`grid place-items-center w-11 h-11 rounded-2xl border-2 transition-all active:scale-[0.88] disabled:opacity-50 ${
                avoid
                  ? item.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-rose-400 bg-rose-500/15 text-rose-500"
                  : item.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 dark:border-slate-600 text-transparent"
              }`}
            >
              {avoid && !item.done
                ? <X key={pulse} size={20} strokeWidth={3.2} className="animate-tick" />
                : <Check key={pulse} size={20} strokeWidth={3.2} className="animate-tick" />}
            </button>
          )}
        </div>
      </div>

      {/* Number pad */}
      {isNumber && expanded && (
        <div className="px-3 pb-3 animate-in">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { bumpLog(date, t.id, -step); setPulse((p) => p + 1); }}
              disabled={!open}
              className="grid place-items-center w-11 h-11 rounded-xl glass-subtle text-[20px] font-bold text-slate-500 dark:text-slate-400 active:scale-90 disabled:opacity-40"
            >
              −
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                const v = parseFloat(draft.replace(",", "."));
                if (isFinite(v) && v >= 0) { setLog(date, t.id, v); setPulse((p) => p + 1); }
                setDraft("");
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              type="text" inputMode="decimal"
              placeholder={String(round1(value))}
              disabled={!open}
              className="flex-1 min-w-0 h-11 rounded-xl glass-subtle px-3 text-[16px] font-bold tabular-nums text-center text-slate-900 dark:text-slate-100 outline-none"
            />
            <button
              onClick={() => { bumpLog(date, t.id, step); setPulse((p) => p + 1); }}
              disabled={!open}
              className="grid place-items-center w-11 h-11 rounded-xl glass-subtle text-[20px] font-bold text-slate-500 dark:text-slate-400 active:scale-90 disabled:opacity-40"
            >
              ＋
            </button>
            <button
              onClick={() => { setLog(date, t.id, avoid ? 0 : t.goal); setPulse((p) => p + 1); setExpanded(false); }}
              disabled={!open}
              className="h-11 px-3.5 rounded-xl accent-gradient text-white text-[12px] font-bold shadow-accent active:scale-95 disabled:opacity-40"
            >
              {avoid ? "Clean" : "Goal"}
            </button>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
            {quickSteps(t.goal, step).map((v) => (
              <button
                key={v}
                onClick={() => { setLog(date, t.id, v); setPulse((p) => p + 1); }}
                disabled={!open}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[11.5px] font-bold tabular-nums disabled:opacity-40 ${
                  value === v ? "accent-gradient-soft text-brand-600 dark:text-brand-300" : "glass-subtle text-slate-500 dark:text-slate-400"
                }`}
              >
                {v}{t.unit ? ` ${t.unit}` : ""}
              </button>
            ))}
            {value > 0 && (
              <button
                onClick={() => { setLog(date, t.id, 0); setPulse((p) => p + 1); }}
                disabled={!open}
                className="shrink-0 px-3 py-1.5 rounded-lg text-[11.5px] font-bold glass-subtle text-rose-500 disabled:opacity-40"
              >
                clear
              </button>
            )}
          </div>
          {isFlexible(t) && quota && (
            <p className="mt-2 text-[10.5px] text-slate-400 dark:text-slate-500">
              {quota.done >= quota.need
                ? `Quota met — ${quota.done} of ${quota.need} ${quota.label}. Anything more is bonus XP.`
                : `${quota.need - quota.done} more needed ${quota.label}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function quickSteps(goal: number, step: number): number[] {
  const set = new Set<number>();
  for (const f of [0.25, 0.5, 0.75, 1, 1.25]) {
    const v = Math.round((goal * f) / step) * step;
    if (v > 0) set.add(v);
  }
  if (goal > 0) set.add(goal);
  return [...set].sort((a, b) => a - b).slice(0, 5);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
