import { useEffect, useMemo, useState } from "react";
import { X, Flame, Zap, Check, TrendingUp, ChevronRight } from "lucide-react";
import { useGame, markVerdictSeen, markBadgesSeen, prettyDay, todayKey, priorityOf } from "../../lib/game/store";
import { timeline, levelFor, scoreDay } from "../../lib/game/scoring";
import { achievements, badgesOn, TIER_STYLE } from "../../lib/game/achievements";
import { useCountUp } from "../../lib/useCountUp";
import Confetti from "./Confetti";

// The day's verdict. Everything the section builds toward lands here: the two
// scores race each other, the result stamps in, and anything you unlocked
// tumbles out afterwards. Shown once per day automatically after the close
// time, and replayable from history.

const WORDS = {
  win: { word: "VICTORY", sub: "You beat your rival.", tone: "verdict-win" },
  loss: { word: "DEFEAT", sub: "The rival took this one.", tone: "verdict-loss" },
  draw: { word: "DEAD HEAT", sub: "Nobody won today.", tone: "verdict-draw" },
  rest: { word: "REST DAY", sub: "Nothing was due.", tone: "verdict-draw" },
} as const;

export default function DayVerdict({ date, onClose, onGrowth }: { date: string; onClose: () => void; onGrowth?: () => void }) {
  const s = useGame();
  const tl = timeline(s, todayKey());
  const res = tl.byDate[date];
  const badges = useMemo(() => badgesOn(achievements(tl), date), [tl, date]);
  const sc = useMemo(() => scoreDay(s, date), [s, date]);

  // On a loss, name the one target that would have flipped it — the most
  // useful sentence the whole screen can produce.
  const swing = useMemo(() => {
    if (!res || res.outcome !== "loss" || !sc.possible) return null;
    const missed = sc.items.filter((i) => i.required && !i.done);
    if (!missed.length) return null;
    const scored = missed
      .map((i) => ({
        item: i,
        would: Math.round(((sc.earned + i.weight * (1 - i.ratio)) / sc.possible) * 100),
      }))
      .sort((a, b) => b.would - a.would);
    const flipper = scored.find((x) => x.would > res.ghost);
    return flipper ?? scored[0];
  }, [sc, res]);

  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [stage, setStage] = useState(reduce ? 3 : 0);

  // Mark it seen immediately: the verdict should never ambush you twice, even
  // if the app is closed mid-animation.
  useEffect(() => {
    markVerdictSeen(date);
    if (badges.length) markBadgesSeen(badges.map((b) => b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    if (reduce) return;
    const timers = [
      window.setTimeout(() => setStage(1), 280),   // scores race
      window.setTimeout(() => setStage(2), 1500),  // the stamp
      window.setTimeout(() => setStage(3), 2250),  // stats, xp, badges
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Counters run unconditionally — hooks can't sit behind an early return.
  const you = useCountUp(stage >= 1 && res ? res.score : 0, 1000);
  const them = useCountUp(stage >= 1 && res ? res.ghost : 0, 1000);
  const xpShown = useCountUp(stage >= 3 && res ? res.xp : 0, 900);

  if (!res) return null;

  const outcome = res.outcome;
  const v = WORDS[outcome];
  const level = levelFor(tl.level.totalXp);
  const youWon = outcome === "win";
  const theyWon = outcome === "loss";

  return (
    <div className={`fixed inset-0 z-[60] overflow-y-auto ${v.tone}`}>
      {stage >= 2 && youWon && <Confetti mode="win" />}
      <div className="relative min-h-full flex flex-col max-w-lg mx-auto px-5 py-6 safe-top safe-bottom text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Full time</p>
            <p className="text-[13px] font-semibold text-white/80">{prettyDay(date)}</p>
          </div>
          <button onClick={onClose} className="grid place-items-center w-10 h-10 rounded-full bg-white/10 text-white/80 active:scale-95" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* ── The duel ────────────────────────────────────────────────── */}
        <div className="mt-7 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Side
            label="You"
            emoji="🧑‍🚀"
            score={Math.round(you)}
            win={youWon}
            lost={theyWon}
            stage={stage}
          />
          <div className="text-center px-1">
            <p className="text-[11px] font-black text-white/40 tracking-widest">VS</p>
          </div>
          <Side
            label={s.settings.rivalName}
            emoji={s.settings.rivalEmoji}
            score={outcome === "rest" ? 0 : Math.round(them)}
            win={theyWon}
            lost={youWon}
            stage={stage}
            ghost
          />
        </div>

        {/* ── The word ────────────────────────────────────────────────── */}
        {stage >= 2 && (
          <div className="mt-8 text-center">
            <h2
              className={`animate-stamp font-black tracking-tight leading-none ${
                youWon ? "text-[46px] text-white" : outcome === "draw" ? "text-[38px] text-amber-200" : "text-[40px] text-slate-300"
              }`}
              style={youWon ? { textShadow: "0 0 34px rgba(129,140,248,0.75)" } : undefined}
            >
              {v.word}
            </h2>
            <p className="mt-2 text-[13.5px] text-white/70">
              {outcome === "rest"
                ? v.sub
                : `${v.sub} ${res.score}–${res.ghost}${youWon ? ` · won by ${res.score - res.ghost}` : theyWon ? ` · short by ${res.ghost - res.score}` : ""}`}
            </p>
          </div>
        )}

        {/* ── What the day actually produced ──────────────────────────── */}
        {stage >= 3 && (
          <div className="mt-7 space-y-3 animate-in">
            <div className="grid grid-cols-3 gap-2.5">
              <Stat
                icon={<Check size={14} />}
                value={res.dueCount ? `${res.doneCount}/${res.dueCount}` : `${res.bonusCount}`}
                label={res.bonusCount ? `targets · +${res.bonusCount} bonus` : "targets"}
              />
              <Stat icon={<Zap size={14} />} value={`+${Math.round(xpShown)}`} label="XP earned" />
              <Stat icon={<Flame size={14} />} value={`${res.dayStreak}`} label="day streak" />
            </div>

            {/* Level progress — where the XP went */}
            <div className="rounded-2xl bg-white/10 p-3.5">
              <div className="flex items-center justify-between text-[11.5px] font-semibold">
                <span className="text-white/90">{level.emoji} Level {level.level} · {level.title}</span>
                <span className="text-white/55 tabular-nums">{level.xpIntoLevel} / {level.xpForNext}</span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300 transition-[width] duration-[1200ms] ease-out"
                  style={{ width: `${Math.round(level.progress * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10.5px] text-white/50">
                {level.xpForNext - level.xpIntoLevel} XP to level {level.level + 1}
              </p>
            </div>

            {/* Anything unlocked today */}
            {badges.length > 0 && (
              <div className="rounded-2xl bg-white/10 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                  {badges.length === 1 ? "Achievement unlocked" : `${badges.length} achievements unlocked`}
                </p>
                <div className="mt-2.5 space-y-2">
                  {badges.map((b, i) => (
                    <div
                      key={b.id}
                      className="animate-badge flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5"
                      style={{ animationDelay: `${i * 140}ms`, boxShadow: `inset 0 0 0 1px ${TIER_STYLE[b.tier].glow}` }}
                    >
                      <span className="text-[22px] leading-none">{b.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold truncate">{b.name}</p>
                        <p className="text-[10.5px] text-white/60 truncate">{b.desc}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: TIER_STYLE[b.tier].glow }}>
                        {TIER_STYLE[b.tier].label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What would have won it */}
            {swing && (
              <div className="rounded-2xl bg-white/10 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">What would have won it</p>
                <div className="mt-2 flex items-center gap-2.5">
                  <span className="text-[20px] leading-none">{swing.item.target.emoji}</span>
                  <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white/85">
                    <strong>{swing.item.target.title}</strong>{" "}
                    {swing.would > res.ghost
                      ? <>alone takes you to <strong>{swing.would}</strong> — that's the day, won.</>
                      : <>was the biggest one left ({swing.would} with it). Not enough on its own tonight.</>}
                  </p>
                </div>
              </div>
            )}

            {/* The day, item by item */}
            {sc.items.length > 0 && (
              <div className="rounded-2xl bg-white/10 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">The day in review</p>
                <div className="mt-2 space-y-1.5">
                  {sc.items.map((i) => (
                    <div key={i.target.id} className="flex items-center gap-2 text-[12px]">
                      <span className="w-4 text-center shrink-0">{i.target.emoji}</span>
                      <span className={`min-w-0 flex-1 truncate ${i.done ? "text-white/85" : "text-white/45"}`}>{i.target.title}</span>
                      {!i.required && <span className="shrink-0 text-[9px] font-bold text-white/35">OPT</span>}
                      <span className="shrink-0 tabular-nums text-[11px] text-white/50">
                        {i.target.measure === "number" ? `${Math.round(i.value * 10) / 10}/${i.target.goal}` : ""}
                      </span>
                      <span className={`shrink-0 w-4 text-right font-bold ${i.done ? "text-emerald-400" : "text-rose-400"}`}>
                        {i.done ? "✓" : "✗"}
                      </span>
                      <span className="shrink-0 w-7 text-right text-[10.5px] font-bold tabular-nums text-white/40">
                        {i.required ? `${Math.round(i.weight * i.ratio * 10) / 10}/${priorityOf(i.target.priority).weight}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* The honest one-liner */}
            <p className="text-center text-[12.5px] text-white/65 px-2 leading-relaxed">
              {closingLine(outcome, res.score, tl.dayStreak, tl.winStreak, s.settings.rivalName)}
            </p>
          </div>
        )}

        <div className="mt-auto pt-6 flex gap-2.5">
          {onGrowth && (
            <button
              onClick={() => { onClose(); onGrowth(); }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl bg-white/12 text-[13.5px] font-bold text-white active:scale-[0.98]"
            >
              <TrendingUp size={16} /> Growth path
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-center gap-1 h-12 rounded-2xl bg-white text-[13.5px] font-bold text-slate-900 active:scale-[0.98]"
          >
            {outcome === "win" ? "Bank it" : "Tomorrow"} <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Side({
  label, emoji, score, win, lost, stage, ghost,
}: { label: string; emoji: string; score: number; win: boolean; lost: boolean; stage: number; ghost?: boolean }) {
  const show = stage >= 2;
  return (
    <div
      className={`relative rounded-3xl px-3 py-5 text-center overflow-hidden ${
        show && win ? "animate-victory bg-white/16" : show && lost ? "animate-shudder bg-white/5" : "bg-white/8"
      }`}
      style={show && win ? { boxShadow: "0 0 0 1px rgba(255,255,255,0.3), 0 16px 44px rgba(99,102,241,0.4)" } : undefined}
    >
      {show && win && <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25 blur-md animate-sheen" aria-hidden />}
      <span className={`relative block text-[30px] leading-none ${ghost ? "animate-bob" : ""}`}>{emoji}</span>
      <p className="relative mt-1.5 text-[11px] font-bold uppercase tracking-wider text-white/55 truncate">{label}</p>
      <p className={`relative mt-0.5 text-[40px] font-black leading-none tabular-nums display-num ${show && lost ? "text-white/45" : "text-white"}`}>
        {score}
      </p>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/10 px-2 py-3 text-center">
      <span className="inline-flex items-center justify-center text-white/60">{icon}</span>
      <p className="mt-1 text-[17px] font-extrabold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[9.5px] text-white/50">{label}</p>
    </div>
  );
}

function closingLine(outcome: string, score: number, streak: number, winStreak: number, rival: string): string {
  if (outcome === "rest") return "A day off the board costs you nothing. Tomorrow it counts again.";
  if (outcome === "win") {
    if (winStreak >= 5) return `${winStreak} wins in a row. ${rival} is going to come back harder — that's the deal you made.`;
    if (score >= 95) return "Near-flawless. This is what your average could look like.";
    if (streak >= 7) return `${streak} days unbroken. The streak is the asset now — protect it.`;
    return "Banked. The only thing that matters is whether tomorrow looks like today.";
  }
  if (outcome === "draw") return "A point either way. Nothing is decided by one day — which is exactly why you get another.";
  if (score >= 70) return "A strong day that still lost. That happens when you're playing a rival worth beating.";
  if (score >= 40) return "Half a day delivered. Pick the two that matter most tomorrow and start with those.";
  return "Nothing to spin here. The fix is small: one target, early, tomorrow.";
}
