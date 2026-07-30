import {
  type HealthState,
  todayKey,
  stepsOn,
  waterOn,
  sleepOn,
  burnOn,
  macrosOn,
  calorieTarget,
  macroTargets,
  latestWeight,
  recentSummary,
} from "./health";

export type Slot = "morning" | "lunch" | "evening";

export function currentSlot(): Slot {
  const h = new Date().getHours();
  if (h < 11) return "morning";
  if (h < 17) return "lunch";
  return "evening";
}

export function slotLabel(slot: Slot): string {
  return slot === "morning" ? "Morning" : slot === "lunch" ? "Midday" : "Evening";
}

export function greeting(slot: Slot): string {
  return slot === "morning" ? "Good morning" : slot === "lunch" ? "Good afternoon" : "Good evening";
}

export interface Achievement {
  emoji: string;
  text: string;
  tone: "good" | "neutral";
}

const STEP_GOAL = 8000;
const WATER_GOAL = 2000;

// Instant, free achievements computed from the local log (no AI).
export function achievements(s: HealthState): Achievement[] {
  const d = todayKey();
  const steps = stepsOn(s, d);
  const water = waterOn(s, d);
  const sleep = sleepOn(s, d);
  const burn = burnOn(s, d);
  const macros = macrosOn(s, d);
  const target = calorieTarget(s.profile);
  const mt = macroTargets(s.profile);
  const out: Achievement[] = [];

  if (steps > 0) {
    const hit = steps >= STEP_GOAL;
    out.push({ emoji: hit ? "🔥" : "👟", tone: hit ? "good" : "neutral", text: hit ? `${steps.toLocaleString()} steps — goal smashed!` : `${steps.toLocaleString()} steps · ${(STEP_GOAL - steps).toLocaleString()} to goal` });
  }
  if (macros.calories > 0 && target > 0) {
    const diff = target - macros.calories;
    out.push({ emoji: "🍽️", tone: diff >= 0 ? "good" : "neutral", text: diff >= 0 ? `${Math.round(macros.calories)} / ${target} kcal · ${Math.round(diff)} left` : `${Math.round(macros.calories)} / ${target} kcal · ${Math.abs(Math.round(diff))} over` });
  }
  if (macros.protein_g > 0 && mt.protein_g > 0) {
    const hit = macros.protein_g >= mt.protein_g;
    out.push({ emoji: "💪", tone: hit ? "good" : "neutral", text: `${Math.round(macros.protein_g)}g protein${hit ? " — target met" : ` / ${mt.protein_g}g`}` });
  }
  if (water > 0) {
    const hit = water >= WATER_GOAL;
    out.push({ emoji: "💧", tone: hit ? "good" : "neutral", text: `${(water / 1000).toFixed(1)}L water${hit ? " — hydrated!" : ""}` });
  }
  if (sleep > 0) {
    const good = sleep >= 7;
    out.push({ emoji: "😴", tone: good ? "good" : "neutral", text: `${sleep}h sleep${good ? " — well rested" : ""}` });
  }
  if (burn > 0) out.push({ emoji: "⚡", tone: "good", text: `${Math.round(burn)} kcal active burn` });

  return out;
}

// Compact snapshot the server uses for the AI recommendation.
export function healthContext(s: HealthState) {
  const d = todayKey();
  const macros = macrosOn(s, d);
  return {
    today: {
      steps: stepsOn(s, d),
      stepGoal: STEP_GOAL,
      calories: Math.round(macros.calories),
      calorieTarget: calorieTarget(s.profile),
      protein_g: Math.round(macros.protein_g),
      proteinTarget: macroTargets(s.profile).protein_g,
      waterMl: waterOn(s, d),
      sleepH: sleepOn(s, d),
      activeBurn: burnOn(s, d),
    },
    goal: s.profile.goal,
    weightKg: latestWeight(s),
    recent: recentSummary(s, 7).days,
  };
}

// Does the log have anything worth advising on yet?
export function hasHealthData(s: HealthState): boolean {
  const d = todayKey();
  return stepsOn(s, d) > 0 || waterOn(s, d) > 0 || sleepOn(s, d) > 0 || macrosOn(s, d).calories > 0 || s.weights.length > 0;
}
