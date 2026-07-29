import { useEffect, useMemo, useState } from "react";
import Sheet from "../../components/Sheet";
import StockRow from "./StockRow";
import { fetchQuotes, fetchSignals, type Quote, type Signal } from "../../lib/api";
import { fmtPct, cleanSymbol } from "../../lib/format";
import { usePrefs, setPrefs, toggleInList, setActiveWatchlist } from "../../lib/store";
import type { IndexDef } from "../../data/markets";
import CurrencyConverter from "./CurrencyConverter";
import { TrendingUp, TrendingDown, Pencil, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  flag: string;
  indices?: IndexDef[]; // region mode
  symbols?: string[]; // watchlist mode
  onSelect: (q: Quote) => void;
  watchlist?: boolean;
  onEdit?: () => void;
  enableSignals?: boolean;
  converter?: boolean;
}

export default function RegionView({ open, onClose, title, flag, indices, symbols, onSelect, watchlist, onEdit, enableSignals = true, converter }: Props) {
  const prefs = usePrefs();
  const [activeIdx, setActiveIdx] = useState(0);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [signals, setSignals] = useState<Record<string, Signal>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);

  // Reset to the first index whenever the sheet (re)opens.
  useEffect(() => {
    if (open) setActiveIdx(0);
  }, [open, title]);

  const activeSymbols = indices ? indices[activeIdx]?.constituents ?? [] : symbols ?? [];
  const key = activeSymbols.join(",");

  useEffect(() => {
    if (!open || !activeSymbols.length) {
      setQuotes([]);
      setSignals({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSignals({});
    fetchQuotes(activeSymbols)
      .then((r) => !cancelled && setQuotes(r.quotes))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    // Signals need per-symbol history, so they load a beat later — the rows
    // show a shimmer until each arrives. Skipped for bonds/FX.
    if (enableSignals) {
      setSignalsLoading(true);
      fetchSignals(activeSymbols)
        .then((r) => {
          if (cancelled) return;
          const map: Record<string, Signal> = {};
          r.signals.forEach((s) => (map[s.symbol.toUpperCase()] = s));
          setSignals(map);
        })
        .catch(() => {})
        .finally(() => !cancelled && setSignalsLoading(false));
    } else {
      setSignalsLoading(false);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const sorted = useMemo(
    () => [...quotes].filter((q) => q.changePercent != null).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)),
    [quotes]
  );
  const gainers = sorted.filter((q) => (q.changePercent ?? 0) > 0).slice(0, 3);
  const losers = [...sorted].reverse().filter((q) => (q.changePercent ?? 0) < 0).slice(0, 3);

  const toggleList = (sym: string) => setPrefs({ watchlist: toggleInList(prefs.watchlist, sym) });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${flag} ${title}`}
      footer={
        watchlist && onEdit ? (
          <button
            onClick={onEdit}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]"
          >
            <Pencil size={15} /> Add symbols
          </button>
        ) : undefined
      }
    >
      {/* Watchlist switcher */}
      {watchlist && prefs.watchlists.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 mb-4">
          {prefs.watchlists.map((w) => (
            <button
              key={w.id}
              onClick={() => setActiveWatchlist(w.id)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${
                w.id === prefs.activeWatchlistId ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}

      {/* Index selector */}
      {indices && indices.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 mb-4">
          {indices.map((ix, i) => (
            <button
              key={ix.key}
              onClick={() => setActiveIdx(i)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${
                i === activeIdx ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              {ix.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[64px] rounded-2xl skeleton" />
          ))}
        </div>
      )}

      {!loading && !quotes.length && (
        <div className="text-center py-14">
          <p className="text-sm text-slate-500 dark:text-slate-400">{watchlist ? "Your list is empty." : "No data right now."}</p>
          {watchlist && onEdit && (
            <button onClick={onEdit} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold">
              <Plus size={15} /> Add symbols
            </button>
          )}
        </div>
      )}

      {!loading && quotes.length > 0 && (
        <div className="space-y-5">
          {converter && <CurrencyConverter quotes={quotes} />}

          {/* Quick overview strip */}
          {(() => {
            const withPct = quotes.filter((q) => q.changePercent != null);
            const up = withPct.filter((q) => (q.changePercent ?? 0) > 0).length;
            const down = withPct.filter((q) => (q.changePercent ?? 0) < 0).length;
            const avg = withPct.length ? withPct.reduce((a, b) => a + (b.changePercent ?? 0), 0) / withPct.length : null;
            return (
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">▲ {up}</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">▼ {down}</span>
                {avg != null && (
                  <span className={`ml-auto px-2.5 py-1 rounded-full ${avg >= 0 ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"}`}>
                    avg {fmtPct(avg)}
                  </span>
                )}
              </div>
            );
          })()}

          {(gainers.length > 0 || losers.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <MoverPanel title="Top gainers" tone="pos" items={gainers} onSelect={onSelect} />
              <MoverPanel title="Top losers" tone="neg" items={losers} onSelect={onSelect} />
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
              {sorted.length} stocks · best to worst
            </h3>
            <div className="space-y-2.5">
              {sorted.map((q) => (
                <StockRow
                  key={q.symbol}
                  quote={q}
                  signal={signals[q.symbol.toUpperCase()]}
                  signalLoading={signalsLoading}
                  onClick={() => onSelect(q)}
                  inList={prefs.watchlist.includes(q.symbol)}
                  onToggleList={() => toggleList(q.symbol)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function MoverPanel({
  title,
  tone,
  items,
  onSelect,
}: {
  title: string;
  tone: "pos" | "neg";
  items: Quote[];
  onSelect: (q: Quote) => void;
}) {
  const Icon = tone === "pos" ? TrendingUp : TrendingDown;
  const color = tone === "pos" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <div className="rounded-2xl glass-subtle p-3">
      <div className={`flex items-center gap-1.5 mb-2 text-xs font-semibold ${color}`}>
        <Icon size={14} /> {title}
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">—</p>}
        {items.map((q) => (
          <button
            key={q.symbol}
            onClick={() => onSelect(q)}
            className="w-full flex items-center justify-between gap-2 text-left active:opacity-70"
          >
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{cleanSymbol(q.symbol)}</span>
            <span className={`text-xs font-semibold tabular-nums ${color}`}>{fmtPct(q.changePercent)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
