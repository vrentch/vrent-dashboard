import { useEffect, useState } from "react";
import { Loader2, Check, Sparkles, X } from "lucide-react";
import Sheet from "../../components/Sheet";
import { addFood } from "../../lib/health";
import { aiNutrition, type FoodEstimate } from "../../lib/api";

interface EditItem {
  name: string;
  grams: number;
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
  const [name, setName] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcErr, setRecalcErr] = useState<string | null>(null);

  useEffect(() => {
    if (!estimate) return;
    const src = Array.isArray(estimate.items) ? estimate.items : [];
    setItems(
      src.map((i) => ({
        name: i.name || "Item",
        grams: gramsFromPortion(i.portion),
        calories: Math.round(i.calories || 0),
        protein_g: Math.round(i.protein_g || 0),
        carbs_g: Math.round(i.carbs_g || 0),
        fat_g: Math.round(i.fat_g || 0),
      }))
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

  // Editing grams scales this item's calories & macros proportionally (instant).
  function setGrams(i: number, grams: number) {
    setItems((arr) =>
      arr.map((it, idx) => {
        if (idx !== i) return it;
        const og = it.grams;
        if (og > 0 && grams > 0) {
          const f = grams / og;
          return {
            ...it,
            grams,
            calories: Math.round(it.calories * f),
            protein_g: Math.round(it.protein_g * f),
            carbs_g: Math.round(it.carbs_g * f),
            fat_g: Math.round(it.fat_g * f),
          };
        }
        return { ...it, grams };
      })
    );
  }

  function removeItem(i: number) {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  }

  // Ask the AI to re-estimate everything from the corrected names + grams
  // (fixes "chicken vs beef" and updates calories accordingly).
  async function recalc() {
    setRecalcing(true);
    setRecalcErr(null);
    try {
      const payload = items.map((it) => ({ name: it.name.trim() || "food", grams: it.grams > 0 ? it.grams : 150 }));
      const r = await aiNutrition(payload);
      if (r.ok && r.data?.items?.length) {
        setItems(
          r.data.items.map((i) => ({
            name: i.name || "Item",
            grams: Math.round(i.grams || 0),
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
      ) : !hasFood ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{estimate?.note || "That doesn't look like food."}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-slate-400 dark:text-slate-500">Meal name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none" />
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

          {/* Editable items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Items — tap to fix</p>
              <button onClick={recalc} disabled={recalcing} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 disabled:opacity-50">
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
                <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                  <label className="inline-flex items-center gap-1.5">
                    <span>Amount</span>
                    <span className="inline-flex items-center rounded-lg bg-white/60 dark:bg-white/5 px-2 py-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={it.grams || ""}
                        onChange={(e) => setGrams(i, Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-12 bg-transparent text-right text-[12px] font-semibold text-slate-800 dark:text-slate-200 outline-none"
                      />
                      <span className="ml-0.5">g</span>
                    </span>
                  </label>
                  <span>P {it.protein_g} · C {it.carbs_g} · F {it.fat_g}</span>
                </div>
              </div>
            ))}
          </div>

          {recalcErr && <p className="text-[12px] text-rose-600 dark:text-rose-400">{recalcErr}</p>}
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Fix a name (e.g. chicken → beef) or an amount, then tap <b>Recalculate</b> to update the calories. Changing grams alone rescales instantly.
          </p>
        </div>
      )}
    </Sheet>
  );
}
