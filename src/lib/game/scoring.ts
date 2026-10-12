import {
  type GameState, type Target, type Difficulty,
  addDays, todayKey, toKey, minutesOf, periodFor, weightOf, hits,
  targetsOn, isRequiredOn, logValue, logEntry, firstPlayedDay, isFlexible,
} from "./store";

// ── Scoring ─────────────────────────────────────────────────────────────────
// Everything here is a pure function of the stored facts. The day score is a
// weighted percentage: each target carries the weight of its priority, and you
// earn the share of it you actually delivered. Overachievement and optional
// (quota) work land in a separate bonus pool so a day can never score above
// 100 — but extra effort still pays in XP.

export interface DayItem {
  target: Target;
  required: boolean;
  value: number;
  ratio: number;   // 0–1, how much of the target was delivered
  weight: number;
  done: boolean;
  over: number;    // 0–1, how far past the goal you went (atLeast only)
  at: number;      // last logged timestamp (0 = never)
}

export interface DayScore {
  date: string;
  items: DayItem[];
  earned: number;    // weighted delivery on required targets
  possible: number;  // total weight of required targets
  bonus: number;     // weighted extra: quota work done early + overachievement
  score: number;     // 0–100
  perfect: boolean;
  restDay: boolean;  // nothing was due — doesn't count for or against you
  doneCount: number; // required targets satisfied
  bonusCount: number; // optional (quota) targets satisfied on top
  dueCount: number;
  /** Minutes past midnight when the last required target was satisfied. */
  finishedBy: number | null;
}

function ratioOf(t: Target, value: number): { ratio: number; over: number } {
  if (t.direction === "atMost") {
    // A limit you stay under. Going over decays linearly, so one slip isn't a
    // total write-off but a blowout is.
    const room = Math.max(1, t.goal || 1);
    if (value <= t.goal) return { ratio: 1, over: 0 };
    return { ratio: Math.max(0, 1 - (value - t.goal) / room), over: 0 };
  }
  const goal = t.measure === "check" ? 1 : Math.max(0.0001, t.goal);
  const r = value / goal;
  return { ratio: Math.min(1, r), over: Math.min(1, Math.max(0, r - 1)) };
}

export function scoreDay(s: GameState, key: string): DayScore {
  const items: DayItem[] = targetsOn(s, key).map((t) => {
    const value = logValue(s, key, t.id);
    const { ratio, over } = ratioOf(t, value);
    const entry = logEntry(s, key, t.id);
    return {
      target: t,
      required: isRequiredOn(s, t, key),
      value,
      ratio,
      weight: weightOf(t),
      done: hits(t, value),
      over,
      at: entry?.at ?? 0,
    };
  });

  let earned = 0;
  let possible = 0;
  let bonus = 0;
  let doneCount = 0;
  let bonusCount = 0;
  let dueCount = 0;
  let lastRequiredAt = 0;
  let allRequiredDone = true;

  for (const it of items) {
    if (it.required) {
      dueCount++;
      possible += it.weight;
      earned += it.weight * it.ratio;
      if (it.done) {
        doneCount++;
        lastRequiredAt = Math.max(lastRequiredAt, it.at);
      } else {
        allRequiredDone = false;
      }
    } else if (it.done) {
      // Quota work banked ahead of the deadline — pays, but can't be demanded.
      bonus += it.weight * 0.6;
      bonusCount++;
    }
    // Going past the goal always pays a little.
    if (it.over > 0) bonus += it.weight * it.over * 0.5;
  }

  const restDay = possible === 0;
  const raw = restDay ? (bonus > 0 ? 100 : 0) : (earned / possible) * 100;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let finishedBy: number | null = null;
  if (allRequiredDone && dueCount > 0 && lastRequiredAt > 0) {
    const d = new Date(lastRequiredAt);
    if (toKey(d) === key) finishedBy = d.getHours() * 60 + d.getMinutes();
  }

  return {
    date: key,
    items,
    earned,
    possible,
    bonus,
    score,
    perfect: dueCount > 0 && allRequiredDone,
    restDay,
    doneCount,
    bonusCount,
    dueCount,
    finishedBy,
  };
}

// ── The rival ───────────────────────────────────────────────────────────────
// A ghost that plays your own game. Its daily form is built from *your* recent
// scores, so it stays within reach as you improve and never leaves you playing
// for nothing. The number is deterministic per day (seed + date), so it can be
// shown in the morning as the bar to beat rather than sprung on you at night.

const DIFFICULTY_OFFSET: Record<Difficulty, number> = { easy: -14, fair: -5, rival: 2, nemesis: 9 };

