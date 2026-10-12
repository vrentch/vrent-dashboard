import { type GameState, todayKey, fromKey, daysBetween, startOfYear, endOfYear, CATEGORIES } from "./store";
import type { Timeline } from "./scoring";

// ── Facts & figures ─────────────────────────────────────────────────────────
// Three honest flavours, deliberately no invented research:
//   • "math"   — arithmetic you can check on a napkin
//   • "figure" — computed from your own logs
//   • "line"   — the app's own voice, stated as opinion, not evidence
// The deck is state-aware: a losing run pulls a resilience card, a long streak
// pulls one about protecting it.

export type FactKind = "math" | "figure" | "line";

export interface Fact {
  kind: FactKind;
  emoji: string;
  headline: string;
  body: string;
}

const MATH: Fact[] = [
  {
    kind: "math", emoji: "📈",
    headline: "1% a day is 37× a year",
    body: "1.01^365 ≈ 37.8. The same 1% the other way (0.99^365) leaves you at 0.03. Same effort, opposite sign.",
  },
  {
    kind: "math", emoji: "🧮",
    headline: "Boring beats brilliant",
    body: "A 70-point day, every day, is 490 points a week. Two perfect days and five blanks is 200. Consistency isn't a virtue, it's arithmetic.",
  },
  {
    kind: "math", emoji: "⏳",
    headline: "30 minutes, four days a week",
    body: "That's 104 hours a year — two and a half full working weeks of something you chose.",
  },
  {
    kind: "math", emoji: "🔁",
    headline: "2% a week doubles in 35 weeks",
    body: "1.02^35 ≈ 2.0. Less than nine months to twice the output, if you can hold the 2%.",
  },
  {
    kind: "math", emoji: "🎯",
    headline: "Five days a week is 260 reps",
    body: "Any skill, 260 repetitions a year. Twenty minutes each is 87 hours of deliberate practice.",
  },
  {
    kind: "math", emoji: "💡",
    headline: "20 points is a free week",
    body: "Lifting your daily average from 60 to 80 adds 600 points a month — an entire extra week of your own effort, from the same days.",
  },
  {
    kind: "math", emoji: "📅",
    headline: "Half a year is 182 wins",
    body: "One target a day, six months, and you can count 182 finished things. Most plans never produce one.",
  },
];

const LINES: Fact[] = [
  { kind: "line", emoji: "🌅", headline: "Monday is a story", body: "Today is a score. Only one of them goes on the board." },
  { kind: "line", emoji: "🧱", headline: "Protect the floor, not the ceiling", body: "Your worst day sets your average far more than your best one does. Raise the floor." },
  { kind: "line", emoji: "🥷", headline: "Your rival never has a bad reason", body: "It doesn't get tired, bored or busy. It just posts a number. Post a bigger one." },
  { kind: "line", emoji: "♻️", headline: "Three, seven, thirty", body: "Three days is a trial. Seven is a habit forming. Thirty is who you are now." },
  { kind: "line", emoji: "🎚️", headline: "Shrink the target, keep the streak", body: "A 10-minute version of the habit on a bad day is worth more than a perfect version you skip." },
  { kind: "line", emoji: "🧭", headline: "Score the day you got", body: "Not the day you planned. The point is the next entry, not the clean history." },
  { kind: "line", emoji: "⚡", headline: "Momentum is cheap to keep", body: "Expensive to rebuild. That's the whole reason the streak counter exists." },
  { kind: "line", emoji: "🪞", headline: "You're the only opponent", body: "Everything on this screen is a measurement of a decision you already made today." },
];

const COMEBACK: Fact[] = [
  { kind: "line", emoji: "↩️", headline: "A loss is one data point", body: "A losing week is a pattern. You're still in the first case — answer it tomorrow." },
  { kind: "line", emoji: "🔥", headline: "Start the new streak today", body: "The old one is gone and it isn't coming back. The new one needs exactly one day to exist." },
  { kind: "math", emoji: "📉", headline: "Two bad days cost 4% of a month", body: "Thirty days, two zeros — that's it. The story you tell about them costs far more." },
];

const STREAK_SAFE: Fact[] = [
  { kind: "line", emoji: "🛡️", headline: "You have something to lose now", body: "That's the point. The streak turns a vague intention into an asset you'd rather not drop." },
  { kind: "line", emoji: "🎯", headline: "Bank the minimum early", body: "On a long streak, do the smallest version of each target before noon. Then the day can go wrong." },
];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(list: T[], seed: string): T {
  return list[hash(seed) % list.length];
}

