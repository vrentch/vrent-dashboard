import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Settings2, Plus, Wallet, Clock, Gift } from "lucide-react";
import {
  useMoney, addExpense, removeExpense, isConfigured,
  spendableMonthly, dailyAllowance, spentOnDay, periodFor, spentInPeriod, expensesInPeriod,
  todayKey, CATEGORIES, categoryTotals, lastNDaysSpend, categoryOf,
  extrasFor, removeExtra, boostFor,
} from "../../lib/money/store";
import { chf } from "../../lib/business/format";
import SwipeRow from "../../components/SwipeRow";
import AffordabilitySheet from "./AffordabilitySheet";
import ExtraIncomeSheet from "./ExtraIncomeSheet";

export default function MoneyScreen({ onBack }: { onBack: () => void }) {
  const s = useMoney();
  const [setupOpen, setSetupOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("food");
  const [note, setNote] = useState("");
  // Re-render every 30s so the live meter actually drips.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const cur = s.settings.currency || "CHF";
  const fmt = (n: number) => chf(n, cur);
  const now = new Date();
  const period = periodFor(s, now);
  const configured = isConfigured(s);
  const daily = dailyAllowance(s, now);
  const todaySpent = spentOnDay(s, todayKey());
  const monthSpent = spentInPeriod(s, period);
  const monthExpenses = useMemo(() => expensesInPeriod(s, period), [s, period.start, period.end]);
  const byCat = useMemo(() => categoryTotals(monthExpenses), [monthExpenses]);
  const trend = useMemo(() => lastNDaysSpend(s, 7), [s]);
  const maxTrend = Math.max(1, ...trend.map((t) => t.amount), daily);

  function quickAdd() {
    const a = parseFloat(amount.replace(",", "."));
    if (!(a > 0)) return;
    addExpense({ amount: a, category: cat, note: note.trim() || undefined });
    setAmount("");
    setNote("");
  }

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <button onClick={onBack} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400 mb-0.5">
              <ChevronLeft size={14} /> Home
            </button>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">Money</h1>
          </div>
          <button onClick={() => setSetupOpen(true)} className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Affordability setup">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-4 space-y-5">
        {!configured ? (
          <button onClick={() => setSetupOpen(true)} className="w-full text-left rounded-3xl p-5 text-white active:scale-[0.99] transition" style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b14 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}>
            <Wallet size={26} className="mb-2 text-white/90" />
            <p className="text-lg font-bold">Set your budget</p>
            <p className="text-[13px] text-white/80 mt-1">One number — what you can spend per month. I'll turn it into a simple daily budget that rolls over what you don't spend.</p>
          </button>
        ) : (
          <>
            {/* Today's budget — one number, plainly explained */}
            {(() => {
              const leftToday = daily - todaySpent;           // today's budget − spent, plain
              const spentPct = daily > 0 ? Math.min(1, todaySpent / daily) : 1;
              const monthLeft = spendableMonthly(s) - monthSpent;
              const endD = new Date(period.end + "T00:00:00");
              const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const daysLeft = Math.max(1, Math.round((endD.getTime() - today0.getTime()) / 86_400_000) + 1);
              const perDayRest = monthLeft / daysLeft;
              const over = leftToday <= -0.005;
              return (
                <section className="rounded-3xl p-5 text-white relative overflow-hidden accent-gradient shadow-accent">
                  <div className="absolute -right-8 -top-10 w-44 h-44 rounded-full bg-white/15 blur-2xl" />
                  <div className="relative">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Left to spend today</p>
                    <p className={`mt-1 text-[40px] leading-none font-extrabold display-num tabular-nums ${over ? "text-rose-200" : ""}`}>
                      {fmt(leftToday)}
                    </p>
                    <p className="text-xs text-white/80 mt-1.5 tabular-nums">
                      {fmt(daily)} a day − {fmt(todaySpent)} spent today
                    </p>
                    <div className="mt-3 h-2.5 rounded-full bg-white/20 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${over ? "bg-rose-300" : "bg-white/90"}`}
                        style={{ width: `${Math.round((over ? 0 : 1 - spentPct) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-white/70 mt-2">
                      {over
                        ? <>Over for today — tomorrow starts fresh with {fmt(daily)}.</>
                        : <>Keep to about {fmt(perDayRest)} a day for the {daysLeft} day{daysLeft === 1 ? "" : "s"} left this month.</>}
                    </p>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-2xl bg-white/12 px-2 py-2.5">
                        <p className="text-[15px] font-bold tabular-nums">{fmt(daily)}</p>
                        <p className="text-[10px] text-white/75 mt-0.5">daily budget</p>
                      </div>
                      <div className="rounded-2xl bg-white/12 px-2 py-2.5">
                        <p className="text-[15px] font-bold tabular-nums">{fmt(todaySpent)}</p>
                        <p className="text-[10px] text-white/75 mt-0.5">spent today</p>
                      </div>
                      <div className="rounded-2xl bg-white/12 px-2 py-2.5">
                        <p className={`text-[15px] font-bold tabular-nums ${monthLeft <= -0.005 ? "text-rose-200" : ""}`}>{fmt(monthLeft)}</p>
                        <p className="text-[10px] text-white/75 mt-0.5">left this month</p>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Quick add expense */}
            <section className="rounded-3xl glass p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Add spending</p>
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); }}
                  type="text" inputMode="decimal" placeholder="0.00"
                  className="w-28 rounded-xl glass-subtle px-3 py-2.5 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
                />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") quickAdd(); }}
                  placeholder="Note (optional)"
                  className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
                />
                <button onClick={quickAdd} disabled={!(parseFloat(amount.replace(",", ".")) > 0)} className="grid place-items-center w-12 rounded-xl accent-gradient text-white shadow-accent active:scale-95 disabled:opacity-40" aria-label="Add expense">
                  <Plus size={20} />
                </button>
              </div>
              <div className="mt-2.5 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
                {CATEGORIES.map((c) => (
                  <button key={c.key} onClick={() => setCat(c.key)} className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition ${cat === c.key ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Bonus / one-time income */}
            <button onClick={() => setExtraOpen(true)} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl glass text-sm font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.98]">
              <Gift size={16} className="text-brand-600 dark:text-brand-400" /> Add bonus / extra income
            </button>

            {/* Month stats */}
            <section className="rounded-3xl glass p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">This month · {period.label}</p>
                {/* "monthly budget", not "spendable" — the live meter above draws
                    on a smaller, tracking-prorated pool and must not be conflated */}
                <p className="text-xs text-slate-400 dark:text-slate-500">{fmt(monthSpent)} spent · budget {fmt(spendableMonthly(s))}</p>
              </div>
              <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full ${monthSpent > spendableMonthly(s) ? "bg-rose-500" : "accent-gradient"}`} style={{ width: `${Math.min(100, spendableMonthly(s) ? (monthSpent / spendableMonthly(s)) * 100 : 0)}%` }} />
              </div>

              {/* This month's extra income */}
              {extrasFor(s, period.anchorYm).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Extra income · +{fmt(boostFor(s, period.anchorYm))} to budget
                  </p>
                  {extrasFor(s, period.anchorYm).map((x) => (
                    <SwipeRow key={x.id} onDelete={() => removeExtra(x.id)}>
                      <div className="flex items-center gap-3 glass-subtle p-3">
                        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><Gift size={15} /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{x.label}</p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {[x.toTax > 0 && `tax ${fmt(x.toTax)}`, x.toFixed > 0 && `fixed ${fmt(x.toFixed)}`, x.toSavings > 0 && `savings ${fmt(x.toSavings)}`, x.toSpend > 0 && `budget ${fmt(x.toSpend)}`].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{fmt(x.amount)}</span>
                      </div>
                    </SwipeRow>
                  ))}
                </div>
              )}

              {/* 7-day trend vs daily allowance */}
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2"><Clock size={12} /> Last 7 days · line = daily allowance</p>
                <div className="relative flex items-end justify-between gap-1.5 h-20">
                  <div className="absolute inset-x-0 border-t border-dashed border-slate-400/50" style={{ bottom: `${(daily / maxTrend) * 72}px` }} />
                  {trend.map((t) => {
                    const over = t.amount > daily && daily > 0;
                    return (
                      <div key={t.date} className="flex-1 flex flex-col items-center gap-1" title={`${t.date} · ${fmt(t.amount)}`}>
                        <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{t.amount ? Math.round(t.amount) : ""}</span>
                        <span className={`w-full rounded-md ${over ? "bg-rose-500" : "bg-slate-800 dark:bg-slate-200"}`} style={{ height: Math.max(3, Math.round((t.amount / maxTrend) * 64)) }} />
                        <span className="text-[9px] text-slate-400 dark:text-slate-500">{new Date(t.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Category breakdown */}
              {byCat.length > 0 && (
                <div className="space-y-2.5">
                  {byCat.map((c) => (
                    <div key={c.key}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{c.emoji} {c.label}</span>
                        <span className="text-[13px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(c.amount)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-slate-800 dark:bg-slate-200" style={{ width: `${Math.max(2, monthSpent ? (c.amount / monthSpent) * 100 : 0)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </section>

            {/* Expense list */}
            {monthExpenses.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Spending · {monthExpenses.length}</h2>
                <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-2 md:items-start">
                  {monthExpenses.slice(0, 40).map((e) => (
                    <SwipeRow key={e.id} onDelete={() => removeExpense(e.id)}>
                      <div className="flex items-center gap-3 glass-subtle p-3">
                        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-slate-500/15 text-base">{categoryOf(e.category).emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{e.note || categoryOf(e.category).label}</p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            {e.date === todayKey() ? "Today" : new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                            {" · "}{categoryOf(e.category).label}
                          </p>
                        </div>
                        <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(e.amount)}</span>
                      </div>
                    </SwipeRow>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <AffordabilitySheet open={setupOpen} onClose={() => setSetupOpen(false)} />
      <ExtraIncomeSheet open={extraOpen} onClose={() => setExtraOpen(false)} month={period.anchorYm} />
    </div>
  );
}