export const DIFFICULTIES: { key: Difficulty; label: string; blurb: string }[] = [
  { key: "easy", label: "Warm-up", blurb: "Plays a little below your form — good for building a streak." },
  { key: "fair", label: "Fair fight", blurb: "Just under your recent average. Winnable on a decent day." },
  { key: "rival", label: "Rival", blurb: "Matches your form and nudges past it. You have to earn every win." },
  { key: "nemesis", label: "Nemesis", blurb: "Plays above your form. Only a strong day beats it." },
];

/** Deterministic 0–1 from a string. */
function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Your recent form — weighted to the last few days. */
function formOf(recent: number[]): number {
  if (!recent.length) return 55;
  const last3 = recent.slice(0, 3);
  const last10 = recent.slice(0, 10);
  const a = last3.reduce((x, y) => x + y, 0) / last3.length;
  const b = last10.reduce((x, y) => x + y, 0) / last10.length;
  return a * 0.6 + b * 0.4;
}

export interface GhostInput {
  date: string;
  seed: string;
  difficulty: Difficulty;
  recentScores: number[]; // newest first, rest days excluded
  winStreak: number;      // yours, coming into the day
  lossStreak: number;
}

export function ghostScore(g: GhostInput): number {
  const jitter = (hash01(`${g.seed}|${g.date}`) - 0.5) * 17; // ±8.5 — its own good and bad days
  // First days are deliberately gentle: a new player should taste a win.
  if (g.recentScores.length < 3) {
    return Math.max(20, Math.min(90, Math.round(46 + jitter * 0.6 + DIFFICULTY_OFFSET[g.difficulty] * 0.5)));
  }
  // It learns: a winning run makes it raise its game, a losing run eases off.
  const momentum =
    g.winStreak >= 3 ? Math.min(10, (g.winStreak - 2) * 2) :
    g.lossStreak >= 2 ? -Math.min(12, (g.lossStreak - 1) * 3) : 0;
  const v = formOf(g.recentScores) + DIFFICULTY_OFFSET[g.difficulty] + jitter + momentum;
  return Math.max(25, Math.min(97, Math.round(v)));
}

export type Outcome = "win" | "draw" | "loss" | "rest";

// ── XP and levels ───────────────────────────────────────────────────────────

/** XP needed to climb from `level` to the next one. */
function stepFor(level: number): number {
  return Math.round(60 + 40 * Math.pow(level, 1.35));
}

const THRESHOLDS: number[] = (() => {
  const out = [0];
  for (let l = 1; l <= 120; l++) out.push(out[l - 1] + stepFor(l));
  return out;
})();

export const LEVEL_TITLES: { from: number; title: string; emoji: string }[] = [
  { from: 1, title: "Rookie", emoji: "🌱" },
  { from: 5, title: "Contender", emoji: "🔥" },
  { from: 10, title: "Challenger", emoji: "⚔️" },
  { from: 16, title: "Professional", emoji: "🎯" },
  { from: 24, title: "Elite", emoji: "💎" },
  { from: 34, title: "Master", emoji: "🏆" },
  { from: 46, title: "Grandmaster", emoji: "👑" },
  { from: 60, title: "Legend", emoji: "🌟" },
];

export function titleFor(level: number) {
  let found = LEVEL_TITLES[0];
  for (const t of LEVEL_TITLES) if (level >= t.from) found = t;
  return found;
}

export interface LevelInfo {
  level: number;
  title: string;
  emoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number; // 0–1 toward the next level
  totalXp: number;
}

export function levelFor(totalXp: number): LevelInfo {
  let level = 1;
  while (level < THRESHOLDS.length - 1 && totalXp >= THRESHOLDS[level]) level++;
  const base = THRESHOLDS[level - 1];
  const next = THRESHOLDS[level] ?? base + stepFor(level);
  const span = Math.max(1, next - base);
  const t = titleFor(level);
  return {
    level,
    title: t.title,
    emoji: t.emoji,
    xpIntoLevel: Math.max(0, totalXp - base),
    xpForNext: span,
    progress: Math.max(0, Math.min(1, (totalXp - base) / span)),
    totalXp,
  };
}

/** Total XP needed to reach a level — used to draw the growth path. */
export function xpAtLevel(level: number): number {
  return THRESHOLDS[Math.max(0, Math.min(THRESHOLDS.length - 1, level - 1))];
}

function xpForDay(d: { earned: number; bonus: number; perfect: boolean; outcome: Outcome; dayStreak: number }): number {
  const base = d.earned * 10 + d.bonus * 6;
  const perfect = d.perfect ? 25 : 0;
  const duel = d.outcome === "win" ? 20 : d.outcome === "draw" ? 8 : 0;
  const streak = Math.min(14, d.dayStreak) * 2;
  return Math.round(base + perfect + duel + streak);
}

