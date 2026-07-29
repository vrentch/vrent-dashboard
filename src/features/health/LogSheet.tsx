import { useState } from "react";
import Sheet from "../../components/Sheet";
import { addActivity, addWeight } from "../../lib/health";
import { Footprints, Dumbbell, Scale } from "lucide-react";

type Mode = "steps" | "workout" | "weight";

const WORKOUTS = ["Run", "Walk", "Gym", "Cycling", "Swim", "Yoga", "Football", "Tennis", "Other"];

export default function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("steps");
  const [steps, setSteps] = useState("");
  const [wLabel, setWLabel] = useState("Run");
  const [minutes, setMinutes] = useState("");
  const [burn, setBurn] = useState("");
  const [weight, setWeight] = useState("");

  function save() {
    if (mode === "steps") {
      const n = Number(steps) || 0;
      if (n > 0) addActivity({ kind: "steps", steps: n, calories: Math.round(n * 0.04) });
    } else if (mode === "workout") {
      const m = Number(minutes) || 0;
      const c = Number(burn) || Math.round(m * 8);
      if (m > 0) addActivity({ kind: "workout", minutes: m, label: wLabel, calories: c });
    } else {
      const kg = Number(weight) || 0;
      if (kg > 0) addWeight(kg);
    }
    setSteps(""); setMinutes(""); setBurn(""); setWeight("");
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
        <div className="grid grid-cols-3 gap-2">
          <ModeBtn active={mode === "steps"} icon={Footprints} label="Steps" onClick={() => setMode("steps")} />
          <ModeBtn active={mode === "workout"} icon={Dumbbell} label="Workout" onClick={() => setMode("workout")} />
          <ModeBtn active={mode === "weight"} icon={Scale} label="Weight" onClick={() => setMode("weight")} />
        </div>

        {mode === "steps" && (
          <NumberField label="Steps today" value={steps} onChange={setSteps} placeholder="e.g. 8000" suffix="steps" />
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

        {mode === "weight" && (
          <NumberField label="Body weight" value={weight} onChange={setWeight} placeholder="e.g. 72" suffix="kg" />
        )}
      </div>
    </Sheet>
  );
}

function ModeBtn({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Footprints; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition ${active ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
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
        <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1 min-w-0 bg-transparent py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{suffix}</span>
      </div>
    </div>
  );
}
