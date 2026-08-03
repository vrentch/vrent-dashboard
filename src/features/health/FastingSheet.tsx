import { useEffect, useState } from "react";
import { Check, Timer } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useHealth, setFasting, markLastMeal } from "../../lib/health";

const PRESETS = [
  { hours: 14, label: "14:10", desc: "Gentle" },
  { hours: 16, label: "16:8", desc: "Classic" },
  { hours: 18, label: "18:6", desc: "Strict" },
  { hours: 20, label: "20:4", desc: "Warrior" },
];

// Configure intermittent fasting: pick the fasting window and set when you
// last ate. Meal logs restart the clock automatically after that.
export default function FastingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useHealth();
  const [enabled, setEnabled] = useState(s.fasting.enabled);
  const [hours, setHours] = useState(s.fasting.fastingHours);
  const [lastAte, setLastAte] = useState("");

  useEffect(() => {
    if (open) {
      setEnabled(s.fasting.enabled);
      setHours(s.fasting.fastingHours);
      const t = s.fasting.lastMealAt ? new Date(s.fasting.lastMealAt) : new Date();
      setLastAte(`${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function save() {
    setFasting({ enabled, fastingHours: hours });
    if (enabled && lastAte) {
      // Interpret the time as today (or yesterday if it's in the future).
      const [h, m] = lastAte.split(":").map(Number);
      const d = new Date();
      d.setHours(h || 0, m || 0, 0, 0);
      if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
      markLastMeal(d.getTime());
    }
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Intermittent fasting"
      footer={
        <button onClick={save} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-[0.98]">
          <Check size={16} /> Save
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300 shrink-0"><Timer size={17} /></span>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Fast between meals, eat inside your window. Every meal you log restarts the timer automatically.</p>
        </div>

        <button
          onClick={() => setEnabled((v) => !v)}
          className={`w-full flex items-center justify-between rounded-2xl p-3.5 transition ${enabled ? "accent-gradient text-white" : "glass-subtle text-slate-700 dark:text-slate-200"}`}
        >
          <span className="text-sm font-semibold">Fasting tracking</span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${enabled ? "bg-white/20" : "bg-slate-200/80 dark:bg-slate-700"}`}>{enabled ? "ON" : "OFF"}</span>
        </button>

        {enabled && (
          <>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Fasting window</p>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.hours}
                    onClick={() => setHours(p.hours)}
                    className={`rounded-xl py-2.5 text-center transition ${hours === p.hours ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-700 dark:text-slate-200"}`}
                  >
                    <p className="text-sm font-bold">{p.label}</p>
                    <p className={`text-[10px] ${hours === p.hours ? "opacity-70" : "text-slate-400 dark:text-slate-500"}`}>{p.desc}</p>
                  </button>
                ))}
              </div>
              <label className="mt-2.5 flex items-center gap-2">
                <span className="text-[12px] text-slate-500 dark:text-slate-400">Custom:</span>
                <input
                  type="number" min={10} max={23} value={hours}
                  onChange={(e) => setHours(Math.max(10, Math.min(23, Number(e.target.value) || 16)))}
                  className="w-16 rounded-lg glass-subtle px-2.5 py-1.5 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
                />
                <span className="text-[12px] text-slate-500 dark:text-slate-400">h fasting · {24 - hours} h eating</span>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">When did you last eat?</span>
              <input
                type="time" value={lastAte} onChange={(e) => setLastAte(e.target.value)}
                className="mt-1.5 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none"
              />
              <span className="text-[11px] text-slate-400 dark:text-slate-500">A time later than now counts as yesterday. After this, meal logs update it for you.</span>
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}
