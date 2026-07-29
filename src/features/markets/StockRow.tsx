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
      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white border border-slate-200/70 card-shadow active:scale-[0.99] transition text-left"
    >
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-slate-900 text-[15px]">{quote.symbol}</span>
        <p className="text-xs text-slate-400 truncate">{quote.name}</p>
      </div>

      <div className="w-16 h-8 shrink-0">
        {spark && spark.length > 1 ? (
          <Sparkline values={spark} width={64} height={32} fill />
        ) : (
          <div className="w-full h-full rounded skeleton opacity-60" />
        )}
      </div>

      <div className="text-right shrink-0 min-w-[86px]">
        <p className="font-semibold text-slate-900 text-[15px] tabular-nums">
          {fmtPrice(quote.price, quote.currency)}
        </p>
        <p
          className={`inline-block text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
            up ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"
          }`}
        >
          {fmtPct(quote.changePercent)}
        </p>
      </div>
    </button>
  );
}
