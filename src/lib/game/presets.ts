import { type TargetDraft, todayKey } from "./store";

// Starter packs. A blank board is the fastest way to abandon a game like this,
// so the first run offers ready-made targets you can take as-is and then bend.

export interface Pack {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  targets: TargetDraft[];
}

function t(p: Partial<TargetDraft> & { title: string }): TargetDraft {
  return {
    title: p.title,
    emoji: p.emoji || "🎯",
    category: p.category || "business",
    measure: p.measure || "check",
    unit: p.unit || "",
    goal: p.goal ?? 1,
    direction: p.direction || "atLeast",
    priority: p.priority || "normal",
    cadence: p.cadence || { kind: "daily" },
    horizon: p.horizon || "day",
    campaignGoal: p.campaignGoal,
    startDate: p.startDate || todayKey(),
    endDate: p.endDate,
    renewal: p.renewal || "none",
    note: p.note,
  };
}

export const PACKS: Pack[] = [
  {
    key: "business",
    label: "Business builder",
    emoji: "💼",
    blurb: "The handful of daily moves that actually grow a company.",
    targets: [
      t({ title: "Reach out to new leads", emoji: "📞", category: "business", measure: "number", unit: "contacts", goal: 3, priority: "high", cadence: { kind: "weekdays" } }),
      t({ title: "Ship one improvement", emoji: "🚀", category: "business", priority: "must", cadence: { kind: "weekdays" } }),
      t({ title: "Inbox to zero", emoji: "📥", category: "business", priority: "normal", cadence: { kind: "weekdays" } }),
      t({
        title: "Review the numbers", emoji: "📊", category: "business", priority: "high",
        cadence: { kind: "timesPerWeek", times: 1 }, horizon: "week",
      }),
    ],
  },
  {
    key: "body",
    label: "Body",
    emoji: "💪",
    blurb: "Train, move, sleep. The base everything else runs on.",
    targets: [
      t({ title: "Train", emoji: "🏋️", category: "body", measure: "number", unit: "min", goal: 30, priority: "high", cadence: { kind: "timesPerWeek", times: 4 }, horizon: "month", campaignGoal: 600 }),
      t({ title: "Steps", emoji: "🚶", category: "body", measure: "number", unit: "steps", goal: 8000, priority: "normal", cadence: { kind: "daily" } }),
      t({ title: "Sleep", emoji: "😴", category: "body", measure: "number", unit: "h", goal: 7, priority: "high", cadence: { kind: "daily" } }),
      t({ title: "No alcohol", emoji: "🚫", category: "body", measure: "number", unit: "drinks", goal: 0, direction: "atMost", priority: "normal", cadence: { kind: "weekdays" } }),
    ],
  },
  {
    key: "mind",
    label: "Mind & craft",
    emoji: "🧠",
    blurb: "Deep work, reading, and making something that didn't exist.",
    targets: [
      t({ title: "Deep work, no phone", emoji: "🎧", category: "mind", measure: "number", unit: "min", goal: 90, priority: "must", cadence: { kind: "weekdays" } }),
      t({ title: "Read", emoji: "📖", category: "mind", measure: "number", unit: "pages", goal: 20, priority: "normal", cadence: { kind: "daily" }, horizon: "month", campaignGoal: 500 }),
      t({ title: "Build something creative", emoji: "🎨", category: "craft", priority: "high", cadence: { kind: "timesPerWeek", times: 3 } }),
      t({ title: "No scrolling after 22:00", emoji: "🌙", category: "mind", priority: "normal", cadence: { kind: "daily" } }),
    ],
  },
  {
    key: "money",
    label: "Money & people",
    emoji: "💰",
    blurb: "Spend with intent, and keep the relationships warm.",
    targets: [
      t({ title: "Stayed inside the daily budget", emoji: "🧾", category: "money", priority: "high", cadence: { kind: "daily" } }),
      t({ title: "Log every expense", emoji: "✏️", category: "money", priority: "normal", cadence: { kind: "daily" } }),
      t({ title: "One real conversation", emoji: "🤝", category: "people", priority: "normal", cadence: { kind: "daily" } }),
      t({ title: "Family time, phone away", emoji: "❤️", category: "people", measure: "number", unit: "min", goal: 60, priority: "high", cadence: { kind: "daily" } }),
    ],
  },
];

/** A sensible five-target board for anyone who just wants to start. */
export const QUICK_START: TargetDraft[] = [
  PACKS[0].targets[1], // ship one improvement
  PACKS[0].targets[0], // reach out to leads
  PACKS[1].targets[0], // train
  PACKS[2].targets[0], // deep work
  PACKS[2].targets[1], // read
];
