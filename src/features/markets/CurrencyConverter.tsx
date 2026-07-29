import { useMemo, useState } from "react";
import type { Quote } from "../../lib/api";
import { ArrowLeftRight } from "lucide-react";

// Build "units of currency per 1 USD" from the majors quotes.
function buildRates(quotes: Quote[]): Record<string, number> {
  const p: Record<string, number> = {};
  quotes.forEach((q) => {
    if (q.price != null) p[q.symbol.toUpperCase()] = q.price;
  });
  const inv = (s: string) => (p[s] ? 1 / p[s] : undefined);
  const dir = (s: string) => p[s];
  const r: Record<string, number | undefined> = {
    USD: 1,
    EUR: inv("EUR="),
    GBP: inv("GBP="),
    AUD: inv("AUD="),
    JPY: dir("JPY="),
    CHF: dir("CHF="),
    CAD: dir("CAD="),
    CNY: dir("CNY="),
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) if (v && isFinite(v)) out[k] = v;
  return out;
}

const FLAG: Record<string, string> = { USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", CHF: "🇨🇭", JPY: "🇯🇵", AUD: "🇦🇺", CAD: "🇨🇦", CNY: "🇨🇳" };

export default function CurrencyConverter({ quotes }: { quotes: Quote[] }) {
  const rates = useMemo(() => buildRates(quotes), [quotes]);
  const currencies = Object.keys(rates);
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState(currencies.includes("CHF") ? "CHF" : "EUR");

  const amt = parseFloat(amount) || 0;
  const result = rates[from] && rates[to] ? (amt / rates[from]) * rates[to] : null;
  const unit = rates[from] && rates[to] ? (1 / rates[from]) * rates[to] : null;

  const selCls = "bg-transparent font-semibold text-slate-900 dark:text-slate-100 outline-none text-sm";

  if (!currencies.length) return null;

  return (
    <div className="rounded-2xl glass p-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Converter</h3>
      <div className="flex items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className="w-24 px-3 py-2.5 rounded-xl bg-white/60 dark:bg-white/5 border border-white/50 dark:border-white/10 text-slate-900 dark:text-slate-100 font-semibold outline-none"
        />
        <div className="flex items-center gap-1 px-2 py-2.5 rounded-xl bg-white/60 dark:bg-white/5 border border-white/50 dark:border-white/10">
          <span>{FLAG[from]}</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={selCls}>
            {currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { setFrom(to); setTo(from); }}
          className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-brand-600 text-white active:scale-95"
          aria-label="Swap"
        >
          <ArrowLeftRight size={16} />
        </button>
        <div className="flex items-center gap-1 px-2 py-2.5 rounded-xl bg-white/60 dark:bg-white/5 border border-white/50 dark:border-white/10">
          <span>{FLAG[to]}</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selCls}>
            {currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
          {result != null ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} <span className="text-base font-semibold text-slate-400 dark:text-slate-500">{to}</span>
        </span>
        {unit != null && (
          <span className="text-xs text-slate-400 dark:text-slate-500">1 {from} = {unit.toLocaleString(undefined, { maximumFractionDigits: 4 })} {to}</span>
        )}
      </div>
    </div>
  );
}
