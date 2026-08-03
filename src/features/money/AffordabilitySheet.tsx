import { useEffect, useState } from "react";
import { Trash2, Plus, Check, Landmark, Sparkles, Loader2 } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  useMoney, setSettings, addFixed, removeFixed, afterTaxMonthly, estimatedTaxPct, taxReserveMonthly,
  spendableMonthly, dailyAllowance, hourlyAllowance, savingsMonthly, fixedMonthly,
  CANTONS, type MaritalStatus, type TaxSystem,
} from "../../lib/money/store";
import { aiTaxLookup } from "../../lib/api";
import { chf } from "../../lib/business/format";
import { GEMEINDEN } from "../../data/gemeinden";

const inputCls = "mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none";

const SYSTEMS: { key: TaxSystem; label: string }[] = [
  { key: "CH", label: "🇨🇭 Switzerland" },
  { key: "UK", label: "🇬🇧 United Kingdom" },
  { key: "none", label: "No tax" },
];

export default function AffordabilitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useMoney();
  const st = s.settings;
  const [fxLabel, setFxLabel] = useState("");
  const [fxAmount, setFxAmount] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  // Draft for the waking-hours field: clamping on every keystroke made the
  // input unusable (clearing it snapped to 18, typing "1" snapped to 8).
  // Type freely; the value commits, clamped, when you leave the field.
  const [whDraft, setWhDraft] = useState(String(s.settings.wakingHours));
  useEffect(() => {
    if (open) setWhDraft(String(s.settings.wakingHours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  function commitWakingHours() {
    const n = Math.max(4, Math.min(24, Math.round(Number(whDraft.replace(",", ".")) || 0) || st.wakingHours || 18));
    setWhDraft(String(n));
    setSettings({ wakingHours: n });
  }

  const sys = st.taxSystem || "CH";
  const cur = st.currency || "CHF";
  const taxPct = estimatedTaxPct(st);
  const afterTax = afterTaxMonthly(st);

  const incomeLabel =
    sys === "UK" ? `Gross salary / month (${cur})`
    : sys === "none" ? `Income / month (${cur})`
    : `Received on your bank account / month (${cur})`;

  function addFx() {
    const a = parseFloat(fxAmount.replace(",", "."));
    if (!fxLabel.trim() || !(a > 0)) return;
    addFixed(fxLabel, a);
    setFxLabel("");
    setFxAmount("");
  }

  // AI-refine the Swiss estimate for the user's exact Gemeinde (Steuerfuss).
  async function lookupGemeinde() {
    if (!st.gemeinde.trim() || !(st.bankMonthly > 0)) {
      setLookupErr(!(st.bankMonthly > 0) ? "Enter your income first." : "Type your Gemeinde first.");
      return;
    }
    setLooking(true);
    setLookupErr(null);
    setLookupMsg(null);
    try {
      const cantonLabel = CANTONS.find((c) => c.key === st.canton)?.label || st.canton;
      const r = await aiTaxLookup({ canton: cantonLabel, gemeinde: st.gemeinde.trim(), status: st.status, incomeMonthly: st.bankMonthly });
      if (r.ok && r.data && r.data.taxPct > 0) {
        setSettings({ taxPct: Math.round(r.data.taxPct * 10) / 10 });
        setLookupMsg(`${st.gemeinde.trim()}: −${Math.round(r.data.taxPct * 10) / 10}%${r.data.note ? ` · ${r.data.note}` : ""}`);
      } else {
        setLookupErr(r.needCode ? "Enter your access code first." : r.error || "Couldn't estimate that Gemeinde.");
      }
    } catch {
      setLookupErr("Couldn't estimate that Gemeinde.");
    } finally {
      setLooking(false);
    }
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
        {/* Tax system */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Tax system</h3>
          <div className="flex gap-2">
            {SYSTEMS.map((x) => (
              <button
                key={x.key}
                onClick={() => setSettings({ taxSystem: x.key })}
                className={`flex-1 px-2 py-2 rounded-xl text-[12.5px] font-semibold transition ${sys === x.key ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </section>

        {/* Income */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Income</h3>
          <label className="block">
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{incomeLabel}</span>
            <input type="number" inputMode="decimal" value={st.bankMonthly || ""} onChange={(e) => setSettings({ bankMonthly: Number(e.target.value) || 0 })} placeholder={sys === "UK" ? "e.g. 4000" : "e.g. 6500"} className={inputCls} />
          </label>

          {sys === "CH" && (
            <>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label className="block">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Canton</span>
                  <select value={st.canton} onChange={(e) => setSettings({ canton: e.target.value as any, gemeinde: "", taxPct: null })} className={inputCls}>
                    {CANTONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">Status</span>
                  <select value={st.status} onChange={(e) => setSettings({ status: e.target.value as MaritalStatus, taxPct: null })} className={inputCls}>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                  </select>
                </label>
              </div>

              {/* Gemeinde — full official register per canton, AI-refined rate */}
              <div className="mt-3 rounded-2xl glass-subtle p-3">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">Gemeinde (for a precise rate)</span>
                {(() => {
                  const list = GEMEINDEN[st.canton] || [];
                  const known = !st.gemeinde || list.includes(st.gemeinde);
                  return (
                    <div className="mt-1 flex gap-2">
                      {list.length > 0 && known ? (
                        <select
                          value={st.gemeinde}
                          onChange={(e) => setSettings({ gemeinde: e.target.value === "__other__" ? " " : e.target.value })}
                          className="flex-1 min-w-0 rounded-xl bg-white/60 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
                        >
                          <option value="">— select your Gemeinde —</option>
                          {list.map((g) => <option key={g} value={g}>{g}</option>)}
                          <option value="__other__">Other…</option>
                        </select>
                      ) : (
                        <input
                          value={st.gemeinde.trim()}
                          onChange={(e) => setSettings({ gemeinde: e.target.value || " " })}
                          onBlur={(e) => { if (!e.target.value.trim()) setSettings({ gemeinde: "" }); }}
                          onKeyDown={(e) => { if (e.key === "Enter") lookupGemeinde(); }}
                          autoFocus={st.gemeinde === " "}
                          placeholder="Type your Gemeinde"
                          className="flex-1 min-w-0 rounded-xl bg-white/60 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none"
                        />
                      )}
                      <button onClick={lookupGemeinde} disabled={looking} className="inline-flex items-center gap-1 px-3 rounded-xl accent-gradient text-white text-xs font-semibold shadow-accent active:scale-95 disabled:opacity-50 shrink-0">
                        {looking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} AI rate
                      </button>
                    </div>
                  );
                })()}
                {lookupMsg && <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">{lookupMsg}</p>}
                {lookupErr && <p className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">{lookupErr}</p>}
              </div>
            </>
          )}

          {/* Tax box */}
          {sys !== "none" && (
            <div className="mt-3 rounded-2xl glass-subtle p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                  <Landmark size={13} /> {sys === "UK" ? "Income Tax + NI (PAYE)" : "Income tax (Kanton + Bund)"}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-slate-900 dark:text-slate-100">−{taxPct}% · {chf(taxReserveMonthly(st), cur)}/mo</span>
              </div>
              <input
                type="range" min={0} max={sys === "UK" ? 50 : 35} step={0.5}
                value={taxPct}
                onChange={(e) => setSettings({ taxPct: Number(e.target.value) })}
                className="w-full mt-2 accent-indigo-600"
              />
              <div className="flex items-center justify-between mt-1">
                <button onClick={() => setSettings({ taxPct: null })} className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">Reset to estimate</button>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{sys === "UK" ? "deducted at source" : "set aside now, owed later"}</span>
              </div>
              <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                {sys === "UK" ? "Take-home" : "Yours after tax"}: {chf(afterTax, cur)} / month
              </p>
            </div>
          )}
        </section>

        {/* Fixed expenses */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Fixed expenses / month</h3>
          <div className="space-y-2">
            {s.fixed.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-xl glass-subtle px-3 py-2">
                <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{f.label}</span>
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{chf(f.amount, cur)}</span>
                <button onClick={() => removeFixed(f.id)} className="grid place-items-center w-7 h-7 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
            {s.fixed.length === 0 && <p className="text-[13px] text-slate-500 dark:text-slate-400">Rent, insurance, phone, subscriptions…</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={fxLabel} onChange={(e) => setFxLabel(e.target.value)} placeholder="e.g. Rent" className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <input value={fxAmount} onChange={(e) => setFxAmount(e.target.value)} type="number" inputMode="decimal" placeholder={cur} className="w-24 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <button onClick={addFx} className="grid place-items-center w-11 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-95" aria-label="Add fixed expense"><Plus size={16} /></button>
          </div>
        </section>

        {/* Savings */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Savings first</h3>
          <div className="flex gap-2">
            <select value={st.savingsMode} onChange={(e) => setSettings({ savingsMode: e.target.value as any })} className="rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none">
              <option value="amount">{cur} / month</option>
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
              <input
                type="number" inputMode="numeric" min={4} max={24}
                value={whDraft}
                onChange={(e) => setWhDraft(e.target.value)}
                onBlur={commitWakingHours}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={inputCls}
              />
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
            <Row k={sys === "UK" ? "Gross salary" : sys === "none" ? "Income" : "On bank account"} v={chf(st.bankMonthly, cur)} />
            {sys !== "none" && <Row k={`− ${sys === "UK" ? "Tax & NI" : "Tax reserve"} (${taxPct}%)`} v={chf(taxReserveMonthly(st), cur)} />}
            <Row k="− Fixed costs" v={chf(fixedMonthly(s), cur)} />
            <Row k="− Savings" v={chf(savingsMonthly(s), cur)} />
            <div className="border-t border-white/20 my-1.5" />
            <Row k="Spendable / month" v={chf(spendableMonthly(s), cur)} bold />
            <Row k="Per day" v={chf(dailyAllowance(s), cur)} bold />
            <Row k="Per waking hour" v={chf(hourlyAllowance(s), cur)} bold />
          </div>
        </section>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {sys === "UK"
            ? "PAYE estimate (Income Tax + employee NI, 2024/25 rates). Drag the slider to match your payslip."
            : sys === "none"
              ? "No tax is deducted — the amount you enter is used as-is."
              : "The canton estimate is approximate — type your Gemeinde and tap AI rate for a precise figure, or drag the slider to match your tax bill."}
        </p>
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
