import { useEffect, useMemo, useState } from "react";
import Sheet from "../../components/Sheet";
import {
  addActivity, addWeight, setSteps, setWater, setSleep, useHealth, stepsOn, waterOn, sleepOn,
  latestWeight, todayKey, ACTIVITIES, ACTIVITY_GROUPS, estimateBurn, activityEmoji,
} from "../../lib/health";
import { Footprints, Dumbbell, Scale, Droplets, Moon, Search, Check } from "lucide-react";

type Mode = "steps" | "workout" | "weight" | "water" | "sleep";

const MODES: { key: Mode; label: string; icon: typeof Footprints }[] = [
  { key: "steps", label: "Steps", icon: Footprints },
  { key: "workout", label: "Workout", icon: Dumbbell },
  { key: "weight", label: "Weight", icon: Scale },
  { key: "water", label: "Water", icon: Droplets },
  { key: "sleep", label: "Sleep", icon: Moon },
];
const QUICK_MINUTES = [15, 30, 45, 60, 90];

export default function LogSheet({
  open, onClose, initial, date,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Mode;
  /** Day being logged (YYYY-MM-DD) — defaults to today. */
  date?: string;
}) {
  const s = useHealth();
  const day = date || todayKey();
  const isToday = day === todayKey();
  const dayLabel = isToday ? "today" : new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

  const [mode, setMode] = useState<Mode>(initial || "steps");
  const [steps, setStepsV] = useState("");
  const [wLabel, setWLabel] = useState("Running");
  const [query, setQuery] = useState("");
  const [minutes, setMinutes] = useState("");
  const [burn, setBurn] = useState("");
  const [weight, setWeight] = useState("");
  const [water, setWaterV] = useState("");
  const [sleep, setSleepV] = useState("");

  // Reopen with the caller's mode and a clean slate for the chosen day.
  useEffect(() => {
    if (!open) return;
    if (initial) setMode(initial);
    setStepsV(""); setMinutes(""); setBurn(""); setWeight(""); setWaterV(""); setSleepV(""); setQuery("");
  }, [open, initial, day]);

  const bodyKg = latestWeight(s);
  const mins = Number(minutes) || 0;
  const autoBurn = mins > 0 ? estimateBurn(wLabel, mins, bodyKg) : 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ACTIVITIES.filter((a) => a.label.toLowerCase().includes(q)) : ACTIVITIES;
  }, [query]);

  function save() {
    if (mode === "steps") {
      const n = Number(steps) || 0;
      if (n > 0) setSteps(n, day);
    } else if (mode === "workout") {
      if (mins > 0) addActivity({ kind: "workout", minutes: mins, label: wLabel, calories: Number(burn) || autoBurn, date: day });
    } else if (mode === "weight") {
      const kg = Number(weight) || 0;
      if (kg > 0) addWeight(kg, day);
    } else if (mode === "water") {
      const ml = Number(water) || 0;
      if (ml > 0) setWater(ml, day);
    } else if (mode === "sleep") {
      const h = Number(sleep) || 0;
      if (h > 0) setSleep(h, day);
    }
    onClose();
  }

  const canSave =
    (mode === "steps" && Number(steps) > 0) ||
    (mode === "workout" && mins > 0) ||
    (mode === "weight" && Number(weight) > 0) ||
    (mode === "water" && Number(water) > 0) ||
    (mode === "sleep" && Number(sleep) > 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isToday ? "Log activity" : `Log · ${dayLabel}`}
      footer={
        <button
          onClick={save}
          disabled={!canSave}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold transition-transform duration-150 active:scale-[0.97] disabled:opacity-40"
        >
          <Check size={16} /> Save{isToday ? "" : ` to ${dayLabel}`}
        </button>
      }
    >
      <div className="space-y-5">
        {!isToday && (
          <p className="rounded-xl accent-gradient-soft text-brand-700 dark:text-brand-300 text-[12px] font-medium px-3 py-2">
            Adding to <b>{dayLabel}</b> — not today.
          </p>
        )}

        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {MODES.map((m) => (
            <ModeBtn key={m.key} active={mode === m.key} icon={m.icon} label={m.label} onClick={() => setMode(m.key)} />
          ))}
        </div>

        {mode === "steps" && (
          <NumberField label={`Steps ${dayLabel}${stepsOn(s, day) ? ` (now ${stepsOn(s, day).toLocaleString()})` : ""}`} value={steps} onChange={setStepsV} placeholder="e.g. 8000" suffix="steps" />
        )}

        {mode === "workout" && (
          <div className="space-y-4">
            {/* Activity picker — searchable, grouped, emoji-led */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 dark:text-slate-500">Activity</label>
                <span className="text-[12px] font-bold text-slate-900 dark:text-slate-100">{activityEmoji(wLabel)} {wLabel}</span>
              </div>
              <div className="mt-1.5 flex items-center rounded-xl glass-subtle px-3">
                <Search size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search — yoga, pilates, running…"
                  className="flex-1 min-w-0 bg-transparent px-2 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>
              <div className="mt-2.5 max-h-56 overflow-y-auto no-scrollbar space-y-3">
                {ACTIVITY_GROUPS.map((g) => {
                  const items = filtered.filter((a) => a.group === g);
                  if (!items.length) return null;
                  return (
                    <div key={g}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">{g}</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {items.map((a) => (
                          <button
                            key={a.label}
                            onClick={() => setWLabel(a.label)}
                            className={`flex items-center gap-1.5 px-2 py-2 rounded-xl text-[11.5px] font-semibold transition-transform duration-150 active:scale-[0.97] ${
                              a.label === wLabel
                                ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                                : "glass-subtle text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            <span className="text-[13px] leading-none">{a.emoji}</span>
                            <span className="truncate">{a.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 py-2">
                    No match — pick <b>Other</b> and name it in the list afterwards.
                  </p>
                )}
              </div>
            </div>

            <div>
              <NumberField label="Duration" value={minutes} onChange={setMinutes} placeholder="e.g. 30" suffix="min" />
              <div className="mt-2 flex gap-1.5">
                {QUICK_MINUTES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMinutes(String(m))}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-transform duration-150 active:scale-[0.97] ${
                      String(m) === minutes ? "accent-gradient text-white" : "glass-subtle text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <NumberField
              label={autoBurn > 0 ? `Calories burned (auto ≈ ${autoBurn} kcal)` : "Calories burned (optional)"}
              value={burn}
              onChange={setBurn}
              placeholder={autoBurn > 0 ? String(autoBurn) : "auto-estimated"}
              suffix="kcal"
            />
            {autoBurn > 0 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
                Estimated from {wLabel.toLowerCase()} at {bodyKg ? `${bodyKg} kg` : "an average build"} — type your own figure to override.
              </p>
            )}
          </div>
        )}

        {mode === "weight" && <NumberField label={`Body weight ${dayLabel}`} value={weight} onChange={setWeight} placeholder="e.g. 72" suffix="kg" />}

        {mode === "water" && (
          <div className="space-y-3">
            <NumberField label={`Water ${dayLabel}${waterOn(s, day) ? ` (now ${waterOn(s, day)} ml)` : ""}`} value={water} onChange={setWaterV} placeholder="e.g. 2000" suffix="ml" />
            <div className="flex gap-2">
              {[250, 500, 750].map((v) => (
                <button
                  key={v}
                  onClick={() => setWaterV(String((Number(water) || 0) + v))}
                  className="flex-1 py-2 rounded-xl glass-subtle text-xs font-semibold text-slate-600 dark:text-slate-300 transition-transform duration-150 active:scale-[0.97]"
                >
                  +{v}ml
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === "sleep" && <NumberField label={`Sleep${isToday ? " last night" : ` on ${dayLabel}`}${sleepOn(s, day) ? ` (now ${sleepOn(s, day)}h)` : ""}`} value={sleep} onChange={setSleepV} placeholder="e.g. 7.5" suffix="h" />}
      </div>
    </Sheet>
  );
}

function ModeBtn({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Footprints; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl transition-transform duration-150 active:scale-[0.97] ${
        active ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"
      }`}
    >
      <Icon size={18} />
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}

function NumberField({ label, value, onChange, placeholder, suffix }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; suffix: string }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 dark:text-slate-500">{label}</label>
      <div className="mt-1 flex items-center rounded-xl glass-subtle px-3">
        <input type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1 min-w-0 bg-transparent py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{suffix}</span>
      </div>
    </div>
  );
}
