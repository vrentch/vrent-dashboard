import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, SlidersHorizontal, Sparkles, Flame, RefreshCw, ChevronRight, Loader2, Footprints, Droplets, Moon, Scale, X, Heart, Pencil, Timer, Utensils } from "lucide-react";
import {
  useHealth, macrosOn, macroTargets, calorieTarget, todayKey, foodsOn, activitiesOn, stepsOn, burnOn,
  waterOn, sleepOn, latestWeight, removeActivity, removeFood, savePlan, saveCoach, recentSummary, toKey, weeklyStats, foodHints,
  fastingStatus, markLastMeal, markFirstMeal, mealTypeOf, mealBreakdown, MEAL_META, type FoodEntry, type MealType,
} from "../../lib/health";
import SwipeRow from "../../components/SwipeRow";
import { analyzeImage, aiPlan, aiCoach, type FoodEstimate } from "../../lib/api";
import { prepareImage } from "../../lib/image";
import { useAiAccess } from "../../lib/aiAccess";
import AiUnlock from "../ai/AiUnlock";
import ProfileSheet from "./ProfileSheet";
import LogSheet from "./LogSheet";
import FoodConfirmSheet from "./FoodConfirmSheet";
import MealEditSheet from "./MealEditSheet";
import QuickAddFoods from "./QuickAddFoods";
import PlanSheet from "./PlanSheet";
import AppleHealthSheet from "./AppleHealthSheet";
import FastingSheet from "./FastingSheet";

const MEAL_COLORS: Record<MealType, string> = { breakfast: "#f59e0b", lunch: "#14b8a6", snack: "#8b5cf6", dinner: "#6366f1" };