/** Figures drawn from your own history — the most persuasive numbers there are. */
export function personalFacts(s: GameState, tl: Timeline, today = todayKey()): Fact[] {
  const out: Fact[] = [];
  const { completions, activeDays, record, bestDayStreak, avg30, perfectDays, level } = tl;
  const total = record.win + record.draw + record.loss;

  if (completions >= 10) {
    out.push({
      kind: "figure", emoji: "✅",
      headline: `${completions.toLocaleString()} targets completed`,
      body: `Across ${activeDays} day${activeDays === 1 ? "" : "s"} of play — an average of ${(completions / Math.max(1, activeDays)).toFixed(1)} finished things per day.`,
    });
  }
  if (total >= 5) {
    const rate = Math.round((record.win / total) * 100);
    out.push({
      kind: "figure", emoji: "⚔️",
      headline: `${rate}% win rate against ${s.settings.rivalName}`,
      body: `${record.win}W · ${record.draw}D · ${record.loss}L. ${rate >= 60 ? "Your rival is being outplayed — it will raise its game." : rate >= 45 ? "A genuine contest. Exactly where it should be." : "It's ahead for now. The gap closes with the boring days, not the heroic ones."}`,
    });
  }
  if (bestDayStreak >= 3) {
    out.push({
      kind: "figure", emoji: "🔥",
      headline: `Longest streak: ${bestDayStreak} days`,
      body: tl.dayStreak >= bestDayStreak
        ? "That's the one you're on right now. Nothing to beat but itself."
        : `You're on ${tl.dayStreak} now — ${bestDayStreak - tl.dayStreak} more to match your own record.`,
    });
  }
  if (avg30 > 0 && activeDays >= 7) {
    const projected = Math.round((avg30 / 100) * 365);
    out.push({
      kind: "figure", emoji: "📊",
      headline: `At this rate: ${projected} full days a year`,
      body: `Your 30-day average is ${avg30}. Held for a year, that's the equivalent of ${projected} completely delivered days out of 365.`,
    });
  }
  if (perfectDays >= 1) {
    out.push({
      kind: "figure", emoji: "⭐",
      headline: `${perfectDays} flawless day${perfectDays === 1 ? "" : "s"}`,
      body: `Days where nothing on the list was left behind${activeDays ? ` — ${Math.round((perfectDays / activeDays) * 100)}% of everything you've played` : ""}.`,
    });
  }
  const top = Object.entries(tl.byCategory).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 10) {
    const cat = CATEGORIES.find((c) => c.key === top[0]);
    if (cat) {
      out.push({
        kind: "figure", emoji: cat.emoji,
        headline: `${cat.label} is where you show up`,
        body: `${top[1]} completions — ${Math.round((top[1] / Math.max(1, completions)) * 100)}% of everything you've logged.`,
      });
    }
  }
  const doy = daysBetween(startOfYear(today), today) + 1;
  const left = daysBetween(today, endOfYear(today));
  out.push({
    kind: "figure", emoji: "🗓️",
    headline: `Day ${doy} of ${doy + left}`,
    body: `${left} day${left === 1 ? "" : "s"} left this year. At level ${level.level}, that's ${left} more chances to move the number.`,
  });
  return out;
}

/** The one card the Arena shows today — chosen for your current situation. */
export function factOfDay(s: GameState, tl: Timeline, today = todayKey()): Fact {
  const seed = `${s.settings.seed}|${today}`;
  if (tl.lossStreak >= 2) return pick(COMEBACK, seed);
  if (tl.dayStreak >= 7) return pick(STREAK_SAFE, seed);
  const personal = personalFacts(s, tl, today);
  const deck: Fact[] = [...MATH, ...LINES];
  // Every third day, lead with one of your own numbers instead of a maxim.
  if (personal.length && fromKey(today).getDate() % 3 === 0) return pick(personal, seed);
  return pick(deck, seed);
}

/** A short nudge for the top of the Arena, keyed to how the day is going. */
export function nudge(opts: {
  rival: string;
  score: number;
  ghost: number;
  dueLeft: number;
  sealed: boolean;
  outcome: "win" | "draw" | "loss" | "rest";
  streak: number;
}): string {
  const { rival, score, ghost, dueLeft, sealed, outcome, streak } = opts;
  if (sealed) {
    if (outcome === "win") return `Beat ${rival} ${score}–${ghost}. ${streak >= 2 ? `${streak}-day streak alive.` : "Banked."}`;
    if (outcome === "draw") return `Dead heat with ${rival} at ${score}. Nobody won today.`;
    if (outcome === "rest") return "Rest day — nothing was due, nothing was lost.";
    return `${rival} took it ${ghost}–${score}. Tomorrow's board is already open.`;
  }
  if (outcome === "rest") return "Nothing due today. Log anything you like — it all pays bonus XP.";
  const gap = ghost - score;
  if (dueLeft === 0 && score >= ghost) return `Everything done and ahead of ${rival}. Close it out.`;
  if (gap <= 0) return `You're ahead of ${rival} by ${score - ghost}. ${dueLeft ? `${dueLeft} left to lock it in.` : "Hold it."}`;
  if (gap <= 12) return `${gap} points behind ${rival}. One more target flips this.`;
  if (dueLeft <= 2) return `${gap} behind with ${dueLeft} target${dueLeft === 1 ? "" : "s"} left. It's going to be tight.`;
  return `${rival} is on ${ghost}. You need ${gap} more — ${dueLeft} target${dueLeft === 1 ? "" : "s"} still on the board.`;
}
