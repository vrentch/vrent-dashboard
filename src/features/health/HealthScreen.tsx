import { useMemo, useRef, useState } from "react";
import { Camera, Plus, SlidersHorizontal, Sparkles, Flame, RefreshCw, ChevronRight, Loader2, Footprints, Droplets, Moon, Scale, X, Heart, Pencil } from "lucide-react";
import {
  useHealth, macrosOn, macroTargets, calorieTarget, todayKey, foodsOn, activitiesOn, stepsOn, burnOn,
  waterOn, sleepOn, latestWeight, removeActivity, savePlan, recentSummary, toKey, type FoodEntry,
} from "../../lib/health";
import { analyzeImage, aiPlan, type FoodEstimate } from "../../lib/api";
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

  const openLog = (mode: typeof logMode) => { setLogMode(mode); setLogOpen(true); };

  const fileRef = useRef<HTMLInputElement>(null);
  const [foodOpen, setFoodOpen] = useState(false);
  const [foodLoading, setFoodLoading] = useState(false);
  const [foodErr, setFoodErr] = useState<string | null>(null);
  const [foodEstimate, setFoodEstimate] = useState<FoodEstimate | null>(null);
  const [foodPreview, setFoodPreview] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const eaten = macrosOn(s, today);
  const targets = macroTargets(s.profile);
  const target = calorieTarget(s.profile);
  const remaining = Math.max(0, target - eaten.calories);
  const pct = Math.min(1, target ? eaten.calories / target : 0);
  const steps = stepsOn(s, today);
  const burn = burnOn(s, today);
  const water = waterOn(s, today);
  const sleep = sleepOn(s, today);
  const weight = latestWeight(s);
  const meals = foodsOn(s, today);
  const acts = activitiesOn(s, today).filter((a) => a.kind === "workout");

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
      const res = await analyzeImage<FoodEstimate>("food", img.base64, img.mediaType);
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
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Health</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          </div>
          <button onClick={() => setProfileOpen(true)} className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Profile">
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </header>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {aiStatus === "off" && (
          <div className="rounded-2xl glass-subtle p-4">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Turn on AI for food scanning</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Add <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">ANTHROPIC_API_KEY</code> in Vercel to snap meals and get AI plans. Manual logging works without it.</p>
          </div>
        )}
        {aiStatus === "locked" && <AiUnlock onSubmit={unlock} compact />}

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
            <Macro label="Protein" val={Math.round(eaten.protein_g)} tgt={targets.protein_g} color="#3f3f46" />
            <Macro label="Carbs" val={Math.round(eaten.carbs_g)} tgt={targets.carbs_g} color="#71717a" />
            <Macro label="Fat" val={Math.round(eaten.fat_g)} tgt={targets.fat_g} color="#a1a1aa" />
          </div>
        </section>

        {/* Quick stats — tap to log/amend */}
        <div className="grid grid-cols-4 gap-2">
          <Stat icon={Footprints} label="Steps" value={steps ? steps.toLocaleString() : "—"} onClick={() => openLog("steps")} />
          <Stat icon={Droplets} label="Water" value={water ? `${(water / 1000).toFixed(1)}L` : "—"} onClick={() => openLog("water")} />
          <Stat icon={Moon} label="Sleep" value={sleep ? `${sleep}h` : "—"} onClick={() => openLog("sleep")} />
          <Stat icon={Scale} label="Weight" value={weight ? `${weight}kg` : "—"} onClick={() => openLog("weight")} />
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!aiReady}
            className="relative overflow-hidden rounded-2xl p-4 text-white text-left active:scale-[0.98] transition disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #27272a 0%, #09090b 100%)", boxShadow: "0 10px 30px rgba(0,0,0,0.28)" }}
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
            <button onClick={() => setPlanOpen(true)} className="w-full text-left rounded-2xl p-4 text-white active:scale-[0.99] transition" style={{ background: "linear-gradient(135deg, #27272a 0%, #09090b 100%)" }}>
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

        {/* Today's meals */}
        {meals.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Today's meals</h2>
            <div className="space-y-2">
              {meals.map((m) => (
                <button key={m.id} onClick={() => setEditMeal(m)} className="w-full flex items-center gap-3 rounded-2xl glass-subtle p-3 text-left active:scale-[0.99] transition">
                  <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-slate-500/15 text-slate-600 dark:text-slate-300 text-base">🍽️</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{m.name}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">P {m.protein_g} · C {m.carbs_g} · F {m.fat_g} g</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{m.calories}</span>
                  <Pencil size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}

        {acts.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Today's workouts</h2>
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
            <span className="text-xs text-slate-400 dark:text-slate-500">avg {weekAvg} kcal</span>
          </div>
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
    </div>
  );
}

function Stat({ icon: Icon, label, value, onClick }: { icon: typeof Footprints; label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl glass p-2.5 text-center active:scale-95 transition">
      <Icon size={16} className="mx-auto text-slate-500 dark:text-slate-400" />
      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const over = pct >= 1;
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-200/70 dark:stroke-slate-700" />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={over ? "stroke-rose-500" : "stroke-zinc-900 dark:stroke-zinc-100"} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, pct))} />
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
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