function fmtDur(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function HealthScreen() {
  const s = useHealth();
  const today = todayKey();
  const { status: aiStatus, unlock } = useAiAccess();
  const aiReady = aiStatus === "ready";

  const [profileOpen, setProfileOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logMode, setLogMode] = useState<"steps" | "workout" | "weight" | "water" | "sleep">("steps");
  const [planOpen, setPlanOpen] = useState(false);
  const [editMeal, setEditMeal] = useState<FoodEntry | null>(null);
  const [appleOpen, setAppleOpen] = useState(false);
  const [fastOpen, setFastOpen] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;

  // Live clock for the fasting timer (30 s granularity is plenty).
  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    if (!s.fasting.enabled) return;
    const t = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [s.fasting.enabled]);
  const fast = fastingStatus(s, nowTs);

  const openLog = (mode: typeof logMode) => { setLogMode(mode); setLogOpen(true); };

  const fileRef = useRef<HTMLInputElement>(null);
  const [foodOpen, setFoodOpen] = useState(false);
  const [foodLoading, setFoodLoading] = useState(false);
  const [foodErr, setFoodErr] = useState<string | null>(null);
  const [foodEstimate, setFoodEstimate] = useState<FoodEstimate | null>(null);
  const [foodPreview, setFoodPreview] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const eaten = macrosOn(s, viewDate);
  const targets = macroTargets(s.profile);
  const target = calorieTarget(s.profile);
  const remaining = Math.max(0, target - eaten.calories);
  const pct = Math.min(1, target ? eaten.calories / target : 0);
  const steps = stepsOn(s, viewDate);
  const burn = burnOn(s, viewDate);
  const water = waterOn(s, viewDate);
  const sleep = sleepOn(s, viewDate);
  const weight = s.weights.find((w) => w.date === viewDate)?.kg ?? latestWeight(s);
  const meals = foodsOn(s, viewDate);
  const acts = activitiesOn(s, viewDate).filter((a) => a.kind === "workout");
  const wk = useMemo(() => weeklyStats(s), [s]);
  const weekMeals = useMemo(() => mealBreakdown(s, 7), [s]);

  // The day's meals grouped into breakfast / lunch / snacks / dinner.
  const mealGroups = useMemo(() => {
    const g: Record<MealType, FoodEntry[]> = { breakfast: [], lunch: [], snack: [], dinner: [] };
    for (const m of meals) g[mealTypeOf(m)].push(m);
    return (Object.keys(MEAL_META) as MealType[])
      .sort((a, b) => MEAL_META[a].order - MEAL_META[b].order)
      .map((type) => ({ type, items: g[type], kcal: Math.round(g[type].reduce((n, x) => n + (x.calories || 0), 0)) }))
      .filter((x) => x.items.length > 0);
  }, [meals]);

  async function getCoaching() {
    setCoachLoading(true);
    try {
      const res = await aiCoach({
        profile: s.profile,
        targets,
        today: { ...eaten, remaining, steps, burn, waterMl: water, sleepH: sleep },
        fasting: s.fasting.enabled
          ? { protocol: `${s.fasting.fastingHours}:${24 - s.fasting.fastingHours}`, phase: fast.phase, hoursInPhase: +(fast.sinceMs / 3600_000).toFixed(1) }
          : null,
        mealPattern: weekMeals.map((m) => ({ meal: m.type, sharePct: Math.round(m.share * 100) })),
        planHeadline: s.plan?.headline || null,
        localTime: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      });
      if (res.ok && res.data) saveCoach(res.data);
    } catch { /* ignore */ } finally {
      setCoachLoading(false);
    }
  }

  // Last 14 days for the day picker (today first).
  const dayStrip = useMemo(() => {
    const arr: { key: string; dow: string; day: number; has: boolean }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = toKey(d);
      arr.push({
        key: k,
        dow: d.toLocaleDateString(undefined, { weekday: "short" }),
        day: d.getDate(),
        has: macrosOn(s, k).calories > 0 || stepsOn(s, k) > 0 || waterOn(s, k) > 0 || sleepOn(s, k) > 0,
      });
    }
    return arr;
  }, [s]);
  const viewLabel = isToday ? "Today" : new Date(viewDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const week = useMemo(() => {
    const arr: { key: string; label: string; cal: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = toKey(d);
      arr.push({ key: k, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), cal: Math.round(macrosOn(s, k).calories) });
    }
    return arr;
  }, [s]);
  const weekMax = Math.max(target, ...week.map((w) => w.cal), 1);
  const weekAvg = Math.round(week.reduce((a, b) => a + b.cal, 0) / 7);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFoodErr(null);
    setFoodEstimate(null);
    setFoodOpen(true);
    setFoodLoading(true);
    try {
      const img = await prepareImage(file);
      setFoodPreview(img.dataUrl);
      const res = await analyzeImage<FoodEstimate>("food", img.base64, img.mediaType, foodHints());
      if (!res.ok || !res.data) setFoodErr(res.configured === false ? "AI isn't set up yet." : res.error || "Couldn't analyze that photo.");
      else setFoodEstimate(res.data);
    } catch (err) {
      setFoodErr(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setFoodLoading(false);
    }
  }

  async function generatePlan() {
    setPlanLoading(true);
    try {
      const res = await aiPlan(s.profile, recentSummary(s));
      if (res.ok && res.data) {
        savePlan(res.data);
        setPlanOpen(true);
      }
    } catch {
      /* ignore */
    } finally {
      setPlanLoading(false);
    }
  }

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Health</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">{viewLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isToday && (
              <button onClick={() => setViewDate(today)} className="h-9 px-3 rounded-full glass text-xs font-semibold text-brand-600 dark:text-brand-400 active:scale-95">Today</button>
            )}
            <button onClick={() => setProfileOpen(true)} className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Profile">
              <SlidersHorizontal size={18} />
            </button>
          </div>
        </div>
      </header>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-4 space-y-6">
        {/* Day picker — review any of the last 14 days */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
          {dayStrip.map((d) => {
            const sel = d.key === viewDate;
            return (
              <button
                key={d.key}
                onClick={() => setViewDate(d.key)}
                className={`shrink-0 w-11 py-1.5 rounded-2xl flex flex-col items-center gap-0.5 transition ${sel ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}
              >
                <span className="text-[10px] font-medium opacity-70">{d.dow}</span>
                <span className="text-sm font-bold tabular-nums">{d.day}</span>
                <span className={`w-1 h-1 rounded-full ${d.has ? (sel ? "bg-white/80 dark:bg-slate-900/80" : "bg-emerald-500") : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>

        {isToday && aiStatus === "off" && (
          <div className="rounded-2xl glass-subtle p-4">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Turn on AI for food scanning</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Add <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">ANTHROPIC_API_KEY</code> in Vercel to snap meals and get AI plans. Manual logging works without it.</p>
          </div>
        )}
        {isToday && aiStatus === "locked" && <AiUnlock onSubmit={unlock} compact />}

        {/* Today ring */}
        <section className="rounded-3xl glass p-5">
          <div className="flex items-center gap-5">
            <Ring pct={pct} />
            <div className="flex-1">
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-none">{Math.round(eaten.calories)}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">of {target} kcal · {remaining} left</p>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"><Footprints size={13} /> {steps.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"><Flame size={13} className="text-slate-400 dark:text-slate-500" /> {burn} kcal</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Macro label="Protein" val={Math.round(eaten.protein_g)} tgt={targets.protein_g} color="#6366f1" />
            <Macro label="Carbs" val={Math.round(eaten.carbs_g)} tgt={targets.carbs_g} color="#14b8a6" />
            <Macro label="Fat" val={Math.round(eaten.fat_g)} tgt={targets.fat_g} color="#f59e0b" />
          </div>
        </section>

        {/* Quick stats — tap to log/amend */}
        <div className="grid grid-cols-4 gap-2">
          <Stat icon={Footprints} label="Steps" value={steps ? steps.toLocaleString() : "—"} onClick={isToday ? () => openLog("steps") : undefined} />
          <Stat icon={Droplets} label="Water" value={water ? `${(water / 1000).toFixed(1)}L` : "—"} onClick={isToday ? () => openLog("water") : undefined} />
          <Stat icon={Moon} label="Sleep" value={sleep ? `${sleep}h` : "—"} onClick={isToday ? () => openLog("sleep") : undefined} />
          <Stat icon={Scale} label="Weight" value={weight ? `${weight}kg` : "—"} onClick={isToday ? () => openLog("weight") : undefined} />
        </div>

        {isToday && (<>
        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!aiReady}
            className="relative overflow-hidden rounded-2xl p-4 text-white text-left active:scale-[0.98] transition disabled:opacity-60"
            style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)", boxShadow: "0 10px 30px rgba(0,0,0,0.28)" }}
          >
            <Camera size={22} />
            <p className="mt-2 text-sm font-bold">Snap a meal</p>
            <p className="text-[11px] text-white/80">{aiReady ? "AI counts the calories" : aiStatus === "locked" ? "Unlock AI above" : "Needs AI setup"}</p>
          </button>
          <button onClick={() => openLog("steps")} className="rounded-2xl glass p-4 text-left active:scale-[0.98] transition">
            <Plus size={22} className="text-slate-700 dark:text-slate-200" />
            <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">Log activity</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Steps · workout · water · sleep</p>
          </button>
        </div>

        {/* One-tap common foods & drinks */}
        <QuickAddFoods />

        {/* Intermittent fasting */}
        {s.fasting.enabled ? (
          <section className="rounded-3xl glass p-4">
            <button onClick={() => setFastOpen(true)} className="w-full text-left">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Fasting {s.fasting.fastingHours}:{24 - s.fasting.fastingHours}
                </p>
                <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
              </div>
              {fast.phase === "idle" ? (
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Tap First meal or Last meal below to start the schedule.</p>
              ) : fast.phase === "fasting" ? (
                <>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmtDur(fast.remainMs)} <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">until you can eat</span></p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Eating opens at {fmtClock(fast.phaseEnd)} · fasting for {fmtDur(fast.sinceMs)}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">Eating window open 🎉</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">Fasting starts again at {fmtClock(fast.phaseEnd)} ({fmtDur(fast.remainMs)} left)</p>
                </>
              )}
              {fast.phase !== "idle" && (
                <div className="mt-2.5 h-2 rounded-full bg-slate-200/70 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${Math.round(fast.pct * 100)}%`, background: fast.phase === "fasting" ? "linear-gradient(90deg,#818cf8,#4f46e5)" : "linear-gradient(90deg,#34d399,#059669)" }}
                  />
                </div>
              )}
            </button>
            {/* First/Last meal — the one that matches the current phase is highlighted */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => { markFirstMeal(); setNowTs(Date.now()); }}
                className={`py-2.5 rounded-xl text-xs font-bold active:scale-[0.97] transition ${fast.phase !== "eating" ? "accent-gradient text-white shadow-accent" : "glass-subtle text-slate-500 dark:text-slate-400"}`}
              >
                🍳 First meal — start eating
              </button>
              <button
                onClick={() => { markLastMeal(); setNowTs(Date.now()); }}
                className={`py-2.5 rounded-xl text-xs font-bold active:scale-[0.97] transition ${fast.phase === "eating" ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-500 dark:text-slate-400"}`}
              >
                🍽️ Last meal — start fasting
              </button>
            </div>
          </section>
        ) : (
          <button onClick={() => setFastOpen(true)} className="w-full flex items-center gap-3 rounded-2xl glass p-3.5 text-left active:scale-[0.99] transition">
            <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300"><Timer size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Intermittent fasting</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">16:8 & friends — timer until your next meal</p>
            </div>
            <ChevronRight size={16} className="text-slate-300 dark:text-slate-600" />
          </button>
        )}

        {/* AI coach — advice for the rest of the day */}
        {aiReady && (
          <section className="rounded-3xl p-4 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70 inline-flex items-center gap-1.5"><Sparkles size={12} /> Today's coaching</p>
              {s.coach?.date === today && (
                <button onClick={getCoaching} disabled={coachLoading} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/80 disabled:opacity-50">
                  <RefreshCw size={11} className={coachLoading ? "animate-spin" : ""} /> Refresh
                </button>
              )}
            </div>
            {s.coach?.date === today ? (
              <>
                <p className="mt-1.5 text-sm font-bold">{s.coach.data.headline}</p>
                <p className="mt-1 text-[12.5px] text-white/85 leading-relaxed">{s.coach.data.advice}</p>
                {s.coach.data.nextMeal && (
                  <p className="mt-2 text-[12px] text-white/85 rounded-xl bg-white/10 px-3 py-2 inline-flex items-start gap-1.5"><Utensils size={12} className="mt-0.5 shrink-0" /> {s.coach.data.nextMeal}</p>
                )}
              </>
            ) : (
              <button onClick={getCoaching} disabled={coachLoading} className="mt-2 w-full py-2.5 rounded-xl bg-white/15 text-sm font-semibold active:scale-[0.98] disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {coachLoading ? <><Loader2 size={14} className="animate-spin" /> Reading your day…</> : "What should I do for the rest of today?"}
              </button>
            )}
          </section>
        )}

        {/* Apple Health */}
        <button onClick={() => setAppleOpen(true)} className="w-full flex items-center gap-3 rounded-2xl glass p-3.5 text-left active:scale-[0.99] transition">
          <span className="grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-rose-500/15 text-rose-500"><Heart size={18} fill="currentColor" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Connect Apple Health</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Sync steps, weight & sleep via a Shortcut</p>
          </div>
          <ChevronRight size={16} className="text-slate-300 dark:text-slate-600" />
        </button>

        {/* AI plan */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Your plan</h2>
            {s.plan && (
              <button onClick={generatePlan} disabled={planLoading} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 disabled:opacity-50">
                <RefreshCw size={13} className={planLoading ? "animate-spin" : ""} /> Refresh
              </button>
            )}
          </div>
          {s.plan ? (
            <button onClick={() => setPlanOpen(true)} className="w-full text-left rounded-2xl p-4 text-white active:scale-[0.99] transition" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{s.plan.headline}</p>
                <ChevronRight size={16} className="text-white/70" />
              </div>
              <p className="text-xs text-white/85 mt-1 line-clamp-2">{s.plan.today || s.plan.summary}</p>
            </button>
          ) : (
            <button onClick={generatePlan} disabled={planLoading || !aiReady} className="w-full inline-flex items-center justify-center gap-2 py-4 rounded-2xl glass text-sm font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.98] disabled:opacity-50">
              {planLoading ? <><Loader2 size={16} className="animate-spin" /> Building your plan…</> : <><Sparkles size={16} className="text-brand-500" /> Generate my plan</>}
            </button>
          )}
        </section>
        </>)}

        {/* Meals for the selected day, grouped by breakfast / lunch / snacks / dinner */}
        {mealGroups.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{isToday ? "Today's meals" : "Meals"}</h2>
            <div className="space-y-4">
              {mealGroups.map((g) => (
                <div key={g.type}>
                  <div className="flex items-baseline justify-between mb-1.5 px-0.5">
                    <p className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{MEAL_META[g.type].emoji} {MEAL_META[g.type].label}</p>
                    <p className="text-[11px] font-semibold tabular-nums" style={{ color: MEAL_COLORS[g.type] }}>{g.kcal} kcal</p>
                  </div>
                  <div className="space-y-2">
                    {g.items.map((m) => (
                      <SwipeRow key={m.id} onDelete={() => removeFood(m.id)}>
                        <button onClick={() => setEditMeal(m)} className="w-full flex items-center gap-3 glass-subtle p-3 text-left active:scale-[0.99] transition">
                          <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl text-base" style={{ backgroundColor: `${MEAL_COLORS[g.type]}22` }}>{MEAL_META[g.type].emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{m.name}</p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(m.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · P {m.protein_g} · C {m.carbs_g} · F {m.fat_g} g</p>
                          </div>
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{m.calories}</span>
                          <Pencil size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                        </button>
                      </SwipeRow>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {acts.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{isToday ? "Today's workouts" : "Workouts"}</h2>
            <div className="flex flex-wrap gap-2">
              {acts.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Flame size={12} className="text-slate-400 dark:text-slate-500" /> {a.label}{a.minutes ? ` · ${a.minutes}m` : ""}
                  <button onClick={() => removeActivity(a.id)} className="grid place-items-center w-5 h-5 rounded-full text-slate-400 active:text-rose-500 active:bg-rose-500/10" aria-label="Remove">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Weekly stats */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">This week</h2>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              avg {weekAvg} kcal{wk.weightChange != null ? ` · ${wk.weightChange > 0 ? "+" : ""}${wk.weightChange}kg` : ""}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2.5">
            <WStat label="Avg kcal" value={wk.avgCalories ? wk.avgCalories.toLocaleString() : "—"} />
            <WStat label="Avg steps" value={wk.avgSteps ? wk.avgSteps.toLocaleString() : "—"} />
            <WStat label="Workouts" value={String(wk.workouts)} />
            <WStat label="Avg sleep" value={wk.avgSleep ? `${wk.avgSleep}h` : "—"} />
            <WStat label="Avg water" value={wk.avgWaterMl ? `${(wk.avgWaterMl / 1000).toFixed(1)}L` : "—"} />
            <WStat label="On target" value={wk.loggedDays ? `${wk.onTargetDays}/${wk.loggedDays}` : "—"} />
          </div>
          {/* When you eat — calorie share by meal across the week */}
          {weekMeals.some((m) => m.calories > 0) && (
            <div className="rounded-2xl glass p-4 mb-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2.5">When you eat</p>
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-200/70 dark:bg-slate-700">
                {weekMeals.filter((m) => m.share > 0).map((m) => (
                  <div key={m.type} style={{ width: `${Math.max(2, m.share * 100)}%`, backgroundColor: MEAL_COLORS[m.type] }} />
                ))}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {weekMeals.filter((m) => m.calories > 0).map((m) => (
                  <div key={m.type} className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: MEAL_COLORS[m.type] }} />
                    <span className="text-slate-600 dark:text-slate-300 font-medium">{MEAL_META[m.type].emoji} {MEAL_META[m.type].label}</span>
                    <span className="ml-auto text-slate-400 dark:text-slate-500 tabular-nums">{Math.round(m.share * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-2xl glass p-4">
            <div className="flex items-end justify-between gap-2 h-28">
              {week.map((w) => {
                const h = Math.round((w.cal / weekMax) * 100);
                const over = w.cal > target;
                return (
                  <div key={w.key} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                    <div className="w-full rounded-lg" style={{ height: `${Math.max(4, h)}%`, background: w.cal === 0 ? "rgba(148,163,184,0.25)" : over ? "linear-gradient(180deg,#f43f5e,#e11d48)" : "linear-gradient(180deg,#34d399,#059669)" }} />
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{w.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} initial={logMode} />
      <PlanSheet open={planOpen} onClose={() => setPlanOpen(false)} plan={s.plan} />
      <FoodConfirmSheet open={foodOpen} onClose={() => setFoodOpen(false)} loading={foodLoading} error={foodErr} estimate={foodEstimate} preview={foodPreview} />
      <MealEditSheet open={!!editMeal} onClose={() => setEditMeal(null)} entry={editMeal} />
      <AppleHealthSheet open={appleOpen} onClose={() => setAppleOpen(false)} />
      <FastingSheet open={fastOpen} onClose={() => setFastOpen(false)} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, onClick }: { icon: typeof Footprints; label: string; value: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-2xl glass p-2.5 text-center active:scale-95 transition disabled:active:scale-100">
      <Icon size={16} className="mx-auto text-slate-500 dark:text-slate-400" />
      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
    </button>
  );
}

function WStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl glass p-2.5 text-center">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const over = pct >= 1;
  // Animate the arc from empty → target on mount and whenever the value changes.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(Math.min(1, pct)), 60);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="1" stopColor="#4f46e5" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-200/70 dark:stroke-slate-700" />
        <circle
          cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke={over ? "#f43f5e" : "url(#ring-grad)"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
    </div>
  );
}

function Macro({ label, val, tgt, color }: { label: string; val: number; tgt: number; color: string }) {
  const pct = Math.min(1, tgt ? val / tgt : 0);
  return (
    <div className="rounded-xl glass-subtle p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400 dark:text-slate-500">{label}</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{val}/{tgt}g</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
