import {
  type GameState, type Target, categoryOf,
  addDays, periodFor, todayKey, weekKey, monthKey, isAliveOn, matchesCadence, priorityOf,
} from "./store";
import type { DayResult, Timeline } from "./scoring";

// ── Challenges ──────────────────────────────────────────────────────────────
// A week of targets on its own is a checklist. A week with three challenges on
// top is a game. They're generated from *your* targets and *your* current form
// (so they're always plausible), picked deterministically from the week's key
// so they don't reshuffle every time the screen re-renders, and they pay XP.

export interface Challenge {
  id: string;
  title: string;
  desc: string;
  emoji: string;
  xp: number;
  value: number;
  goal: number;
  progress: number;
  done: boolean;
  scope: "week" | "month";
  periodLabel: string;
  unit?: string;
}

interface Ctx {
  state: GameState;
  tl: Timeline;
  days: DayResult[];       // the period's days so far
  start: string;
  end: string;
  label: string;
  scope: "week" | "month";
  liveTargets: Target[];
}

type Template = { key: string; build: (c: Ctx) => Challenge | null };

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mk(c: Ctx, id: string, emoji: string, title: string, desc: string, value: number, goal: number, xp: number, unit?: string): Challenge {
  const g = Math.max(1, Math.round(goal));
  return {
    id: `${c.scope}:${c.start}:${id}`,
    title,
    desc,
    emoji,
    xp,
    value: Math.round(value * 10) / 10,
    goal: g,
    progress: Math.max(0, Math.min(1, value / g)),
    done: value >= g,
    scope: c.scope,
    periodLabel: c.label,
    unit,
  };
}

const played = (c: Ctx) => c.days.filter((d) => !d.restDay);

const TEMPLATES: Template[] = [
  {
    key: "beat-rival",
    build: (c) => {
      const goal = c.scope === "week" ? 4 : 16;
      const wins = played(c).filter((d) => d.outcome === "win").length;
      return mk(c, "beat-rival", "⚔️", `Beat ${c.state.settings.rivalName} ${goal}×`, `Out-score your rival on ${goal} days ${c.label}.`, wins, goal, c.scope === "week" ? 180 : 700, "wins");
    },
  },
  {
    key: "perfect",
    build: (c) => {
      const goal = c.scope === "week" ? 2 : 8;
      const n = played(c).filter((d) => d.perfect).length;
      return mk(c, "perfect", "⭐", `${goal} flawless days`, "Every required target done, start to finish.", n, goal, c.scope === "week" ? 200 : 800, "days");
    },
  },
  {
    key: "no-floor",
    build: (c) => {
      const p = played(c);
      const above = p.filter((d) => d.score >= 50).length;
      if (!p.length && c.days.length < 2) return null;
      const goal = Math.max(3, c.scope === "week" ? 5 : 20);
      return mk(c, "no-floor", "🧱", "Keep the floor at 50", `No day below 50 points — ${goal} clean days needed.`, above, goal, c.scope === "week" ? 150 : 600, "days");
    },
  },
  {
    key: "bank-points",
    build: (c) => {
      // Asks for a little more than your recent form actually delivered.
      const base = c.tl.avg7 || 55;
      const days = c.scope === "week" ? 7 : 28;
      const goal = Math.max(100, Math.round((base * 1.12 * days) / 50) * 50);
      const have = played(c).reduce((a, d) => a + d.score, 0);
      return mk(c, "bank-points", "🏦", `Bank ${goal} points`, "Total day score across the period — consistency pays.", have, goal, c.scope === "week" ? 160 : 650, "pts");
    },
  },
  {
    key: "streak-keeper",
    build: (c) => {
      const goal = c.scope === "week" ? 5 : 22;
      const n = played(c).filter((d) => d.score >= c.state.settings.streakGoal).length;
      return mk(c, "streak-keeper", "🔥", `${goal} days above ${c.state.settings.streakGoal}`, "Keep the streak alive — that's the whole trick.", n, goal, c.scope === "week" ? 170 : 680, "days");
    },
  },
  {
    key: "focus-target",
    build: (c) => {
      // The heaviest target you own becomes the week's named mission.
      const pick = c.liveTargets
        .slice()
        .sort((a, b) => priorityOf(b.priority).weight - priorityOf(a.priority).weight)[0];
      if (!pick) return null;
      let due = 0;
      let hit = 0;
      for (let d = c.start; d <= c.end && d <= todayKey(); d = addDays(d, 1)) {
        if (!isAliveOn(pick, d) || !matchesCadence(pick, d)) continue;
        due++;
        const v = c.state.logs[d]?.[pick.id]?.value ?? 0;
        const ok = pick.direction === "atMost" ? v <= pick.goal : v >= (pick.measure === "check" ? 1 : pick.goal);
        if (ok) hit++;
      }
      if (due === 0) return null;
      return mk(c, "focus-target", pick.emoji || "🎯", `Mission: ${pick.title}`, `Land it every scheduled day ${c.label}. No excuses on this one.`, hit, due, c.scope === "week" ? 190 : 760, "days");
    },
  },
  {
    key: "category-push",
    build: (c) => {
      const counts: Record<string, number> = {};
      for (const d of c.days) for (const [k, n] of Object.entries(d.byCategory)) counts[k] = (counts[k] || 0) + n;
      const owned = [...new Set(c.liveTargets.map((t) => t.category))];
      if (!owned.length) return null;
      const key = owned[hash(`${c.start}cat`) % owned.length];
      const cat = categoryOf(key);
      const goal = c.scope === "week" ? 6 : 24;
      return mk(c, `category-${key}`, cat.emoji, `${cat.label} push`, `${goal} ${cat.label.toLowerCase()} targets completed ${c.label}.`, counts[key] || 0, goal, c.scope === "week" ? 150 : 600, "done");
    },
  },
  {
    key: "early-finish",
    build: (c) => {
      const goal = c.scope === "week" ? 2 : 8;
      const n = played(c).filter((d) => d.finishedBy != null && d.finishedBy < 13 * 60).length;
      return mk(c, "early-finish", "🌅", `Done by 13:00, ${goal}×`, "Finish the required list before the afternoon eats it.", n, goal, c.scope === "week" ? 180 : 720, "days");
    },
  },
  {
    key: "volume",
    build: (c) => {
      const n = c.days.reduce((a, d) => a + d.doneCount, 0);
      const base = Math.max(6, Math.round((c.tl.completions / Math.max(1, c.tl.activeDays)) * (c.scope === "week" ? 7 : 28) * 1.1));
      return mk(c, "volume", "📦", `${base} targets completed`, "Pure volume — every tick counts, required or not.", n, base, c.scope === "week" ? 150 : 600, "done");
    },
  },
  {
    key: "comeback",
    build: (c) => {
      const p = played(c);
      let n = 0;
      for (let i = 1; i < p.length; i++) if (p[i - 1].outcome === "loss" && p[i].outcome === "win") n++;
      if (c.scope === "month") return null;
      return mk(c, "comeback", "↩️", "Answer every loss", "Lose a day, win the next. Twice this week.", n, 2, 170, "times");
    },
  },
];

