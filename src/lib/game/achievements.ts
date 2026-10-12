import { CATEGORIES, weekKey, monthKey, yearKey, fromKey, prettyDay } from "./store";
import { levelFor, type DayResult, type Timeline } from "./scoring";

// ── Achievements, medals and seasons ────────────────────────────────────────
// Badges are *rules*, not records. We replay your whole history day by day and
// ask every rule "are you satisfied yet?" — so the first day a badge's
// condition held becomes the day it was earned, and nothing can drift out of
// sync with the logs.

export type Tier = "bronze" | "silver" | "gold" | "legend";

export const TIER_STYLE: Record<Tier, { label: string; xp: number; ring: string; glow: string }> = {
  bronze: { label: "Bronze", xp: 50, ring: "#b45309", glow: "rgba(180,83,9,0.35)" },
  silver: { label: "Silver", xp: 120, ring: "#64748b", glow: "rgba(100,116,139,0.35)" },
  gold: { label: "Gold", xp: 300, ring: "#f59e0b", glow: "rgba(245,158,11,0.4)" },
  legend: { label: "Legend", xp: 800, ring: "#8b5cf6", glow: "rgba(139,92,246,0.45)" },
};

/** Running totals as of the end of one replayed day. */
export interface Counters {
  activeDays: number;
  perfectDays: number;
  wins: number;
  draws: number;
  losses: number;
  bestDayStreak: number;
  bestWinStreak: number;
  completions: number;
  byCategory: Record<string, number>;
  level: number;
  bestScore: number;
  centuries: number;
  comebackWins: number;
  underdogWins: number;
  earlyDays: number;
  cleanWeeks: number;
  strongMonths: number;
  bestVolume: number;
  restDaysUsed: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  tier: Tier;
  group: string;
  goal: number;
  pick: (c: Counters) => number;
}

function a(id: string, name: string, desc: string, emoji: string, tier: Tier, group: string, goal: number, pick: (c: Counters) => number): Achievement {
  return { id, name, desc, emoji, tier, group, goal, pick };
}

const CATEGORY_BADGES: Achievement[] = CATEGORIES.map((c) =>
  a(
    `cat-${c.key}`,
    `${c.label} ${c.key === "body" ? "Engine" : c.key === "mind" ? "Edge" : c.key === "money" ? "Machine" : c.key === "people" ? "Person" : c.key === "craft" ? "Maker" : "Operator"}`,
    `50 ${c.label.toLowerCase()} targets completed`,
    c.emoji,
    "silver",
    "Mastery",
    50,
    (x) => x.byCategory[c.key] || 0
  )
);

