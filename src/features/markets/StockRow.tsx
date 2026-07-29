import type { Quote } from "../../lib/api";
import { fmtPrice, fmtPct } from "../../lib/format";
import Sparkline from "../../components/Sparkline";

export default function StockRow({
  quote,
  spark,
  onClick,
}: {
  quote: Quote;
  spark?: number[];
  onClick: () => void;
}) {
  const up = (quote.changePercent ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-ink-900 border border-white/5 active:scale-[0.99] transition text-left"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-[15px]">{quote.symbol}</span>
        </div>
        <p className="text-xs text-slate-500 truncate">{quote.name}</p>
      </div>

      <div className="w-16 h-8 shrink-0">
        {spark && spark.length > 1 ? (
          <Sparkline values={spark} width={64} height={32} fill />
        ) : (
          <div className="w-full h-full rounded skeleton opacity-40" />
        )}
      </div>

      <div className="text-right shrink-0 min-w-[84px]">
        <p className="font-semibold text-white text-[15px] tabular-nums">
          {fmtPrice(quote.price, quote.currency)}
        </p>
        <p className={`text-xs font-medium tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {fmtPct(quote.changePercent)}
        </p>
      </div>
    </button>
  );
}
