import Sheet from "../../components/Sheet";
import type { HealthPlan } from "../../lib/api";
import { Dumbbell, Utensils, Target } from "lucide-react";

export default function PlanSheet({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: HealthPlan | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="Your plan">
      {!plan ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">No plan yet.</p>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{plan.headline}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{plan.summary}</p>
          </div>

          <section>
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
              <Target size={12} /> Daily targets
            </h3>
            <div className="grid grid-cols-4 gap-2">
              <Stat label="kcal" value={plan.targets?.calories} />
              <Stat label="Protein" value={plan.targets?.protein_g} suffix="g" />
              <Stat label="Carbs" value={plan.targets?.carbs_g} suffix="g" />
              <Stat label="Fat" value={plan.targets?.fat_g} suffix="g" />
            </div>
          </section>

          {plan.today && (
            <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80 mb-1">Focus today</p>
              <p className="text-sm font-medium">{plan.today}</p>
            </div>
          )}

          {plan.workouts?.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                <Dumbbell size={12} /> Weekly workouts
              </h3>
              <div className="space-y-2">
                {plan.workouts.map((w, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl glass-subtle p-3">
                    <span className="grid place-items-center w-11 h-11 shrink-0 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold">{w.day}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{w.focus}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{w.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {plan.nutrition?.length > 0 && (
            <section>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                <Utensils size={12} /> Nutrition tips
              </h3>
              <ul className="space-y-1.5">
                {plan.nutrition.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300"><span className="text-brand-500">•</span> {n}</li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500">General guidance based on your data — not medical advice.</p>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value, suffix }: { label: string; value?: number; suffix?: string }) {
  return (
    <div className="rounded-xl glass-subtle p-2.5 text-center">
      <p className="text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value ?? "—"}{suffix || ""}</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
    </div>
  );
}