export const ACHIEVEMENTS: Achievement[] = [
  // Streaks — the spine of the whole thing.
  a("streak-3", "Warming Up", "A 3-day streak", "🔥", "bronze", "Streaks", 3, (c) => c.bestDayStreak),
  a("streak-7", "Week Strong", "A 7-day streak", "🔥", "silver", "Streaks", 7, (c) => c.bestDayStreak),
  a("streak-14", "Fortnight", "A 14-day streak", "🔥", "gold", "Streaks", 14, (c) => c.bestDayStreak),
  a("streak-30", "Unbroken", "A 30-day streak", "🔥", "gold", "Streaks", 30, (c) => c.bestDayStreak),
  a("streak-100", "Century Streak", "A 100-day streak", "🔥", "legend", "Streaks", 100, (c) => c.bestDayStreak),

  // Perfect days.
  a("perfect-1", "Flawless", "Everything done in one day", "⭐", "bronze", "Perfection", 1, (c) => c.perfectDays),
  a("perfect-5", "Five Flawless", "5 perfect days", "⭐", "silver", "Perfection", 5, (c) => c.perfectDays),
  a("perfect-25", "Immaculate", "25 perfect days", "⭐", "gold", "Perfection", 25, (c) => c.perfectDays),
  a("perfect-75", "Untarnished", "75 perfect days", "⭐", "legend", "Perfection", 75, (c) => c.perfectDays),

  // The duel.
  a("win-1", "First Blood", "Beat your rival once", "⚔️", "bronze", "The duel", 1, (c) => c.wins),
  a("win-10", "Ten Scalps", "10 wins", "⚔️", "bronze", "The duel", 10, (c) => c.wins),
  a("win-50", "Rival Rattled", "50 wins", "⚔️", "silver", "The duel", 50, (c) => c.wins),
  a("win-150", "Dominant", "150 wins", "⚔️", "gold", "The duel", 150, (c) => c.wins),
  a("win-365", "A Year of Wins", "365 wins", "⚔️", "legend", "The duel", 365, (c) => c.wins),
  a("wstreak-3", "On a Run", "Beat the rival 3 days running", "🏃", "bronze", "The duel", 3, (c) => c.bestWinStreak),
  a("wstreak-7", "Untouchable", "7 straight wins", "🛡️", "silver", "The duel", 7, (c) => c.bestWinStreak),
  a("wstreak-14", "Ghost Buster", "14 straight wins", "💥", "gold", "The duel", 14, (c) => c.bestWinStreak),
  a("underdog-1", "Giant Slayer", "Beat the rival on one of its big days (85+)", "🗡️", "silver", "The duel", 1, (c) => c.underdogWins),
  a("underdog-5", "Fearless", "5 wins against an 85+ rival", "🗡️", "gold", "The duel", 5, (c) => c.underdogWins),
  a("comeback-1", "Comeback Kid", "Win straight after losing three in a row", "↩️", "silver", "The duel", 1, (c) => c.comebackWins),
  a("comeback-5", "Rope-a-Dope", "5 comeback wins", "↩️", "gold", "The duel", 5, (c) => c.comebackWins),

  // Peaks.
  a("best-80", "Strong Day", "Score 80 in a day", "📈", "bronze", "Peaks", 80, (c) => c.bestScore),
  a("best-90", "Big Day", "Score 90 in a day", "📈", "silver", "Peaks", 90, (c) => c.bestScore),
  a("best-100", "Perfect Hundred", "Score a clean 100", "💯", "gold", "Peaks", 100, (c) => c.bestScore),
  a("century-10", "Ten Hundreds", "Ten 100-point days", "💯", "legend", "Peaks", 10, (c) => c.centuries),
  a("volume-8", "Workhorse", "8 targets completed in one day", "🐎", "silver", "Peaks", 8, (c) => c.bestVolume),

  // Character.
  a("early-1", "Early Bird", "Finish everything before noon", "🌅", "bronze", "Character", 1, (c) => c.earlyDays),
  a("early-10", "Morning Person", "10 days finished before noon", "🌅", "gold", "Character", 10, (c) => c.earlyDays),

  // Staying power.
  a("active-30", "A Month In", "30 days played", "📅", "bronze", "Staying power", 30, (c) => c.activeDays),
  a("active-100", "Hundred Days", "100 days played", "📅", "silver", "Staying power", 100, (c) => c.activeDays),
  a("active-365", "A Year of You", "365 days played", "📅", "legend", "Staying power", 365, (c) => c.activeDays),
  a("weeks-4", "Four Clean Weeks", "4 weeks averaging 80+", "🗓️", "silver", "Staying power", 4, (c) => c.cleanWeeks),
  a("weeks-12", "A Quarter Clean", "12 weeks averaging 80+", "🗓️", "gold", "Staying power", 12, (c) => c.cleanWeeks),
  a("months-3", "Quarter Master", "3 months averaging 80+", "🏅", "gold", "Staying power", 3, (c) => c.strongMonths),
  a("months-12", "The Full Year", "12 months averaging 80+", "🏅", "legend", "Staying power", 12, (c) => c.strongMonths),

  // Volume.
  a("done-50", "Fifty Down", "50 targets completed", "✅", "bronze", "Volume", 50, (c) => c.completions),
  a("done-250", "Quarter Thousand", "250 targets completed", "✅", "silver", "Volume", 250, (c) => c.completions),
  a("done-1000", "Four Figures", "1,000 targets completed", "✅", "gold", "Volume", 1000, (c) => c.completions),
  a("done-3000", "The Machine", "3,000 targets completed", "⚙️", "legend", "Volume", 3000, (c) => c.completions),

  // Levels.
  a("level-5", "Contender", "Reach level 5", "🌱", "bronze", "Levels", 5, (c) => c.level),
  a("level-10", "Challenger", "Reach level 10", "⚔️", "silver", "Levels", 10, (c) => c.level),
  a("level-25", "Elite", "Reach level 25", "💎", "gold", "Levels", 25, (c) => c.level),
  a("level-50", "Grandmaster", "Reach level 50", "👑", "legend", "Levels", 50, (c) => c.level),

  ...CATEGORY_BADGES,
];

