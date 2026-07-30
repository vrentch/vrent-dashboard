import { useState } from "react";
import Sheet from "../../components/Sheet";
import { addActivity, addWeight, setSteps, setWater, setSleep, useHealth, stepsOn, waterOn, sleepOn, todayKey } from "../../lib/health";
import { Footprints, Dumbbell, Scale, Droplets, Moon } from "lucide-react";

type Mode = "steps" | "workout" | "weight" | "water" | "sleep";

const MODES: { key: Mode; label: string; icon: typeof Footprints }[] = [
  { key: "steps", label: "Steps", icon: Footprints },
  { key: "workout", label: "Workout", icon: Dumbbell },
  { key: "weight", label: "Weight", icon: Scale },
  { key: "water", label: "Water", icon: Droplets },
  { key: "sleep", label: "Sleep", icon: Moon },
];
const WORKOUTS = ["Run", "Walk", "Gym", "Cycling", "Swim", "Yoga", "Football", "Tennis", "Other"];

export default function LogSheet({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Mode }) {
  const s = useHealth();
  const today = todayKey();
  const [mode, setMode] = useState<Mode>(initial || "steps");
  const [steps, setStepsV] = useState("");
  const [wLabel, setWLabel] = useState("Run");
  const [minutes, setMinutes] = useState("");
  const [burn, setBurn] = useState("");
  const [weight, setWeight] = useState("");
  const [water, setWaterV] = useState("");
  const [sleep, setSleepV] = useState("");

  function save() {
    if (mode === "steps") {
      const n = Number(steps) || 0;
      if (n > 0) setSteps(n);
    } else if (mode === "workout") {
      const m = Number(minutes) || 0;
      const c = Number(burn) || Math.round(m * 8);
      if (m > 0) addActivity({ kind: "workout", minutes: m, label: wLabel, calories: c });
    } else if (mode === "weight") {
      const kg = Number(weight) || 0;
      if (kg > 0) addWeight(kg);
    } else if (mode === "water") {
      const ml = Number(water) || 0;
      if (ml > 0) setWater(ml);
    } else if (mode === "sleep") {
      const h = Number(sleep) || 0;
      if (h > 0) setSleep(h);
    }
    setStepsV(""); setMinutes(""); setBurn(""); setWeight(""); setWaterV(""); setSleepV("");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log activity"
      footer={
        <button onClick={save} className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]">
          Save
        </button>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {MODES.map((m) => (
            <ModeBtn key={m.key} active={mode === m.key} icon={m.icon} label={m.label} onClick={() => setMode(m.key)} />
          ))}
        </div>

        {mode === "steps" && (
          <NumberField label={`Steps today${stepsOn(s, today) ? ` (now ${stepsOn(s, today).toLocaleString()})` : ""}`} value={steps} onChange={setStepsV} placeholder="e.g. 8000" suffix="steps" />
        )}

        {mode === "workout" && (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] text-slate-400 dark:text-slate-500">Type</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {WORKOUTS.map((w) => (
                  <button key={w} onClick={() => setWLabel(w)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${w === wLabel ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <NumberField label="Duration" value={minutes} onChange={setMinutes} placeholder="e.g. 30" suffix="min" />
            <NumberField label="Calories burned (optional)" value={burn} onChange={setBurn} placeholder="auto-estimated" suffix="kcal" />
          </div>
        )}

        {mode === "weight" && <NumberField label="Body weight" value={weight} onChange={setWeight} placeholder="e.g. 72" suffix="kg" />}
        {mode === "water" && (
          <div className="space-y-3">
            <NumberField label={`Water today${waterOn(s, today) ? ` (now ${waterOn(s, today)} ml)` : ""}`} value={water} onChange={setWaterV} placeholder="e.g. 2000" suffix="ml" />
            <div className="flex gap-2">
              {[250, 500, 750].map((v) => (
                <button key={v} onClick={() => setWaterV(String((Number(water) || 0) + v))} className="flex-1 py-2 rounded-xl glass-subtle text-xs font-semibold text-slate-600 dark:text-slate-300">+{v}ml</button>
              ))}
            </div>
          </div>
        )}
        {mode === "sleep" && <NumberField label={`Sleep last night${sleepOn(s, today) ? ` (now ${sleepOn(s, today)}h)` : ""}`} value={sleep} onChange={setSleepV} placeholder="e.g. 7.5" suffix="h" />}
      </div>
    </Sheet>
  );
}

function ModeBtn({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Footprints; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition ${active ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
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
