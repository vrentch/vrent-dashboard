import { useState } from "react";
import Sheet from "../../components/Sheet";
import { useHealth, setProfile, calorieTarget, type Goal, type Activity } from "../../lib/health";

const GOALS: { key: Goal; label: string; emoji: string }[] = [
  { key: "lose", label: "Lose", emoji: "📉" },
  { key: "maintain", label: "Maintain", emoji: "⚖️" },
  { key: "gain", label: "Gain", emoji: "📈" },
];
const ACTIVITIES: { key: Activity; label: string }[] = [
  { key: "sedentary", label: "Sedentary" },
  { key: "light", label: "Light" },
  { key: "moderate", label: "Moderate" },
  { key: "active", label: "Active" },
];

export default function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useHealth();
  const [p, setP] = useState(profile);

  // Keep local form in sync when the sheet (re)opens with fresh store data.
  const [seen, setSeen] = useState(false);
  if (open && !seen) { setP(profile); setSeen(true); }
  if (!open && seen) setSeen(false);

  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v) || 0));
  const preview = calorieTarget(p);

  function save() {
    setProfile(p);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your profile"
      footer={
        <button onClick={save} className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]">
          Save profile
        </button>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Goal</label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {GOALS.map((g) => (
              <button key={g.key} onClick={() => setP({ ...p, goal: g.key })} className={`py-2.5 rounded-xl text-sm font-semibold border transition ${p.goal === g.key ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
                <span className="mr-1">{g.emoji}</span>{g.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Activity level</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {ACTIVITIES.map((a) => (
              <button key={a.key} onClick={() => setP({ ...p, activity: a.key })} className={`py-2 rounded-xl text-sm font-semibold border transition ${p.activity === a.key ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Age" value={p.age} onChange={(v) => setP({ ...p, age: num(v) })} suffix="yr" />
          <Field label="Height" value={p.heightCm} onChange={(v) => setP({ ...p, heightCm: num(v) })} suffix="cm" />
          <Field label="Weight" value={p.weightKg} onChange={(v) => setP({ ...p, weightKg: num(v) })} suffix="kg" />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Sex</label>
            <div className="flex gap-2 mt-2">
              {(["male", "female", "other"] as const).map((s) => (
                <button key={s} onClick={() => setP({ ...p, sex: s })} className={`flex-1 py-2 rounded-xl text-xs font-semibold border capitalize transition ${p.sex === s ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl glass-subtle p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">Daily calorie target</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{p.targetCalories ? "manual" : "estimated from your profile"}</p>
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">{preview}</p>
        </div>

        <Field
          label="Custom target (optional)"
          value={p.targetCalories}
          onChange={(v) => setP({ ...p, targetCalories: num(v) })}
          suffix="kcal"
          wide
        />
      </div>
    </Sheet>
  );
}

function Field({ label, value, onChange, suffix, wide }: { label: string; value: number | null; onChange: (v: string) => void; suffix: string; wide?: boolean }) {
  return (
    <div className={wide ? "" : ""}>
      <label className="text-[11px] text-slate-400 dark:text-slate-500">{label}</label>
      <div className="mt-1 flex items-center rounded-xl glass-subtle px-3">
        <input
          type="number"
          inputMode="numeric"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="flex-1 min-w-0 bg-transparent py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none"
        />
        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{suffix}</span>
      </div>
    </div>
  );
}
