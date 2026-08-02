import { useState } from "react";
import { Trash2, Plus, Check, Landmark } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  useMoney, setSettings, addFixed, removeFixed, afterTaxMonthly, estimatedTaxPct, taxReserveMonthly,
  spendableMonthly, dailyAllowance, hourlyAllowance, savingsMonthly, fixedMonthly,
  CANTONS, type MaritalStatus,
} from "../../lib/money/store";
import { chf } from "../../lib/business/format";

const inputCls = "mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none";

export default function AffordabilitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useMoney();
  const st = s.settings;
  const [fxLabel, setFxLabel] = useState("");
  const [fxAmount, setFxAmount] = useState("");

  const taxPct = estimatedTaxPct(st);
  const afterTax = afterTaxMonthly(st);

  function addFx() {
    const a = parseFloat(fxAmount.replace(",", "."));
    if (!fxLabel.trim() || !(a > 0)) return;
    addFixed(fxLabel, a);
    setFxLabel("");
    setFxAmount("");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Affordability"
      footer={
        <button onClick={onClose} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-[0.98]">
          <Check size={16} /> Done
        </button>
      }
    >
      <div className="space-y-5">
        {/* Income — what lands on the bank account */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Income</h3>
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Received on your bank account / month (CHF)</span>
            <input type="number" inputMode="decimal" value={st.bankMonthly || ""} onChange={(e) => setSettings({ bankMonthly: Number(e.target.value) || 0 })} placeholder="e.g. 6500" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Canton</span>
              <select value={st.canton} onChange={(e) => setSettings({ canton: e.target.value as any })} className={inputCls}>
                {CANTONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Status</span>
              <select value={st.status} onChange={(e) => setSettings({ status: e.target.value as MaritalStatus })} className={inputCls}>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
              </select>
            </label>
          </div>

          {/* Tax reserve — Kantons- + Bundessteuer are owed later, not withheld */}
          <div className="mt-3 rounded-2xl glass-subtle p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200"><Landmark size={13} /> Income tax (Kanton + Bund)</span>
              <span className="text-[12px] font-bold tabular-nums text-slate-900 dark:text-slate-100">−{taxPct}% · {chf(taxReserveMonthly(st))}/mo</span>
            </div>
            <input
              type="range" min={0} max={35} step={0.5}
              value={taxPct}
              onChange={(e) => setSettings({ taxPct: Number(e.target.value) })}
              className="w-full mt-2 accent-indigo-600"
            />
            <div className="flex items-center justify-between mt-1">
              <button onClick={() => setSettings({ taxPct: null })} className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">Reset to estimate</button>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">set aside now, owed later</span>
            </div>
            <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">Yours after tax: {chf(afterTax)} / month</p>
          </div>
        </section>

        {/* Fixed expenses */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Fixed expenses / month</h3>
          <div className="space-y-2">
            {s.fixed.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-xl glass-subtle px-3 py-2">
                <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{f.label}</span>
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{chf(f.amount)}</span>
                <button onClick={() => removeFixed(f.id)} className="grid place-items-center w-7 h-7 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
            {s.fixed.length === 0 && <p className="text-[13px] text-slate-500 dark:text-slate-400">Rent, insurance, phone, subscriptions…</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={fxLabel} onChange={(e) => setFxLabel(e.target.value)} placeholder="e.g. Rent" className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <input value={fxAmount} onChange={(e) => setFxAmount(e.target.value)} type="number" inputMode="decimal" placeholder="CHF" className="w-24 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <button onClick={addFx} className="grid place-items-center w-11 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-95" aria-label="Add fixed expense"><Plus size={16} /></button>
          </div>
        </section>

        {/* Savings */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Savings first</h3>
          <div className="flex gap-2">
            <select value={st.savingsMode} onChange={(e) => setSettings({ savingsMode: e.target.value as any })} className="rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none">
              <option value="amount">CHF / month</option>
              <option value="percent">% after tax</option>
            </select>
            <input type="number" inputMode="decimal" min={0} value={st.savingsValue || ""} onChange={(e) => setSettings({ savingsValue: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" className="flex-1 rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none" />
          </div>
        </section>

        {/* Day shape */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Your day</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Wake up</span>
              <input type="time" value={st.wakeTime} onChange={(e) => setSettings({ wakeTime: e.target.value || "06:00" })} className={inputCls} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Waking hours</span>
              <input type="number" inputMode="numeric" min={8} max={24} value={st.wakingHours} onChange={(e) => setSettings({ wakingHours: Math.max(8, Math.min(24, Number(e.target.value) || 18)) })} className={inputCls} />
            </label>
          </div>
          <label className="block mt-3">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Tracking since (meter starts counting here)</span>
            <input
              type="date"
              value={st.trackingSince}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => { const v = e.target.value; if (v) setSettings({ trackingSince: v }); }}
              className={inputCls}
            />
          </label>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">Money only "flows" while you're awake, and only from the day you started tracking — earlier days earn nothing.</p>
        </section>

        {/* Summary */}
        <section className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75 mb-2">Your allowance</p>
          <div className="space-y-1 text-[13px]">
            <Row k="On bank account" v={chf(st.bankMonthly)} />
            <Row k={`− Tax reserve (${taxPct}%)`} v={chf(taxReserveMonthly(st))} />
            <Row k="− Fixed costs" v={chf(fixedMonthly(s))} />
            <Row k="− Savings" v={chf(savingsMonthly(s))} />
            <div className="border-t border-white/20 my-1.5" />
            <Row k="Spendable / month" v={chf(spendableMonthly(s))} bold />
            <Row k="Per day" v={chf(dailyAllowance(s))} bold />
            <Row k="Per waking hour" v={chf(hourlyAllowance(s))} bold />
          </div>
        </section>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">The tax estimate is approximate (effective Kantons-, Gemeinde- + Bundessteuer). Drag the slider to match your real tax bill.</p>
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
