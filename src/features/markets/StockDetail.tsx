import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import PriceChart from "../../components/PriceChart";
import { fetchHistory, type History, type Quote } from "../../lib/api";
import { computeAnalytics } from "../../lib/analytics";
import { fmtPrice, fmtPct, fmtNum } from "../../lib/format";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"];

export default function StockDetail({ quote, onClose }: { quote: Quote | null; onClose: () => void }) {
  const [range, setRange] = useState("1M");
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchHistory(quote.symbol, range)
      .then((h) => !cancelled && setHistory(h))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [quote, range]);

  if (!quote) return null;

  const a = computeAnalytics(history);
  const rangeUp = (a.changePct ?? 0) >= 0;
  const dayUp = (quote.changePercent ?? 0) >= 0;

  return (
    <Sheet open={!!quote} onClose={onClose} title={quote.symbol}>
      <div className="space-y-5">
        <div>
          <p className="text-sm text-slate-400 truncate">{quote.name}</p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold text-white tracking-tight">
              {fmtPrice(quote.price, quote.currency)}
            </span>
            <span className={`inline-flex items-center gap-1 text-sm font-semibold ${dayUp ? "text-emerald-400" : "text-rose-400"}`}>
              {dayUp ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              {fmtPct(quote.changePercent)} today
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {quote.exchange} {quote.marketState && `· ${quote.marketState}`}
          </p>
        </div>

        <div>
          {loading && <div style={{ height: 180 }} className="skeleton rounded-xl" />}
          {!loading && error && (
            <div style={{ height: 180 }} className="grid place-items-center text-sm text-rose-400">{error}</div>
          )}
          {!loading && !error && <PriceChart values={history?.closes || []} up={rangeUp} />}
        </div>

        <div className="flex gap-1.5 bg-white/5 p-1 rounded-xl">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                range === r ? "bg-sky-500 text-white" : "text-slate-400 active:bg-white/5"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white mb-2.5">Analytics · {range}</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Range change"
              value={fmtPct(a.changePct)}
              tone={a.trend === "up" ? "pos" : a.trend === "down" ? "neg" : "flat"}
            />
            <Stat label="Volatility" value={a.volatilityPct != null ? `${fmtNum(a.volatilityPct)}%` : "—"} />
            <Stat label="Period high" value={fmtPrice(a.high, quote.currency)} />
            <Stat label="Period low" value={fmtPrice(a.low, quote.currency)} />
            <Stat label="Avg (SMA)" value={fmtPrice(a.sma, quote.currency)} />
            <Stat label="Prev. close" value={fmtPrice(quote.previousClose, quote.currency)} />
          </div>
        </div>

        <a
          href={`https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-slate-500 hover:text-sky-400"
        >
          View full profile on Yahoo Finance →
        </a>
      </div>
    </Sheet>
  );
}

function Stat({ label, value, tone = "flat" }: { label: string; value: string; tone?: "pos" | "neg" | "flat" }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-white";
  const Icon = tone === "pos" ? TrendingUp : tone === "neg" ? TrendingDown : Minus;
  return (
    <div className="rounded-xl bg-white/5 border border-white/5 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-bold flex items-center gap-1 ${color}`}>
        {tone !== "flat" && <Icon size={14} />}
        {value}
      </p>
    </div>
  );
}