export interface AchievementState extends Achievement {
  unlocked: boolean;
  at?: string;      // the day it was earned
  value: number;    // where you stand now
  progress: number; // 0–1
}

function emptyCounters(): Counters {
  return {
    activeDays: 0, perfectDays: 0, wins: 0, draws: 0, losses: 0,
    bestDayStreak: 0, bestWinStreak: 0, completions: 0, byCategory: {},
    level: 1, bestScore: 0, centuries: 0, comebackWins: 0, underdogWins: 0,
    earlyDays: 0, cleanWeeks: 0, strongMonths: 0, bestVolume: 0, restDaysUsed: 0,
  };
}

interface Bucket { key: string; sum: number; days: number; wins: number; perfect: number }

function newBucket(key: string): Bucket {
  return { key, sum: 0, days: 0, wins: 0, perfect: 0 };
}

let cache: { tl: Timeline; data: AchievementState[] } | null = null;

/** Replay history and return every badge with its progress and unlock date. */
export function achievements(tl: Timeline): AchievementState[] {
  if (cache && cache.tl === tl) return cache.data;

  const c = emptyCounters();
  const unlocked: Record<string, string> = {};
  let lossRun = 0;
  let totalXp = 0;
  let week = newBucket("");
  let month = newBucket("");

  const finishWeek = () => {
    if (week.days >= 4 && week.sum / week.days >= 80) c.cleanWeeks++;
  };
  const finishMonth = () => {
    if (month.days >= 14 && month.sum / month.days >= 80) c.strongMonths++;
  };

  for (const d of tl.days) {
    totalXp += d.xp;
    c.level = levelFor(totalXp).level;

    for (const [cat, n] of Object.entries(d.byCategory)) {
      c.byCategory[cat] = (c.byCategory[cat] || 0) + n;
      c.completions += n;
    }
    c.bestVolume = Math.max(c.bestVolume, d.doneCount + d.bonusCount);

    if (d.restDay) {
      c.restDaysUsed++;
    } else {
      const wk = weekKey(d.date);
      const mo = monthKey(d.date);
      if (week.key !== wk) { if (week.key) finishWeek(); week = newBucket(wk); }
      if (month.key !== mo) { if (month.key) finishMonth(); month = newBucket(mo); }
      week.sum += d.score; week.days++;
      month.sum += d.score; month.days++;

      c.activeDays++;
      c.bestScore = Math.max(c.bestScore, d.score);
      if (d.score >= 100) c.centuries++;
      if (d.perfect) { c.perfectDays++; week.perfect++; month.perfect++; }
      if (d.finishedBy != null && d.finishedBy < 12 * 60) c.earlyDays++;
      c.bestDayStreak = Math.max(c.bestDayStreak, d.dayStreak);
      c.bestWinStreak = Math.max(c.bestWinStreak, d.winStreak);

      if (d.outcome === "win") {
        c.wins++; week.wins++; month.wins++;
        if (lossRun >= 3) c.comebackWins++;
        if (d.ghost >= 85) c.underdogWins++;
        lossRun = 0;
      } else if (d.outcome === "loss") {
        c.losses++;
        lossRun++;
      } else if (d.outcome === "draw") {
        c.draws++;
        lossRun = 0;
      }
    }

    for (const ach of ACHIEVEMENTS) {
      if (unlocked[ach.id]) continue;
      if (ach.pick(c) >= ach.goal) unlocked[ach.id] = d.date;
    }
  }

  const data: AchievementState[] = ACHIEVEMENTS.map((ach) => {
    const value = ach.pick(c);
    return {
      ...ach,
      unlocked: !!unlocked[ach.id],
      at: unlocked[ach.id],
      value,
      progress: Math.max(0, Math.min(1, value / ach.goal)),
    };
  });

  cache = { tl, data };
  return data;
}

/** Badges earned on a given day — what the verdict screen celebrates. */
export function badgesOn(list: AchievementState[], date: string): AchievementState[] {
  return list.filter((b) => b.unlocked && b.at === date);
}

