import { Check } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useMoney, setSettings, spendableMonthly, dailyAllowance, periodFor } from "../../lib/money/store";
import { chf } from "../../lib/business/format";

const inputCls = "mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none";

const CURRENCIES = ["CHF", "EUR", "GBP", "USD"];

// The whole setup is one honest number now: what you can spend per month.
export default function AffordabilitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useMoney();
  const st = s.settings;
  const cur = st.currency || "CHF";
  const p = periodFor(s);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Budget"
      footer={
        <button onClick={onClose} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-[0.98]">
          <Check size={16} /> Done
        </button>
      }
    >
      <div className="space-y-5">
        {/* The one number */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Monthly budget</h3>
          <div className="flex gap-2">
            <input
              type="number" inputMode="decimal" min={0}
              value={st.monthlyBudget || ""}
              onChange={(e) => setSettings({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })}
              placeholder="e.g. 2500"
              className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-3 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
            />
            <select
              value={cur}
              onChange={(e) => setSettings({ currency: e.target.value })}
              className="shrink-0 rounded-xl glass-subtle px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none"
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            What you can spend per month — after rent, savings and everything else. That's all the app needs.
          </p>
        </section>

        {/* Your own month */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Your month</h3>
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Month starts on day</span>
            <select
              value={Math.min(28, Math.max(1, st.monthStartDay || 1))}
              onChange={(e) => setSettings({ monthStartDay: Number(e.target.value) || 1 })}
              className={inputCls}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}{d === 1 ? " (calendar month)" : "."}</option>
              ))}
            </select>
          </label>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            {st.monthStartDay > 1
              ? <>Your budget month runs <b>{p.label}</b> ({p.days} days) — set it to your payday and the budget resets with your salary.</>
              : <>The budget follows the calendar month. Pick your payday instead and it resets with your salary.</>}
          </p>
        </section>

        {/* When the budget starts counting */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Start tracking</h3>
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Counting from</span>
            <input
              type="date"
              value={st.trackingSince}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => { const v = e.target.value; if (v) setSettings({ trackingSince: v }); }}
              className={inputCls}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Each day from here adds one daily budget, and whatever you don't spend rolls over to the next day.
          </p>
        </section>

        {/* Summary */}
        {st.monthlyBudget > 0 && (
          <section className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75 mb-2">Your budget</p>
            <div className="space-y-1 text-[13px]">
              <Row k={`This month (${p.label})`} v={chf(spendableMonthly(s), cur)} bold />
              <Row k="Per day" v={chf(dailyAllowance(s), cur)} bold />
            </div>
            {spendableMonthly(s) > st.monthlyBudget && (
              <p className="text-[11px] text-white/70 mt-1.5 tabular-nums">
                includes +{chf(spendableMonthly(s) - st.monthlyBudget, cur)} extra income this month
              </p>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={bold ? "font-semibold" : "text-white/80"}>{k}</span>
      <span className={`tabular-nums ${bold ? "font-bold" : "text-white/90"}`}>{v}</span>
    </div>
  );
}
