import { useMemo, useState } from "react";
import { Plus, Archive, ChevronRight, Sparkles, CalendarClock, RefreshCw } from "lucide-react";
import {
  type GameState, type Target, categoryOf, priorityOf, todayKey, addDays, isAliveOn, matchesCadence,
  hits, logValue, renewalLabel, termOn, addPresets, CATEGORIES,
} from "../../lib/game/store";
import { campaignOf, quotaOf, cadenceLabel } from "../../lib/game/scoring";
import { PACKS, QUICK_START } from "../../lib/game/presets";

// Managing the board. Everything here is reversible: retire a target and its
// history stays, put it back and it rejoins tonight's scoring.

export default function TargetsView({
  s, onAdd, onEdit,
}: { s: GameState; onAdd: () => void; onEdit: (t: Target) => void }) {
  const today = todayKey();
  const [showArchived, setShowArchived] = useState(false);

  const live = s.targets.filter((t) => !t.archived);
  const active = live.filter((t) => termOn(t, today) != null);
  const scheduled = live.filter((t) => termOn(t, today) == null); // not started yet, or between terms
  const archived = s.targets.filter((t) => t.archived);

  const byCategory = useMemo(() => {
    const groups = CATEGORIES.map((c) => ({ cat: c, items: active.filter((t) => t.category === c.key) })).filter((g) => g.items.length);
    return groups;
  }, [active]);

  const weightTotal = active.reduce((a, t) => a + priorityOf(t.priority).weight, 0);

  if (!s.targets.length) {
    return (
      <div className="space-y-3.5">
        <section className="rounded-3xl p-5 relative overflow-hidden hero-ink text-white">
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-brand-500/25 blur-2xl" aria-hidden />
          <div className="relative">
            <Sparkles size={24} className="mb-2 text-brand-300" />
            <p className="text-[17px] font-extrabold">Pick your board</p>
            <p className="mt-1 text-[12.5px] text-white/70 leading-relaxed">
              Targets are the whole game. Take a ready-made set and bend it to your week, or write your own —
              you can change any of it later without losing a day of history.
            </p>
            <button
              onClick={() => addPresets(QUICK_START)}
              className="mt-3.5 w-full h-12 rounded-2xl bg-white text-slate-900 text-[13.5px] font-bold active:scale-[0.98]"
            >
              Start with 5 solid targets
            </button>
            <button onClick={onAdd} className="mt-2 w-full h-11 rounded-2xl bg-white/12 text-[13px] font-bold active:scale-[0.98]">
              Write my own instead
            </button>
          </div>
        </section>

        {PACKS.map((p) => (
          <section key={p.key} className="rounded-3xl glass p-4">
            <div className="flex items-center gap-2.5">
              <span className="text-[22px]">{p.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{p.label}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">{p.blurb}</p>
              </div>
              <button
                onClick={() => addPresets(p.targets)}
                className="shrink-0 h-9 px-3.5 rounded-xl accent-gradient text-white text-[12px] font-bold shadow-accent active:scale-95"
              >
                Add {p.targets.length}
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {p.targets.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg glass-subtle text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {t.emoji} {t.title}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Board summary */}
      <section className="rounded-3xl glass p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Your board</p>
            <p className="mt-0.5 text-[20px] font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
              {active.length} <span className="text-[13px] font-semibold text-slate-400 dark:text-slate-500">live target{active.length === 1 ? "" : "s"}</span>
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {weightTotal} total weight · {active.filter((t) => matchesCadence(t, today)).length} on today's board
            </p>
          </div>
          <button onClick={onAdd} className="grid place-items-center w-11 h-11 rounded-2xl accent-gradient text-white shadow-accent active:scale-90" aria-label="New target">
            <Plus size={20} />
          </button>
        </div>
      </section>

      {byCategory.map(({ cat, items }) => (
        <section key={cat.key}>
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <span className="text-[12px]">{cat.emoji}</span>
            <h2 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cat.color }}>{cat.label}</h2>
            <span className="text-[10px] font-semibold text-slate-300 dark:text-slate-600">{items.length}</span>
          </div>
          <div className="space-y-2">
            {items.map((t) => <TargetCard key={t.id} s={s} t={t} onEdit={() => onEdit(t)} />)}
          </div>
        </section>
      ))}

      {scheduled.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <CalendarClock size={12} className="text-slate-400" />
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Waiting in the wings</h2>
          </div>
          <div className="space-y-2">
            {scheduled.map((t) => (
              <button key={t.id} onClick={() => onEdit(t)} className="w-full flex items-center gap-2.5 rounded-2xl glass-subtle px-3.5 py-3 text-left active:scale-[0.99]">
                <span className="text-[17px]">{t.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 truncate">{t.title}</p>
                  <p className="text-[10.5px] text-slate-400 dark:text-slate-500">
                    {t.startDate > today ? `Starts ${t.startDate}` : `Finished ${t.endDate}`}
                    {t.renewal !== "none" ? ` · ${renewalLabel(t.renewal)}` : ""}
                  </p>
                </div>
                <ChevronRight size={15} className="text-slate-300 dark:text-slate-600" />
              </button>
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center gap-2 px-1 py-2 text-left"
          >
            <Archive size={12} className="text-slate-400" />
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Retired ({archived.length})
            </h2>
            <ChevronRight size={14} className={`ml-auto text-slate-300 dark:text-slate-600 transition-transform ${showArchived ? "rotate-90" : ""}`} />
          </button>
          {showArchived && (
            <div className="space-y-2 animate-in">
              {archived.map((t) => (
                <button key={t.id} onClick={() => onEdit(t)} className="w-full flex items-center gap-2.5 rounded-2xl glass-subtle px-3.5 py-3 text-left opacity-70 active:scale-[0.99]">
                  <span className="text-[17px] grayscale">{t.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-600 dark:text-slate-300 truncate">{t.title}</p>
                    <p className="text-[10.5px] text-slate-400 dark:text-slate-500">Retired · history kept · tap to restore</p>
                  </div>
                  <ChevronRight size={15} className="text-slate-300 dark:text-slate-600" />
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TargetCard({ s, t, onEdit }: { s: GameState; t: Target; onEdit: () => void }) {
  const today = todayKey();
  const cat = categoryOf(t.category);
  const prio = priorityOf(t.priority);
  const campaign = campaignOf(s, t, today);
  const quota = quotaOf(s, t, today);
  const term = termOn(t, today);

  // Last 14 scheduled days — a glance at whether this one actually happens.
  const dots = useMemo(() => {
    const out: { date: string; state: "hit" | "miss" | "off" }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      if (!isAliveOn(t, d) || !matchesCadence(t, d)) { out.push({ date: d, state: "off" }); continue; }
      out.push({ date: d, state: hits(t, logValue(s, d, t.id)) ? "hit" : "miss" });
    }
    return out;
  }, [s, t, today]);

  const recent = dots.filter((d) => d.state !== "off");
  const rate = recent.length ? Math.round((recent.filter((d) => d.state === "hit").length / recent.length) * 100) : null;

  return (
    <button onClick={onEdit} className="w-full rounded-2xl glass p-3.5 text-left active:scale-[0.99] transition-transform">
      <div className="flex items-start gap-2.5">
        <span className="grid place-items-center w-9 h-9 rounded-xl shrink-0 text-[17px]" style={{ background: `${cat.color}1f` }}>
          {t.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100 truncate">{t.title}</p>
            <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: `${prio.color}22`, color: prio.color }}>
              ×{prio.weight}
            </span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-slate-400 dark:text-slate-500 truncate">
            {cadenceLabel(t)}
            {t.measure === "number" ? ` · ${t.direction === "atMost" ? "max " : ""}${t.goal}${t.unit ? ` ${t.unit}` : ""}` : ""}
            {quota ? ` · ${quota.done}/${quota.need} ${quota.label}` : ""}
            {rate != null ? ` · ${rate}% last 14` : ""}
          </p>
          {t.endDate && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              <RefreshCw size={9} />
              {term?.end ? `Term ends ${term.end}` : `Until ${t.endDate}`}
              {t.renewal !== "none" ? ` · ${renewalLabel(t.renewal)}` : ""}
              {term && term.index > 0 ? ` · term ${term.index + 1}` : ""}
            </p>
          )}
        </div>
        <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 shrink-0 mt-1" />
      </div>

      {campaign && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            <span>{campaign.period.label}</span>
            <span>{Math.round(campaign.total * 10) / 10} / {campaign.goal}{t.unit ? ` ${t.unit}` : ""}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-900/8 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.round(campaign.progress * 100)}%`, background: cat.color }} />
          </div>
        </div>
      )}

      {/* 14-day consistency strip */}
      <div className="mt-2.5 flex gap-[3px]">
        {dots.map((d) => (
          <span
            key={d.date}
            title={d.date}
            className="flex-1 h-2 rounded-full"
            style={{
              background:
                d.state === "hit" ? cat.color : d.state === "miss" ? "rgba(244,63,94,0.3)" : "rgba(120,120,140,0.14)",
            }}
          />
        ))}
      </div>
    </button>
  );
}