export function badgeSummary(list: AchievementState[]) {
  const earned = list.filter((b) => b.unlocked);
  const byTier = (t: Tier) => earned.filter((b) => b.tier === t).length;
  return {
    earned: earned.length,
    total: list.length,
    xp: earned.reduce((a, b) => a + TIER_STYLE[b.tier].xp, 0),
    bronze: byTier("bronze"),
    silver: byTier("silver"),
    gold: byTier("gold"),
    legend: byTier("legend"),
    next: list
      .filter((b) => !b.unlocked)
      .sort((x, y) => y.progress - x.progress)
      .slice(0, 3),
  };
}

// ── Medals: the weekly / monthly / yearly prizes ────────────────────────────

export type MedalTier = "none" | "bronze" | "silver" | "gold" | "platinum";

export const MEDAL_STYLE: Record<MedalTier, { label: string; emoji: string; color: string }> = {
  none: { label: "No medal", emoji: "▫️", color: "#94a3b8" },
  bronze: { label: "Bronze", emoji: "🥉", color: "#b45309" },
  silver: { label: "Silver", emoji: "🥈", color: "#94a3b8" },
  gold: { label: "Gold", emoji: "🥇", color: "#f59e0b" },
  platinum: { label: "Platinum", emoji: "🏆", color: "#8b5cf6" },
};

/** avg score + minimum days played, per period. Earn the days *and* the quality. */
const LADDER: Record<"week" | "month" | "year", { tier: MedalTier; avg: number; days: number }[]> = {
  week: [
    { tier: "platinum", avg: 92, days: 5 },
    { tier: "gold", avg: 82, days: 5 },
    { tier: "silver", avg: 72, days: 4 },
    { tier: "bronze", avg: 60, days: 3 },
  ],
  month: [
    { tier: "platinum", avg: 90, days: 20 },
    { tier: "gold", avg: 80, days: 18 },
    { tier: "silver", avg: 70, days: 14 },
    { tier: "bronze", avg: 60, days: 10 },
  ],
  year: [
    { tier: "platinum", avg: 88, days: 240 },
    { tier: "gold", avg: 78, days: 200 },
    { tier: "silver", avg: 68, days: 150 },
    { tier: "bronze", avg: 58, days: 100 },
  ],
};

export interface Medal {
  period: "week" | "month" | "year";
  key: string;
  label: string;
  tier: MedalTier;
  avg: number;
  days: number;
  wins: number;
  perfect: number;
  xp: number;
  current: boolean;
  /** What the next medal up still asks for. */
  next: { tier: MedalTier; avg: number; days: number } | null;
}

function tierFor(period: "week" | "month" | "year", avg: number, days: number): MedalTier {
  for (const row of LADDER[period]) if (avg >= row.avg && days >= row.days) return row.tier;
  return "none";
}

function nextRung(period: "week" | "month" | "year", tier: MedalTier) {
  const rows = LADDER[period];
  const idx = rows.findIndex((r) => r.tier === tier);
  if (idx === 0) return null;                 // already at the top
  return rows[idx < 0 ? rows.length - 1 : idx - 1];
}

const MEDAL_XP: Record<MedalTier, Record<"week" | "month" | "year", number>> = {
  none: { week: 0, month: 0, year: 0 },
  bronze: { week: 60, month: 250, year: 1200 },
  silver: { week: 120, month: 500, year: 2400 },
  gold: { week: 220, month: 900, year: 4200 },
  platinum: { week: 400, month: 1600, year: 7500 },
};

