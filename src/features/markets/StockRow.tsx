import type { Quote, Signal } from "../../lib/api";
import { fmtPct, cleanSymbol, displayPrice } from "../../lib/format";
import Sparkline from "../../components/Sparkline";
import SignalPill from "../../components/SignalPill";
import { Star } from "lucide-react";

export default function StockRow({
  quote,
  spark,
  signal,
  signalLoading,
  onClick,
  inList,
  onToggleList,
}: {
  quote: Quote;
  spark?: number[];
  signal?: Signal;
  signalLoading?: boolean;
  onClick: () => void;
  inList?: boolean;
  onToggleList?: () => void;
}) {
  const up = (quote.changePercent ?? 0) >= 0;
  return (
    <div className="w-full flex items-center gap-2.5 p-3 rounded-2xl glass">
      <button onClick={onClick} className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-[15px]">{cleanSymbol(quote.symbol)}</span>
            {signal ? (
              <SignalPill label={signal.label} tone={signal.tone} />
            ) : signalLoading ? (
              <span className="w-12 h-3.5 rounded-full skeleton" />
            ) : null}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{quote.name}</p>
        </div>

        {spark && spark.length > 1 && (
          <div className="w-14 h-8 shrink-0">
            <Sparkline values={spark} width={56} height={32} fill />
          </div>
        )}

        <div className="text-right shrink-0 min-w-[84px]">
          <p className="font-semibold text-slate-900 dark:text-slate-100 text-[15px] tabular-nums">{displayPrice(quote.price, quote.currency, quote.symbol)}</p>
          <p
            className={`inline-block text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
              up ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15" : "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15"
            }`}
          >
            {fmtPct(quote.changePercent)}
          </p>
        </div>
      </button>

      {onToggleList && (
        <button
          onClick={onToggleList}
          className={`grid place-items-center w-9 h-9 shrink-0 rounded-full active:scale-90 transition ${
            inList ? "text-amber-500" : "text-slate-300 dark:text-slate-600"
          }`}
          aria-label={inList ? "Remove from my list" : "Add to my list"}
        >
          <Star size={19} fill={inList ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}
