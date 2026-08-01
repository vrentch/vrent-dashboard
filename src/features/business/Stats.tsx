import { TrendingUp, AlertCircle } from "lucide-react";
import type { Receipt, BexioCode } from "../../lib/business/store";
import { statsFor, monthlyTotals } from "../../lib/business/store";
import { chf, monthLabel, monthChip } from "../../lib/business/format";

// A descriptive monthly statistics card: headline spend, sub-metrics, a
// 6-month trend, and a per-Bexio-code breakdown with share bars. Everything is
// shown in CHF (the dominant currency of the set).
export default function Stats({
  receipts,
  all,
  codes,
  scope,
  onPickMonth,
}: {
  receipts: Receipt[];
  all: Receipt[];
  codes: BexioCode[];
  scope: string; // "all" or "YYYY-MM"
  onPickMonth?: (ym: string) => void;
}) {
  const st = statsFor(receipts, codes);
  const cur = st.currency;
  const title = scope === "all" ? "All time" : monthLabel(scope);
  const trend = monthlyTotals(all, 6);
  const maxTrend = Math.max(1, ...trend.map((t) => t.gross));

  return (
    <section className="rounded-3xl glass p-5 space-y-5">
      {/* Headline */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Total spend · {title}
        </p>
        <p className="mt-1 text-[34px] leading-none font-bold text-slate-900 dark:text-slate-100 tabular-nums">
          {chf(st.gross, cur)}
        </p>
        {st.mixedCurrency && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} /> Summed as {cur} — you also have receipts in other currencies.
          </p>
        )}
      </div>

      {/* Sub-metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Receipts" value={String(st.count)} />
        <Metric label="Avg / receipt" value={chf(st.avg, cur)} />
        <Metric label="VAT included" value={chf(st.vat, cur)} />
        <Metric label="Net (excl. VAT)" value={chf(st.net, cur)} />
      </div>

      {/* 6-month trend */}
      {all.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            <TrendingUp size={12} /> Last 6 months
          </p>
          <div className="flex items-end justify-between gap-1.5 h-24">
            {trend.map((t) => {
              const active = t.ym === scope;
              const h = Math.max(4, Math.round((t.gross / maxTrend) * 84));
              return (
                <button
                  key={t.ym}
                  onClick={() => onPickMonth?.(t.ym)}
                  className="flex-1 flex flex-col items-center gap-1 group"
                  title={`${monthLabel(t.ym)} · ${chf(t.gross, cur)}`}
                >
                  <span className="text-[9px] font-semibold tabular-nums text-slate-400 dark:text-slate-500 group-active:text-slate-700 dark:group-active:text-slate-200">
                    {t.gross ? Math.round(t.gross) : ""}
                  </span>
                  <span
                    className={`w-full rounded-md transition-colors ${active ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-300/70 dark:bg-slate-600/70"}`}
                    style={{ height: h }}
                  />
                  <span className={`text-[9px] font-medium ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>
                    {monthChip(t.ym).split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-code breakdown */}
      {st.byCode.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            By Bexio code
          </p>
          <div className="space-y-3">
            {st.byCode.map((c) => (
              <div key={c.code || "none"}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex items-baseline gap-1.5">
                    {c.code ? (
                      <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{c.code}</span>
                    ) : (
                      <span className="text-sm font-bold text-amber-600 dark:text-amber-400">No code</span>
                    )}
                    <span className="text-[13px] text-slate-500 dark:text-slate-400 truncate">{c.label}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{chf(c.amount, cur)}</span>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.code ? "bg-slate-800 dark:bg-slate-200" : "bg-amber-400"}`}
                      style={{ width: `${Math.max(2, Math.round(c.share * 100))}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 w-16 text-right">
                    {Math.round(c.share * 100)}% · {c.count}×
                  </span>
                </div>
              </div>
            ))}
          </div>
          {st.unassigned > 0 && (
            <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
              {st.unassigned} receipt{st.unassigned === 1 ? "" : "s"} still need{st.unassigned === 1 ? "s" : ""} a Bexio code.
            </p>
          )}
        </div>
      )}

      {st.count === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-2">
          No receipts in {title.toLowerCase()} yet.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl glass-subtle px-3 py-2.5">
      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight whitespace-nowrap mt-0.5">{value}</p>
    </div>
  );
}
