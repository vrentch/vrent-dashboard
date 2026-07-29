import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import PriceChart from "../../components/PriceChart";
import { fetchHistory, fetchSignals, fetchNews, type History, type Quote, type Signal, type NewsItem } from "../../lib/api";
import { computeAnalytics } from "../../lib/analytics";
import { fmtPrice, fmtPct, fmtNum, cleanSymbol, timeAgo } from "../../lib/format";
import { usePrefs, setPrefs, toggleInList } from "../../lib/store";
import SignalPill from "../../components/SignalPill";
import ArticleReader from "../news/ArticleReader";
import { TrendingUp, TrendingDown, Minus, Star, Sparkles, Newspaper } from "lucide-react";

function newsQueryFor(q: Quote): string {
  const name = (q.name || "").replace(/\(.*?\)/g, "").replace(/\b(Inc|Corp|Corporation|Ltd|AG|SA|PLC|Co|Group|Holding|Holdings|NV|SE)\b\.?/gi, "").trim();
  return name.length >= 3 ? name : cleanSymbol(q.symbol);
}

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"];

export default function StockDetail({ quote, onClose }: { quote: Quote | null; onClose: () => void }) {
  const [range, setRange] = useState("1M");
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);
  const [related, setRelated] = useState<NewsItem[]>([]);
  const [readingNews, setReadingNews] = useState<NewsItem | null>(null);
  const prefs = usePrefs();
  const inList = quote ? prefs.watchlist.includes(quote.symbol) : false;

  useEffect(() => {
    if (!quote) return;
    let cancelled = false;
    setRelated([]);
    const countries = prefs.countries.length ? prefs.countries.slice(0, 2) : ["US"];
    fetchNews({ countries, topics: ["top"], query: newsQueryFor(quote) })
      .then((r) => !cancelled && setRelated(r.items.slice(0, 4)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [quote, prefs.countries]);

  useEffect(() => {
    if (!quote) return;
    let cancelled = false;
    setSignal(null);
    setSignalLoading(true);
    fetchSignals([quote.symbol])
      .then((r) => !cancelled && setSignal(r.signals[0] ?? null))
      .catch(() => {})
      .finally(() => !cancelled && setSignalLoading(false));
    return () => {
      cancelled = true;
    };
  }, [quote]);

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
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>{quote.flag}</span>
            <span className="truncate">{quote.name}</span>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold text-slate-900 tracking-tight">
              {fmtPrice(quote.price, quote.currency)}
            </span>
            <span className={`inline-flex items-center gap-1 text-sm font-semibold ${dayUp ? "text-emerald-600" : "text-rose-600"}`}>
              {dayUp ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              {fmtPct(quote.changePercent)} today
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {quote.exchange} {quote.marketState && `· ${quote.marketState}`}
          </p>

          <button
            onClick={() => setPrefs({ watchlist: toggleInList(prefs.watchlist, quote.symbol) })}
            className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold transition active:scale-95 border ${
              inList
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-white text-slate-700 border-slate-200"
            }`}
          >
            <Star size={15} fill={inList ? "currentColor" : "none"} />
            {inList ? "In my list" : "Add to my list"}
          </button>
        </div>

        {/* Smart Signal */}
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Sparkles size={15} className="text-brand-600" /> Smart Signal
            </h3>
            {signal ? (
              <SignalPill label={signal.label} tone={signal.tone} size="md" />
            ) : signalLoading ? (
              <span className="w-20 h-6 rounded-full skeleton" />
            ) : null}
          </div>

          {signalLoading && !signal && <div className="h-24 rounded-xl skeleton" />}

          {signal && (
            <>
              <div className="relative h-2.5 rounded-full mb-1" style={{ background: "linear-gradient(90deg,#f43f5e,#e2e8f0 50%,#10b981)" }}>
                <div
                  className="absolute -top-[5px] w-5 h-5 rounded-full bg-white border-[3px] border-slate-900 shadow"
                  style={{ left: `calc(${(signal.score + 100) / 2}% - 10px)` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-medium text-slate-400 mb-3">
                <span>Strong Sell</span>
                <span>Hold</span>
                <span>Strong Buy</span>
              </div>

              <ul className="space-y-1.5 mb-3">
                {signal.reasons.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-slate-600">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        r.tone === "pos" ? "bg-emerald-500" : r.tone === "neg" ? "bg-rose-500" : "bg-slate-400"
                      }`}
                    />
                    {r.text}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-1.5">
                {signal.rsi != null && <Chip>RSI {signal.rsi.toFixed(0)}</Chip>}
                <Chip>Momentum {fmtPct(signal.momentumPct)}</Chip>
                {signal.sma50 != null && (
                  <Chip>{(quote.price ?? 0) >= signal.sma50 ? "Above" : "Below"} 50-day avg</Chip>
                )}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                Educational rating computed from price trend, momentum &amp; RSI — <b>not financial advice</b>.
                Do your own research before trading.
              </p>
            </>
          )}
        </div>

        <div>
          {loading && <div style={{ height: 180 }} className="skeleton rounded-xl" />}
          {!loading && error && (
            <div style={{ height: 180 }} className="grid place-items-center text-sm text-rose-600">{error}</div>
          )}
          {!loading && !error && <PriceChart values={history?.closes || []} up={rangeUp} />}
        </div>

        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                range === r ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 active:bg-slate-200"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Analytics · {range}</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Range change" value={fmtPct(a.changePct)} tone={a.trend === "up" ? "pos" : a.trend === "down" ? "neg" : "flat"} />
            <Stat label="Volatility" value={a.volatilityPct != null ? `${fmtNum(a.volatilityPct)}%` : "—"} />
            <Stat label="Period high" value={fmtPrice(a.high, quote.currency)} />
            <Stat label="Period low" value={fmtPrice(a.low, quote.currency)} />
            <Stat label="Avg (SMA)" value={fmtPrice(a.sma, quote.currency)} />
            <Stat label="Prev. close" value={fmtPrice(quote.previousClose, quote.currency)} />
          </div>
        </div>

        {related.length > 0 && (
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 mb-2.5">
              <Newspaper size={15} className="text-brand-600" /> Related news
            </h3>
            <div className="space-y-2">
              {related.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setReadingNews(it)}
                  className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/70 active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 line-clamp-2">{it.title}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{it.source} · {timeAgo(it.publishedAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <a
          href={`https://www.cnbc.com/quotes/${encodeURIComponent(quote.symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-slate-400 hover:text-brand-600"
        >
          View full profile on CNBC →
        </a>
      </div>
      <ArticleReader item={readingNews} onClose={() => setReadingNews(null)} />
    </Sheet>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-600">
      {children}
    </span>
  );
}

function Stat({ label, value, tone = "flat" }: { label: string; value: string; tone?: "pos" | "neg" | "flat" }) {
  const color = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-900";
  const Icon = tone === "pos" ? TrendingUp : tone === "neg" ? TrendingDown : Minus;
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-base font-bold flex items-center gap-1 ${color}`}>
        {tone !== "flat" && <Icon size={14} />}
        {value}
      </p>
    </div>
  );
}
