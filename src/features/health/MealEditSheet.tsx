import { useEffect, useState } from "react";
import { Trash2, Check } from "lucide-react";
import Sheet from "../../components/Sheet";
import { updateFood, removeFood, type FoodEntry } from "../../lib/health";

export default function MealEditSheet({ open, onClose, entry }: { open: boolean; onClose: () => void; entry: FoodEntry | null }) {
  const [name, setName] = useState("");
  const [cal, setCal] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  const [f, setF] = useState("");

  useEffect(() => {
    if (entry) {
      setName(entry.name);
      setCal(String(entry.calories));
      setP(String(entry.protein_g));
      setC(String(entry.carbs_g));
      setF(String(entry.fat_g));
    }
  }, [entry]);

  if (!entry) return null;

  function save() {
    updateFood(entry!.id, {
      name: name.trim() || "Meal",
      calories: Math.round(Number(cal) || 0),
      protein_g: Math.round(Number(p) || 0),
      carbs_g: Math.round(Number(c) || 0),
      fat_g: Math.round(Number(f) || 0),
    });
    onClose();
  }
  function del() {
    removeFood(entry!.id);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit meal"
      footer={
        <div className="flex gap-2">
          <button onClick={del} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 text-sm font-semibold active:scale-95">
            <Trash2 size={15} /> Delete
          </button>
          <button onClick={save} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]">
            <Check size={15} /> Save
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-[11px] text-slate-400 dark:text-slate-500">Meal name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
        </div>
        <Field label="Calories" value={cal} onChange={setCal} suffix="kcal" />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Protein" value={p} onChange={setP} suffix="g" />
          <Field label="Carbs" value={c} onChange={setC} suffix="g" />
          <Field label="Fat" value={f} onChange={setF} suffix="g" />
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 dark:text-slate-500">{label}</label>
      <div className="mt-1 flex items-center rounded-xl glass-subtle px-3">
        <input type="number" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 min-w-0 bg-transparent py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{suffix}</span>
      </div>
    </div>
  );
}
