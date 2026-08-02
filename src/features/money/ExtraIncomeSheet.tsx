import { useEffect, useMemo, useState } from "react";
import { Check, Landmark, HomeIcon, PiggyBank, PartyPopper, Gift } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  useMoney, addExtra, taxReserveMonthly, fixedMonthly,
} from "../../lib/money/store";
import { chf } from "../../lib/business/format";

// Log a bonus / one-time income and decide what it covers. Everything except
// the savings share raises this month's budget (and the daily/hourly rates).
export default function ExtraIncomeSheet({ open, onClose, month }: { open: boolean; onClose: () => void; month: string }) {
  const s = useMoney();
  const cur = s.settings.currency || "CHF";
  const [label, setLabel] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [ym, setYm] = useState(month);
  const [toTax, setToTax] = useState(0);
  const [toFixed, setToFixed] = useState(0);
  const [toSavings, setToSavings] = useState(0);
  const [toSpend, setToSpend] = useState(0);

  useEffect(() => {
    if (open) { setLabel(""); setAmountStr(""); setYm(month); setToTax(0); setToFixed(0); setToSavings(0); setToSpend(0); }
  }, [open, month]);

  const amount = Math.max(0, parseFloat(amountStr.replace(",", ".")) || 0);
  const allocated = toTax + toFixed + toSavings + toSpend;
  const remaining = Math.round((amount - allocated) * 100) / 100;
  const taxCap = taxReserveMonthly(s.settings);
  const boost = toTax + toFixed + toSpend + Math.max(0, remaining); // remainder defaults to spending
  const days = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() || 30;

  const rows = useMemo(() => ([
    ...(taxCap > 0 ? [{ key: "tax", icon: Landmark, label: "Cover tax reserve", cap: taxCap, val: toTax, set: setToTax }] : []),
    { key: "fixed", icon: HomeIcon, label: "Cover fixed costs", cap: fixedMonthly(s), val: toFixed, set: setToFixed },
    { key: "savings", icon: PiggyBank, label: "Put into savings", cap: Infinity, val: toSavings, set: setToSavings },
    { key: "spend", icon: PartyPopper, label: "Straight to daily budget", cap: Infinity, val: toSpend, set: setToSpend },
  ]), [s, taxCap, toTax, toFixed, toSavings, toSpend]);

  function fill(set: (n: number) => void, val: number, cap: number) {
    const room = Math.max(0, remaining + val); // what this bucket could take
    set(Math.round(Math.min(room, cap) * 100) / 100);
  }

  function save() {
    if (!(amount > 0)) return;
    // Any unallocated remainder goes to the daily budget (the friendly default —
    // it's the user's money to spend; savings needs an explicit choice).
    addExtra({ month: ym, label: label || "Extra income", amount, toTax, toFixed, toSavings, toSpend: toSpend + Math.max(0, remaining) });
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Extra income"
      footer={
        <button onClick={save} disabled={!(amount > 0) || remaining < 0} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-50">
          <Check size={16} /> Add {amount > 0 ? chf(amount, cur) : "income"}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300 shrink-0"><Gift size={17} /></span>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">A bonus, 13th salary or side income — choose what it covers this month.</p>
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
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">What should it cover?</p>
              <p className={`text-[11px] font-semibold tabular-nums ${remaining < 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"}`}>
                {remaining < 0 ? `${chf(-remaining, cur)} over` : `${chf(remaining, cur)} unallocated`}
              </p>
            </div>
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.key} className="rounded-2xl glass-subtle p-3">
                  <div className="flex items-center gap-2">
                    <r.icon size={15} className="text-slate-400 dark:text-slate-500 shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{r.label}</span>
                    {isFinite(r.cap) && <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{chf(r.cap, cur)}/mo</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number" inputMode="decimal" min={0}
                      value={r.val || ""}
                      onChange={(e) => r.set(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-24 rounded-lg bg-white/60 dark:bg-white/5 px-2.5 py-1.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
                    />
                    <button onClick={() => fill(r.set, r.val, r.cap)} className="px-2.5 py-1.5 rounded-lg glass-subtle text-[11px] font-semibold text-brand-600 dark:text-brand-400 active:scale-95">
                      {isFinite(r.cap) ? "Full" : "Rest"}
                    </button>
                    {r.val > 0 && (
                      <button onClick={() => r.set(0)} className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 active:scale-95">Clear</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Live effect preview */}
            <div className="rounded-2xl p-3.5 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Effect on {ym}</p>
              <p className="text-sm font-bold mt-1 tabular-nums">+{chf(boost, cur)} to the month's budget · daily rate +{chf(boost / days, cur)}</p>
              {toSavings > 0 && <p className="text-[11px] text-white/75 mt-0.5 tabular-nums">{chf(toSavings, cur)} goes to savings (not spendable)</p>}
              {remaining > 0 && <p className="text-[11px] text-white/75 mt-0.5">Unallocated money goes to the daily budget.</p>}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