function labelFor(period: "week" | "month" | "year", key: string): string {
  if (period === "week") {
    const d = fromKey(key);
    return `Week of ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
  if (period === "month") return fromKey(`${key}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return key;
}

function build(period: "week" | "month" | "year", groups: Map<string, DayResult[]>, currentKey: string): Medal[] {
  const out: Medal[] = [];
  for (const [key, days] of groups) {
    const played = days.filter((d) => !d.restDay);
    const avg = played.length ? Math.round(played.reduce((x, d) => x + d.score, 0) / played.length) : 0;
    const tier = tierFor(period, avg, played.length);
    out.push({
      period,
      key,
      label: labelFor(period, key),
      tier,
      avg,
      days: played.length,
      wins: played.filter((d) => d.outcome === "win").length,
      perfect: played.filter((d) => d.perfect).length,
      xp: MEDAL_XP[tier][period],
      current: key === currentKey,
      next: nextRung(period, tier),
    });
  }
  return out.sort((x, y) => (x.key < y.key ? 1 : -1)); // newest first
}

export interface Medals {
  weeks: Medal[];
  months: Medal[];
  years: Medal[];
  thisWeek: Medal | null;
  thisMonth: Medal | null;
  thisYear: Medal | null;
  /** Finished periods only — the actual trophy haul. */
  haul: { platinum: number; gold: number; silver: number; bronze: number };
}

let medalCache: { tl: Timeline; today: string; data: Medals } | null = null;

export function medals(tl: Timeline, today: string): Medals {
  if (medalCache && medalCache.tl === tl && medalCache.today === today) return medalCache.data;

  const group = (fn: (d: DayResult) => string) => {
    const m = new Map<string, DayResult[]>();
    for (const d of tl.days) {
      const k = fn(d);
      const arr = m.get(k);
      if (arr) arr.push(d);
      else m.set(k, [d]);
    }
    return m;
  };

  const weeks = build("week", group((d) => weekKey(d.date)), weekKey(today));
  const months = build("month", group((d) => monthKey(d.date)), monthKey(today));
  const years = build("year", group((d) => yearKey(d.date)), yearKey(today));

  const haul = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const m of [...weeks, ...months, ...years]) {
    if (m.current || m.tier === "none") continue;
    haul[m.tier]++;
  }

  const data: Medals = {
    weeks,
    months,
    years,
    thisWeek: weeks.find((m) => m.current) || null,
    thisMonth: months.find((m) => m.current) || null,
    thisYear: years.find((m) => m.current) || null,
    haul,
  };
  medalCache = { tl, today, data };
  return data;
}

// ── Season recap (a season is a calendar month) ─────────────────────────────

export interface Recap {
  key: string;
  label: string;
  seasonNo: number;
  days: number;
  avg: number;
  wins: number;
  losses: number;
  draws: number;
  perfect: number;
  xp: number;
  completions: number;
  bestDay: { date: string; label: string; score: number } | null;
  topCategory: { key: string; label: string; emoji: string; count: number } | null;
  medal: MedalTier;
  vsPrevious: number | null; // change in average vs the month before
}

export function recapFor(tl: Timeline, month: string): Recap | null {
  const days = tl.days.filter((d) => monthKey(d.date) === month);
  if (!days.length) return null;
  const played = days.filter((d) => !d.restDay);
  const avg = played.length ? Math.round(played.reduce((x, d) => x + d.score, 0) / played.length) : 0;

  const prev = tl.days.filter((d) => monthKey(d.date) === monthKey(toPrevMonth(month)) && !d.restDay);
  const prevAvg = prev.length ? Math.round(prev.reduce((x, d) => x + d.score, 0) / prev.length) : null;

  const cats: Record<string, number> = {};
  let completions = 0;
  for (const d of days) {
    for (const [k, n] of Object.entries(d.byCategory)) {
      cats[k] = (cats[k] || 0) + n;
      completions += n;
    }
  }
  const topKey = Object.entries(cats).sort((x, y) => y[1] - x[1])[0];
  const cat = topKey ? CATEGORIES.find((c) => c.key === topKey[0]) : undefined;
  const best = played.length ? played.reduce((x, y) => (y.score > x.score ? y : x)) : null;
  const first = monthKey(tl.days[0]?.date || month);
  const seasonNo = monthsBetween(first, month) + 1;

  return {
    key: month,
    label: fromKey(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    seasonNo,
    days: played.length,
    avg,
    wins: played.filter((d) => d.outcome === "win").length,
    losses: played.filter((d) => d.outcome === "loss").length,
    draws: played.filter((d) => d.outcome === "draw").length,
    perfect: played.filter((d) => d.perfect).length,
    xp: days.reduce((x, d) => x + d.xp, 0),
    completions,
    bestDay: best ? { date: best.date, label: prettyDay(best.date), score: best.score } : null,
    topCategory: cat && topKey ? { key: cat.key, label: cat.label, emoji: cat.emoji, count: topKey[1] } : null,
    medal: tierFor("month", avg, played.length),
    vsPrevious: prevAvg != null ? avg - prevAvg : null,
  };
}

function toPrevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Every season played, newest first. */
export function seasons(tl: Timeline): Recap[] {
  const keys = [...new Set(tl.days.map((d) => monthKey(d.date)))].sort().reverse();
  return keys.map((k) => recapFor(tl, k)).filter(Boolean) as Recap[];
}