/** Three weekly challenges, picked from the week key so they stay put. */
export function weeklyChallenges(s: GameState, tl: Timeline, today: string = todayKey()): Challenge[] {
  const p = periodFor("week", today);
  const ctx: Ctx = {
    state: s,
    tl,
    days: tl.days.filter((d) => d.date >= p.start && d.date <= p.end),
    start: p.start,
    end: p.end,
    label: "this week",
    scope: "week",
    liveTargets: s.targets.filter((t) => isAliveOn(t, today)),
  };
  const seed = hash(`${s.settings.seed}|${weekKey(today)}`);
  const pool = TEMPLATES.slice();
  const picked: Challenge[] = [];
  // Deterministic walk through the pool — no duplicates, skips any template
  // that can't apply to the targets you actually have.
  for (let i = 0; i < pool.length && picked.length < 3; i++) {
    const idx = (seed + i * 7) % pool.length;
    const tpl = pool[idx];
    if (!tpl || picked.some((c) => c.id.endsWith(tpl.key))) continue;
    const built = tpl.build(ctx);
    if (built && !picked.some((c) => c.id === built.id)) picked.push(built);
    pool[idx] = null as unknown as Template;
  }
  return picked;
}

/** One big monthly boss fight. */
export function bossFight(s: GameState, tl: Timeline, today: string = todayKey()): Challenge | null {
  const p = periodFor("month", today);
  const ctx: Ctx = {
    state: s,
    tl,
    days: tl.days.filter((d) => d.date >= p.start && d.date <= p.end),
    start: p.start,
    end: p.end,
    label: "this month",
    scope: "month",
    liveTargets: s.targets.filter((t) => isAliveOn(t, today)),
  };
  const seed = hash(`${s.settings.seed}|boss|${monthKey(today)}`);
  const candidates = TEMPLATES.filter((t) => ["beat-rival", "perfect", "streak-keeper", "focus-target", "no-floor"].includes(t.key));
  for (let i = 0; i < candidates.length; i++) {
    const built = candidates[(seed + i) % candidates.length].build(ctx);
    if (built) return built;
  }
  return null;
}

/** XP already banked from finished challenges — shown as a bonus pot. */
export function challengeXp(list: Challenge[]): { earned: number; available: number } {
  return {
    earned: list.filter((c) => c.done).reduce((a, c) => a + c.xp, 0),
    available: list.reduce((a, c) => a + c.xp, 0),
  };
}