// ── The timeline: one sequential pass over every day played ─────────────────

export interface DayResult {
  date: string;
  score: number;
  ghost: number;
  outcome: Outcome;
  restDay: boolean;
  perfect: boolean;
  xp: number;
  earned: number;
  possible: number;
  bonus: number;
  doneCount: number;
  bonusCount: number;
  dueCount: number;
  dayStreak: number;
  winStreak: number;
  finishedBy: number | null;
  byCategory: Record<string, number>;
}

export interface Timeline {
  days: DayResult[];                     // every calendar day since you started
  byDate: Record<string, DayResult>;
  level: LevelInfo;
  record: { win: number; draw: number; loss: number };
  dayStreak: number;
  bestDayStreak: number;
  winStreak: number;
  bestWinStreak: number;
  lossStreak: number;
  perfectDays: number;
  activeDays: number;
  avg7: number;
  avg30: number;
  avgAll: number;
  best: DayResult | null;
  completions: number;
  byCategory: Record<string, number>;
  today: DayResult;
}

function emptyDay(date: string): DayResult {
  return {
    date, score: 0, ghost: 0, outcome: "rest", restDay: true, perfect: false, xp: 0,
    earned: 0, possible: 0, bonus: 0, doneCount: 0, bonusCount: 0, dueCount: 0, dayStreak: 0, winStreak: 0,
    finishedBy: null, byCategory: {},
  };
}

let cache: { state: GameState; upTo: string; data: Timeline } | null = null;

/**
 * Walks forward through every day from your first to `upTo`, scoring each day
 * and playing the rival against it. Sequential because the rival reacts to the
 * run of results before it. Cached on the store object, which is replaced
 * wholesale on every write.
 */
export function timeline(s: GameState, upTo: string = todayKey()): Timeline {
  if (cache && cache.state === s && cache.upTo === upTo) return cache.data;

  // Never walk more than ~3¼ years, however far back a target is dated —
  // the window has to end on `upTo` or today's result would fall off it.
  const limit = 1200;
  const earliest = addDays(upTo, -(limit - 1));
  const start = firstPlayedDay(s) < earliest ? earliest : firstPlayedDay(s);
  const days: DayResult[] = [];
  const byDate: Record<string, DayResult> = {};
  const recent: number[] = []; // newest first, rest days excluded
  const byCategory: Record<string, number> = {};
  let win = 0, draw = 0, loss = 0;
  let dayStreak = 0, bestDayStreak = 0;
  let winStreak = 0, bestWinStreak = 0, lossStreak = 0;
  let perfectDays = 0, activeDays = 0, completions = 0, totalXp = 0;

  let key = start;
  if (upTo < start) key = upTo;

  for (let i = 0; i < limit && key <= upTo; i++, key = addDays(key, 1)) {
    const sc = scoreDay(s, key);
    const ghost = sc.restDay
      ? 0
      : ghostScore({ date: key, seed: s.settings.seed, difficulty: s.settings.difficulty, recentScores: recent, winStreak, lossStreak });

    let outcome: Outcome = "rest";
    if (!sc.restDay) {
      outcome = sc.score > ghost ? "win" : sc.score === ghost ? "draw" : "loss";
    }

    // Streaks only move on days that actually asked something of you.
    if (!sc.restDay) {
      if (sc.score >= s.settings.streakGoal) dayStreak++;
      else dayStreak = 0;
      bestDayStreak = Math.max(bestDayStreak, dayStreak);
      if (outcome === "win") { winStreak++; lossStreak = 0; }
      else if (outcome === "loss") { lossStreak++; winStreak = 0; }
      else { winStreak = 0; lossStreak = 0; }
      bestWinStreak = Math.max(bestWinStreak, winStreak);
      activeDays++;
      recent.unshift(sc.score);
      if (recent.length > 14) recent.pop();
      if (outcome === "win") win++;
      else if (outcome === "draw") draw++;
      else if (outcome === "loss") loss++;
      if (sc.perfect) perfectDays++;
    }

    const cats: Record<string, number> = {};
    for (const it of sc.items) {
      if (!it.done) continue;
      completions++;
      cats[it.target.category] = (cats[it.target.category] || 0) + 1;
      byCategory[it.target.category] = (byCategory[it.target.category] || 0) + 1;
    }

    const xp = xpForDay({ earned: sc.earned, bonus: sc.bonus, perfect: sc.perfect, outcome, dayStreak });
    totalXp += xp;

    const res: DayResult = {
      date: key,
      score: sc.score,
      ghost,
      outcome,
      restDay: sc.restDay,
      perfect: sc.perfect,
      xp,
      earned: sc.earned,
      possible: sc.possible,
      bonus: sc.bonus,
      doneCount: sc.doneCount,
      bonusCount: sc.bonusCount,
      dueCount: sc.dueCount,
      dayStreak,
      winStreak,
      finishedBy: sc.finishedBy,
      byCategory: cats,
    };
    days.push(res);
    byDate[key] = res;
  }

  const played = days.filter((d) => !d.restDay);
  const avgOf = (arr: DayResult[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b.score, 0) / arr.length) : 0);
  const last = (n: number) => played.slice(-n);

  const data: Timeline = {
    days,
    byDate,
    level: levelFor(totalXp),
    record: { win, draw, loss },
    dayStreak,
    bestDayStreak,
    winStreak,
    bestWinStreak,
    lossStreak,
    perfectDays,
    activeDays,
    avg7: avgOf(last(7)),
    avg30: avgOf(last(30)),
    avgAll: avgOf(played),
    best: played.length ? played.reduce((a, b) => (b.score > a.score ? b : a)) : null,
    completions,
    byCategory,
    today: byDate[upTo] || emptyDay(upTo),
  };

  cache = { state: s, upTo, data };
  return data;
}

