import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Settings2, Plus, Wallet, TrendingDown, PiggyBank, Clock, Gift } from "lucide-react";
import {
  useMoney, addExpense, removeExpense, isConfigured, afterTaxMonthly, estimatedTaxPct,
  spendableMonthly, dailyAllowance, hourlyAllowance, liveBalance, meterBreakdown, spentOnDay, spentInMonth,
  savingsMonthly, fixedMonthly, todayKey, CATEGORIES, categoryTotals, lastNDaysSpend, expensesInMonth, categoryOf,
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
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const configured = isConfigured(s);
  const balance = liveBalance(s, now);
  const daily = dailyAllowance(s, now);
  const hourly = hourlyAllowance(s, now);
  const todaySpent = spentOnDay(s, todayKey());
  const monthSpent = spentInMonth(s, ym);
  const monthExpenses = useMemo(() => expensesInMonth(s, ym), [s, ym]);
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
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
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

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {!configured ? (
          <button onClick={() => setSetupOpen(true)} className="w-full text-left rounded-3xl p-5 text-white active:scale-[0.99] transition" style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b14 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}>
            <Wallet size={26} className="mb-2 text-white/90" />
            <p className="text-lg font-bold">Set up Affordability</p>
            <p className="text-[13px] text-white/80 mt-1">Enter what lands on your bank account, your canton and fixed costs — I'll reserve your taxes and work out what you can safely spend right now, per day and per hour.</p>
          </button>
        ) : (
          <>
            {/* Today's budget — the number people actually think in */}
            {(() => {
              const bd = meterBreakdown(s, now);
              const carry = Math.abs(bd.carryover) >= 0.5 ? bd.carryover : 0;
              const todayPool = Math.max(0, daily + carry);           // what today can absorb
              const leftToday = todayPool - todaySpent;               // simple: budget − spent
              const spentPct = todayPool > 0 ? Math.min(1, todaySpent / todayPool) : 1;
              const monthLeft = spendableMonthly(s) - monthSpent;
              // The eating hours label, e.g. 06:00–24:00.
              const [wh, wm] = (s.settings.wakeTime || "06:00").split(":").map(Number);
              const endAbs = (wh || 6) + (wm || 0) / 60 + (s.settings.wakingHours || 18);
              const endLabel = endAbs >= 24 && endAbs % 24 < 0.02 ? "24:00" : `${String(Math.floor(endAbs % 24)).padStart(2, "0")}:${String(Math.round((endAbs % 1) * 60)).padStart(2, "0")}`;
              return (
                <section className="rounded-3xl p-5 text-white relative overflow-hidden accent-gradient shadow-accent">
                  <div className="absolute -right-8 -top-10 w-44 h-44 rounded-full bg-white/15 blur-2xl" />
                  <div className="relative">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Left to spend today</p>
                    <p className={`mt-1 text-[38px] leading-none font-extrabold display-num tabular-nums ${leftToday <= -0.005 ? "text-rose-200" : ""}`}>
                      {fmt(leftToday)}
                    </p>
                    <p className="text-xs text-white/80 mt-1.5 tabular-nums">
                      {fmt(daily)} daily budget
                      {carry > 0 && <> + {fmt(carry)} saved from earlier days</>}
                      {carry < 0 && <> − {fmt(-carry)} overspent earlier</>}
                      {" "}− {fmt(todaySpent)} spent
                    </p>
                    {leftToday <= -0.005 && <p className="text-[11px] text-rose-200/90 mt-1">Over today's budget — tomorrow adds a fresh {fmt(daily)}.</p>}
                    <div className="mt-3 h-2 rounded-full bg-white/20 overflow-hidden">
                      <div className={`h-full rounded-full ${leftToday <= -0.005 ? "bg-rose-300" : "bg-white/90"}`} style={{ width: `${Math.round((1 - spentPct) * 100)}%` }} />
                    </div>

                    {/* The live drip — secondary, clearly explained */}
                    <div className="mt-3.5 rounded-2xl bg-white/12 px-3.5 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-white/80 inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" /> Unlocked so far
                        </p>
                        <p className={`text-[15px] font-bold tabular-nums ${balance <= -0.005 ? "text-rose-200" : ""}`}>{fmt(balance)}</p>
                      </div>
                      <p className="text-[10.5px] text-white/65 mt-0.5">
                        Today's budget unlocks {fmt(hourly)}/hour while you're awake ({s.settings.wakeTime || "06:00"}–{endLabel}) — spend within this and you'll never get ahead of your day.
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-white/12 px-2 py-2">
                        <p className="text-[15px] font-bold tabular-nums">{fmt(daily)}</p>
                        <p className="text-[10px] text-white/75">per day</p>
                      </div>
                      <div className="rounded-xl bg-white/12 px-2 py-2">
                        <p className="text-[15px] font-bold tabular-nums">{fmt(hourly)}</p>
                        <p className="text-[10px] text-white/75">per hour awake</p>
                      </div>
                      <div className="rounded-xl bg-white/12 px-2 py-2">
                        <p className={`text-[15px] font-bold tabular-nums ${monthLeft <= -0.005 ? "text-rose-200" : ""}`}>{fmt(monthLeft)}</p>
                        <p className="text-[10px] text-white/75">left this month</p>
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">This month</p>
                {/* "monthly budget", not "spendable" — the live meter above draws
                    on a smaller, tracking-prorated pool and must not be conflated */}
                <p className="text-xs text-slate-400 dark:text-slate-500">{fmt(monthSpent)} spent · budget {fmt(spendableMonthly(s))}</p>
              </div>
              <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full ${monthSpent > spendableMonthly(s) ? "bg-rose-500" : "accent-gradient"}`} style={{ width: `${Math.min(100, spendableMonthly(s) ? (monthSpent / spendableMonthly(s)) * 100 : 0)}%` }} />
              </div>

              {/* This month's extra income */}
              {extrasFor(s, ym).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Extra income · +{fmt(boostFor(s, ym))} to budget
                  </p>
                  {extrasFor(s, ym).map((x) => (
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

              {/* Budget summary */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Mini icon={Wallet} label="After tax" value={fmt(afterTaxMonthly(s.settings))} sub={`tax −${estimatedTaxPct(s.settings)}%`} />
                <Mini icon={TrendingDown} label="Fixed costs" value={fmt(fixedMonthly(s))} sub={`${s.fixed.length} items`} />
                <Mini icon={PiggyBank} label="Savings" value={fmt(savingsMonthly(s))} sub="reserved first" />
              </div>
            </section>

            {/* Expense list */}
            {monthExpenses.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Spending · {monthExpenses.length}</h2>
                <div className="space-y-2">
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
      <ExtraIncomeSheet open={extraOpen} onClose={() => setExtraOpen(false)} month={ym} />
    </div>
  );
}

function Mini({ icon: Icon, label, value, sub }: { icon: typeof Wallet; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl glass-subtle px-2.5 py-2.5 text-center">
      <Icon size={14} className="mx-auto text-slate-400 dark:text-slate-500 mb-1" />
      <p className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value}</p>
      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{label} · {sub}</p>
    </div>
  );
}
