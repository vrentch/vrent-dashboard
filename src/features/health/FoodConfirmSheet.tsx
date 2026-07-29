import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import Sheet from "../../components/Sheet";
import { addFood } from "../../lib/health";
import type { FoodEstimate } from "../../lib/api";

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

  useEffect(() => {
    if (estimate) {
      const items = estimate.items || [];
      setName(items.length ? items.map((i) => i.name).join(", ").slice(0, 60) : "Meal");
    }
  }, [estimate]);

  const t = estimate?.total;
  const hasFood = !!estimate && (estimate.items?.length ?? 0) > 0;

  function log() {
    if (!t) return;
    addFood({
      name: name.trim() || "Meal",
      calories: Math.round(t.calories || 0),
      protein_g: Math.round(t.protein_g || 0),
      carbs_g: Math.round(t.carbs_g || 0),
      fat_g: Math.round(t.fat_g || 0),
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
            <Check size={16} /> Add to today
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
          <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg, #059669 0%, #10b981 100%)" }}>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Estimated total</p>
                <p className="text-3xl font-bold tabular-nums leading-tight">{Math.round(t?.calories || 0)}<span className="text-base font-semibold"> kcal</span></p>
              </div>
              <div className="text-right text-xs font-semibold space-y-0.5">
                <p>P {Math.round(t?.protein_g || 0)}g</p>
                <p>C {Math.round(t?.carbs_g || 0)}g</p>
                <p>F {Math.round(t?.fat_g || 0)}g</p>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-2xl glass-subtle divide-y divide-white/40 dark:divide-white/5">
            {estimate!.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{it.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{it.portion}</p>
                </div>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums shrink-0">{Math.round(it.calories || 0)} kcal</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            AI estimate ({estimate?.confidence || "medium"} confidence){estimate?.note ? ` · ${estimate.note}` : ""}. Adjust the meal name if needed.
          </p>
        </div>
      )}
    </Sheet>
  );
}
