import { useEffect, useState } from "react";
import { Loader2, Check, Sparkles, X, Plus } from "lucide-react";
import Sheet from "../../components/Sheet";
import { addFood, rememberFood, frequentFoods, useHealth, type LearnedFood } from "../../lib/health";
import { aiNutrition, type FoodEstimate } from "../../lib/api";

// Units the user can pick — grams, countable pieces, and common household units.
const UNITS = ["g", "piece", "slice", "cup", "tbsp", "tsp", "ml", "serving", "handful", "bowl", "plate", "oz"];

interface EditItem {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

// Pull a gram figure out of a portion string like "1 cup (150 g)" → 150.
function gramsFromPortion(p: string): number {
  const m = String(p || "").match(/(\d+(?:\.\d+)?)\s*g\b/i);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

export default function FoodConfirmSheet({
  open,
  onClose,
  loading,
  error,
  estimate,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  estimate: FoodEstimate | null;
  preview: string | null;
}) {
  const s = useHealth();
  const learned = frequentFoods(s, 10);
  const [name, setName] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcErr, setRecalcErr] = useState<string | null>(null);

  useEffect(() => {
    if (!estimate) return;
    const src = Array.isArray(estimate.items) ? estimate.items : [];
    setItems(
      src.map((i) => {
        const unit = i.unit || "g";
        const q = i.quantity && i.quantity > 0 ? Math.round(i.quantity) : gramsFromPortion(i.portion || "");
        return {
          name: i.name || "Item",
          unit,
          quantity: q > 0 ? q : unit === "g" ? 100 : 1,
          calories: Math.round(i.calories || 0),
          protein_g: Math.round(i.protein_g || 0),
          carbs_g: Math.round(i.carbs_g || 0),
          fat_g: Math.round(i.fat_g || 0),
        };
      })
    );
    setName(src.length ? src.map((i) => i.name).join(", ").slice(0, 60) : "Meal");
    setRecalcErr(null);
  }, [estimate]);

  const hasFood = items.length > 0;
  const total = items.reduce(
    (a, it) => ({
      calories: a.calories + it.calories,
      protein_g: a.protein_g + it.protein_g,
      carbs_g: a.carbs_g + it.carbs_g,
      fat_g: a.fat_g + it.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  function setItem(i: number, patch: Partial<EditItem>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  // Changing the quantity (same unit) rescales this item's macros instantly.
  function setQuantity(i: number, quantity: number) {
    setItems((arr) =>
      arr.map((it, idx) => {
        if (idx !== i) return it;
        const oq = it.quantity;
        if (oq > 0 && quantity > 0) {
          const f = quantity / oq;
          return {
            ...it,
            quantity,
            calories: Math.round(it.calories * f),
            protein_g: Math.round(it.protein_g * f),
            carbs_g: Math.round(it.carbs_g * f),
            fat_g: Math.round(it.fat_g * f),
          };
        }
        return { ...it, quantity };
      })
    );
  }

  function removeItem(i: number) {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  }

  function addBlank() {
    setItems((arr) => [...arr, { name: "", quantity: 100, unit: "g", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }]);
  }

  // Add a food the app has already learned — one tap, no AI needed.
  function addLearned(f: LearnedFood) {
    setItems((arr) => [
      ...arr,
      { name: f.name, quantity: f.quantity || 1, unit: f.unit || "g", calories: f.calories, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g },
    ]);
    if (!name || name === "Meal") setName(f.name);
  }

  // Ask the AI to re-estimate everything from the corrected names + amounts
  // (fixes "chicken vs beef" and unit changes like g → pieces).
  async function recalc() {
    setRecalcing(true);
    setRecalcErr(null);
    try {
      const payload = items.map((it) => ({ name: it.name.trim() || "food", quantity: it.quantity > 0 ? it.quantity : 1, unit: it.unit || "g" }));
      const r = await aiNutrition(payload);
      if (r.ok && r.data?.items?.length) {
        setItems(
          r.data.items.map((i) => ({
            name: i.name || "Item",
            quantity: Math.round(i.quantity || 0) || 1,
            unit: i.unit || "g",
            calories: Math.round(i.calories || 0),
            protein_g: Math.round(i.protein_g || 0),
            carbs_g: Math.round(i.carbs_g || 0),
            fat_g: Math.round(i.fat_g || 0),
          }))
        );
      } else {
        setRecalcErr(r.needCode ? "Enter your access code first." : r.error || "Couldn't recalculate.");
      }
    } catch {
      setRecalcErr("Couldn't recalculate.");
    } finally {
      setRecalcing(false);
    }
  }

  function log() {
    if (!hasFood) return;
    // Learn every confirmed item so recognition & corrections improve over time.
    items.forEach((it) => {
      if (it.name.trim() && it.calories > 0) {
        rememberFood({ name: it.name.trim(), unit: it.unit, quantity: it.quantity, calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g });
      }
    });
    addFood({
      name: name.trim() || "Meal",
      calories: Math.round(total.calories),
      protein_g: Math.round(total.protein_g),
      carbs_g: Math.round(total.carbs_g),
      fat_g: Math.round(total.fat_g),
    });
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log a meal"
      footer={
        hasFood ? (
          <button onClick={log} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:scale-[0.98]">
            <Check size={16} /> Add {Math.round(total.calories)} kcal to today
          </button>
        ) : undefined
      }
    >
      {preview && <img src={preview} alt="" className="w-full max-h-52 object-cover rounded-2xl mb-4" />}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={18} className="animate-spin" /> Estimating calories…
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400 py-6 text-center">{error}</p>
      ) : !hasFood && !learned.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{estimate?.note || "That doesn't look like food."}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-slate-400 dark:text-slate-500">Meal name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meal" className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
          </div>

          {/* Total */}
          <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Total</p>
                <p className="text-3xl font-bold tabular-nums leading-tight">{Math.round(total.calories)}<span className="text-base font-semibold"> kcal</span></p>
              </div>
              <div className="text-right text-xs font-semibold space-y-0.5">
                <p>P {Math.round(total.protein_g)}g</p>
                <p>C {Math.round(total.carbs_g)}g</p>
                <p>F {Math.round(total.fat_g)}g</p>
              </div>
            </div>
          </div>

          {/* Learned foods — one-tap add (the app's memory of your diet) */}
          {learned.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">Your foods</p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
                {learned.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => addLearned(f)}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-200 active:scale-95"
                  >
                    <Plus size={12} className="text-brand-600 dark:text-brand-400" /> {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Editable items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Items — tap to fix</p>
              <button onClick={recalc} disabled={recalcing || !hasFood} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 disabled:opacity-50">
                {recalcing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Recalculate
              </button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="rounded-2xl glass-subtle p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={it.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                    placeholder="Food name"
                    className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none"
                  />
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 tabular-nums shrink-0">{it.calories} kcal</span>
                  <button onClick={() => removeItem(i)} className="grid place-items-center w-6 h-6 shrink-0 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Remove item">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 dark:text-slate-500">
                  <span>Amount</span>
                  <span className="inline-flex items-center rounded-lg bg-white/60 dark:bg-white/5 px-2 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={it.quantity || ""}
                      onChange={(e) => setQuantity(i, Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-12 bg-transparent text-right text-[12px] font-semibold text-slate-800 dark:text-slate-200 outline-none"
                    />
                  </span>
                  <select
                    value={it.unit}
                    onChange={(e) => setItem(i, { unit: e.target.value })}
                    className="rounded-lg bg-white/60 dark:bg-white/5 px-2 py-1 text-[12px] font-semibold text-slate-800 dark:text-slate-200 outline-none"
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <span className="ml-auto">P {it.protein_g} · C {it.carbs_g} · F {it.fat_g}</span>
                </div>
              </div>
            ))}
            <button onClick={addBlank} className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-2xl glass-subtle text-sm font-semibold text-slate-600 dark:text-slate-300 active:scale-[0.98]">
              <Plus size={15} /> Add food manually
            </button>
          </div>

          {recalcErr && <p className="text-[12px] text-rose-600 dark:text-rose-400">{recalcErr}</p>}
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Fix a name (chicken → beef), change the amount or unit (g, pieces, cups…), then tap <b>Recalculate</b>. Changing just the quantity rescales instantly. The app remembers what you log to recognise your meals better next time.
          </p>
        </div>
      )}
    </Sheet>
  );
}