/** Has this day been sealed — i.e. is it past its close time? */
export function isSealed(s: GameState, key: string, now = new Date()): boolean {
  const today = toKey(now);
  if (key < today) return true;
  if (key > today) return false;
  return now.getHours() * 60 + now.getMinutes() >= minutesOf(s.settings.closeTime);
}

/** Milliseconds until the day is sealed (0 once it is). */
export function msToClose(s: GameState, now = new Date()): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  const left = minutesOf(s.settings.closeTime) - mins;
  if (left <= 0) return 0;
  return left * 60_000 - now.getSeconds() * 1000;
}

// ── Campaign progress (targets with a longer timeline) ──────────────────────

export interface Campaign {
  period: { start: string; end: string; label: string };
  total: number;      // logged so far in the period
  goal: number;
  progress: number;   // 0–1
  daysLeft: number;
  pace: number;       // per-day needed from here to finish on time
  onTrack: boolean;
}

export function campaignOf(s: GameState, t: Target, key: string = todayKey()): Campaign | null {
  if (t.horizon === "day" || !t.campaignGoal || t.campaignGoal <= 0) return null;
  const p = periodFor(t.horizon, key);
  let total = 0;
  for (let d = p.start; d <= p.end && d <= key; d = addDays(d, 1)) total += logValue(s, d, t.id);
  const goal = t.campaignGoal;
  const daysLeft = Math.max(0, Math.round((new Date(`${p.end}T00:00:00`).getTime() - new Date(`${key}T00:00:00`).getTime()) / 86_400_000) + 1);
  const remaining = Math.max(0, goal - total);
  const elapsed = Math.max(1, Math.round((new Date(`${key}T00:00:00`).getTime() - new Date(`${p.start}T00:00:00`).getTime()) / 86_400_000) + 1);
  const span = elapsed + Math.max(0, daysLeft - 1);
  const expected = (goal / Math.max(1, span)) * elapsed;
  return {
    period: p,
    total,
    goal,
    progress: Math.max(0, Math.min(1, total / goal)),
    daysLeft,
    pace: daysLeft > 0 ? remaining / daysLeft : remaining,
    onTrack: total >= expected * 0.95,
  };
}

/** "3 of 4 this week" for quota targets. */
export function quotaOf(s: GameState, t: Target, key: string = todayKey()): { done: number; need: number; label: string } | null {
  if (!isFlexible(t)) return null;
  const monthly = t.cadence.kind === "timesPerMonth";
  const p = periodFor(monthly ? "month" : "week", key);
  let done = 0;
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (hits(t, logValue(s, d, t.id))) done++;
  return { done, need: Math.max(1, t.cadence.times || 1), label: monthly ? "this month" : "this week" };
}

export function cadenceLabel(t: Target): string {
  const c = t.cadence;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (c.kind) {
    case "daily": return "Every day";
    case "weekdays": return "Mon–Fri";
    case "weekends": return "Weekends";
    case "days": return (c.days || []).length ? (c.days || []).slice().sort().map((d) => names[d]).join(" ") : "Pick days";
    case "timesPerWeek": return `${c.times || 3}× a week`;
    case "timesPerMonth": return `${c.times || 4}× a month`;
    case "once": return c.date ? `Once · ${c.date}` : "One-off";
    default: return "Every day";
  }
}

export function goalLabel(t: Target): string {
  if (t.measure === "check") return t.direction === "atMost" ? "Avoid" : "Done / not done";
  const unit = t.unit ? ` ${t.unit}` : "";
  return `${t.direction === "atMost" ? "≤" : ""}${t.goal}${unit}`;
}
