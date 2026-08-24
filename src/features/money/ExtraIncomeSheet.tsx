import { useEffect, useState } from "react";
import { Check, PiggyBank, Gift } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useMoney, addExtra } from "../../lib/money/store";
import { chf } from "../../lib/business/format";

// Log a bonus / one-time income. Whatever you don't put into savings raises
// that month's budget (and the daily rate).
export default function ExtraIncomeSheet({ open, onClose, month }: { open: boolean; onClose: () => void; month: string }) {
  const s = useMoney();
  const cur = s.settings.currency || "CHF";
  const [label, setLabel] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [ym, setYm] = useState(month);
  const [savingsStr, setSavingsStr] = useState("");

  useEffect(() => {
    if (open) { setLabel(""); setAmountStr(""); setYm(month); setSavingsStr(""); }
  }, [open, month]);

  const amount = Math.max(0, parseFloat(amountStr.replace(",", ".")) || 0);
  const toSavings = Math.min(amount, Math.max(0, parseFloat(savingsStr.replace(",", ".")) || 0));
  const boost = Math.max(0, Math.round((amount - toSavings) * 100) / 100);
  const days = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() || 30;

  function save() {
    if (!(amount > 0)) return;
    addExtra({ month: ym, label: label || "Extra income", amount, toSavings, toSpend: boost });
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Extra income"
      footer={
        <button onClick={save} disabled={!(amount > 0)} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-50">
          <Check size={16} /> Add {amount > 0 ? chf(amount, cur) : "income"}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300 shrink-0"><Gift size={17} /></span>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">A bonus, 13th salary or side income — it tops up that month's budget.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">What is it?</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Bonus" className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Amount ({cur})</span>
            <input value={amountStr} onChange={(e) => setAmountStr(e.target.value)} type="number" inputMode="decimal" placeholder="0" className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none" />
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">For month</span>
          <input type="month" value={ym} onChange={(e) => { if (e.target.value) setYm(e.target.value); }} className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none" />
        </label>

        {amount > 0 && (
          <>
            <label className="block">
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500"><PiggyBank size={12} /> Put into savings first (optional)</span>
              <input value={savingsStr} onChange={(e) => setSavingsStr(e.target.value)} type="number" inputMode="decimal" min={0} placeholder="0" className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 outline-none" />
            </label>

            {/* Live effect preview */}
            <div className="rounded-2xl p-3.5 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Effect on {ym}</p>
              <p className="text-sm font-bold mt-1 tabular-nums">+{chf(boost, cur)} to the month's budget · daily rate +{chf(boost / days, cur)}</p>
              {toSavings > 0 && <p className="text-[11px] text-white/75 mt-0.5 tabular-nums">{chf(toSavings, cur)} goes to savings (not spendable)</p>}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
