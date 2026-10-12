import { useEffect, useMemo, useState } from "react";
import { Trash2, Archive, Copy, Info } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  type Target, type TargetDraft, type Priority, type Horizon, type Renewal, type CadenceKind,
  CATEGORIES, PRIORITIES, categoryOf, newDraft, addTarget, updateTarget, removeTarget, archiveTarget, duplicateTarget,
  todayKey, addDays, addMonths, renewalLabel,
} from "../../lib/game/store";
import { cadenceLabel } from "../../lib/game/scoring";

// Add or adjust a target. Everything the model supports is reachable here, but
// the sheet opens on the five decisions that matter (what, how often, how much
// it counts) and keeps the long tail — timeline, end date, renewal — folded
// away under "More".

const EMOJI = ["🎯", "🚀", "💼", "📞", "📥", "📊", "✍️", "🏋️", "🚶", "😴", "🥗", "💧", "🧠", "📖", "🎧", "🎨", "🎸", "💰", "🧾", "🤝", "❤️", "🏠", "🧹", "🚫", "🌙", "☀️", "⚡", "🔥"];

const CADENCES: { key: CadenceKind; label: string }[] = [
  { key: "daily", label: "Every day" },
  { key: "weekdays", label: "Mon–Fri" },
  { key: "weekends", label: "Weekends" },
  { key: "days", label: "Pick days" },
  { key: "timesPerWeek", label: "×/week" },
  { key: "timesPerMonth", label: "×/month" },
  { key: "once", label: "One-off" },
];

const HORIZONS: { key: Horizon; label: string; hint: string }[] = [
  { key: "day", label: "Daily habit", hint: "Scored each day, nothing accumulates." },
  { key: "week", label: "Weekly", hint: "Daily logs add up to a weekly total." },
  { key: "month", label: "Monthly", hint: "Daily logs add up to a monthly total." },
  { key: "quarter", label: "Quarterly", hint: "A 3-month campaign." },
  { key: "year", label: "Yearly", hint: "The long game — a whole year to deliver." },
];

const RENEWALS: { key: Renewal; label: string }[] = [
  { key: "none", label: "Retire it" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "yearly", label: "Yearly" },
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

export default function TargetEditor({
  open, target, onClose,
}: { open: boolean; target: Target | null; onClose: () => void }) {
  const [d, setD] = useState<TargetDraft>(newDraft());
  const [more, setMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMore(false);
    setConfirmDelete(false);
    if (target) {
      const { id: _id, createdAt: _c, updatedAt: _u, archived, ...rest } = target;
      setD({ ...rest, archived });
    } else {
      setD(newDraft());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  const patch = (p: Partial<TargetDraft>) => setD((prev) => ({ ...prev, ...p }));
  const cat = categoryOf(d.category);
  const isNumber = d.measure === "number";
  const isQuota = d.cadence.kind === "timesPerWeek" || d.cadence.kind === "timesPerMonth";
  const valid = d.title.trim().length > 0 && (!isNumber || d.goal > 0 || d.direction === "atMost");

  const preview = useMemo(() => {
    const bits = [cadenceLabel({ ...d, id: "", archived: false, createdAt: 0, updatedAt: 0 } as Target)];
    if (isNumber) bits.push(`${d.direction === "atMost" ? "max " : ""}${d.goal}${d.unit ? ` ${d.unit}` : ""}`);
    bits.push(PRIORITIES.find((p) => p.key === d.priority)!.short.toLowerCase() + " priority");
    if (d.endDate) bits.push(`until ${d.endDate}${d.renewal !== "none" ? `, ${renewalLabel(d.renewal)}` : ""}`);
    return bits.join(" · ");
  }, [d, isNumber]);

  function save() {
    if (!valid) return;
    const clean: TargetDraft = {
      ...d,
      title: d.title.trim(),
      goal: isNumber ? d.goal : d.direction === "atMost" ? 0 : 1,
      unit: isNumber ? d.unit.trim() : "",
      campaignGoal: d.horizon !== "day" && d.campaignGoal && d.campaignGoal > 0 ? d.campaignGoal : undefined,
      endDate: d.endDate || undefined,
      renewal: d.endDate ? d.renewal : "none",
      cadence: {
        kind: d.cadence.kind,
        days: d.cadence.kind === "days" ? (d.cadence.days?.length ? d.cadence.days : [1, 2, 3, 4, 5]) : undefined,
        times: isQuota ? Math.max(1, d.cadence.times || 3) : undefined,
        date: d.cadence.kind === "once" ? d.cadence.date || d.startDate : undefined,
      },
    };
    if (target) updateTarget(target.id, clean);
    else addTarget(clean);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={target ? "Adjust target" : "New target"}
      footer={
        <div className="flex gap-2">
          {target && (
            <button
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                removeTarget(target.id);
                onClose();
              }}
              className={`grid place-items-center h-12 px-4 rounded-2xl text-[13px] font-bold active:scale-95 ${
                confirmDelete ? "bg-rose-500 text-white" : "glass-subtle text-rose-600 dark:text-rose-400"
              }`}
            >
              {confirmDelete ? "Delete for good" : <Trash2 size={17} />}
            </button>
          )}
          <button
            onClick={save}
            disabled={!valid}
            className="flex-1 h-12 rounded-2xl accent-gradient text-white text-[14px] font-bold shadow-accent active:scale-[0.98] disabled:opacity-40"
          >
            {target ? "Save changes" : "Add to the board"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── What ─────────────────────────────────────────────────────── */}
        <div>
          <Label>The target</Label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const i = EMOJI.indexOf(d.emoji);
                patch({ emoji: EMOJI[(i + 1) % EMOJI.length] });
              }}
              className="grid place-items-center w-12 h-12 shrink-0 rounded-xl glass-subtle text-[22px] active:scale-95"
              aria-label="Change icon"
            >
              {d.emoji}
            </button>
            <input
              value={d.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Ship one improvement"
              autoFocus={!target}
              className="flex-1 min-w-0 rounded-xl glass-subtle px-3.5 text-[15px] font-semibold text-slate-900 dark:text-slate-100 outline-none"
            />
          </div>
          <div className="mt-2 flex gap-1 flex-wrap">
            {EMOJI.slice(0, 14).map((e) => (
              <button
                key={e}
                onClick={() => patch({ emoji: e })}
                className={`grid place-items-center w-8 h-8 rounded-lg text-[15px] transition-transform active:scale-90 ${
                  d.emoji === e ? "accent-gradient-soft ring-1 ring-brand-400" : "glass-subtle"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* ── Area of life ─────────────────────────────────────────────── */}
        <div>
          <Label>Area</Label>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => patch({ category: c.key })}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all active:scale-95 ${
                  d.category === c.key ? "text-white" : "glass-subtle text-slate-600 dark:text-slate-300"
                }`}
                style={d.category === c.key ? { background: c.color, boxShadow: `0 6px 18px ${c.color}55` } : undefined}
              >
                <span>{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── How it's measured ────────────────────────────────────────── */}
        <div>
          <Label>How you score it</Label>
          <div className="segment grid grid-cols-2 gap-0 mb-2.5">
            {([["check", "Tick it off"], ["number", "Log a number"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => patch({ measure: k, goal: k === "check" ? 1 : d.goal > 1 ? d.goal : 10, unit: k === "check" ? "" : d.unit || "min" })}
                className={`py-2 rounded-[9px] text-[12.5px] font-bold transition-all ${
                  d.measure === k ? "segment-pill text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="segment grid grid-cols-2 gap-0">
            {([["atLeast", isNumber ? "Hit at least" : "Do it"], ["atMost", isNumber ? "Stay under" : "Avoid it"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => patch({ direction: k, goal: k === "atMost" && !isNumber ? 0 : d.goal })}
                className={`py-2 rounded-[9px] text-[12.5px] font-bold transition-all ${
                  d.direction === k ? "segment-pill text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {isNumber && (
            <div className="mt-2.5 flex gap-2">
              <input
                value={d.goal === 0 ? "0" : String(d.goal)}
                onChange={(e) => patch({ goal: Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0) })}
                type="text" inputMode="decimal"
                className="w-28 rounded-xl glass-subtle px-3 py-2.5 text-[17px] font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
              />
              <input
                value={d.unit}
                onChange={(e) => patch({ unit: e.target.value.slice(0, 12) })}
                placeholder="min / km / calls"
                className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2.5 text-[13.5px] text-slate-900 dark:text-slate-100 outline-none"
              />
            </div>
          )}
          {!isNumber && d.direction === "atMost" && (
            <Hint>A target you keep clean. It counts as done by default — tap it on the board only if you slipped.</Hint>
          )}
        </div>

        {/* ── How often ────────────────────────────────────────────────── */}
        <div>
          <Label>How often</Label>
          <div className="flex gap-1.5 flex-wrap">
            {CADENCES.map((c) => (
              <button
                key={c.key}
                onClick={() => patch({ cadence: { ...d.cadence, kind: c.key, date: c.key === "once" ? d.cadence.date || todayKey() : d.cadence.date } })}
                className={`px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all active:scale-95 ${
                  d.cadence.kind === c.key ? "accent-gradient text-white shadow-accent" : "glass-subtle text-slate-600 dark:text-slate-300"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {d.cadence.kind === "days" && (
            <div className="mt-2.5 grid grid-cols-7 gap-1">
              {DAY_VALUES.map((v, i) => {
                const on = (d.cadence.days || []).includes(v);
                return (
                  <button
                    key={v}
                    onClick={() => {
                      const days = d.cadence.days || [];
                      patch({ cadence: { ...d.cadence, days: on ? days.filter((x) => x !== v) : [...days, v] } });
                    }}
                    className={`py-2 rounded-xl text-[11px] font-bold transition-all active:scale-90 ${
                      on ? "accent-gradient text-white" : "glass-subtle text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {DAY_NAMES[i]}
                  </button>
                );
              })}
            </div>
          )}

          {isQuota && (
            <>
              <div className="mt-2.5 flex items-center gap-2">
                <Stepper
                  value={d.cadence.times || 3}
                  min={1}
                  max={d.cadence.kind === "timesPerWeek" ? 7 : 28}
                  onChange={(times) => patch({ cadence: { ...d.cadence, times } })}
                />
                <span className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                  times {d.cadence.kind === "timesPerWeek" ? "a week" : "a month"}
                </span>
              </div>
              <Hint>Flexible: it sits on the board as optional, and turns required once you can no longer afford to skip it.</Hint>
            </>
          )}

          {d.cadence.kind === "once" && (
            <div className="mt-2.5">
              <input
                type="date"
                value={d.cadence.date || todayKey()}
                onChange={(e) => patch({ cadence: { ...d.cadence, date: e.target.value } })}
                className="rounded-xl glass-subtle px-3 py-2.5 text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 outline-none"
              />
            </div>
          )}
        </div>

        {/* ── Priority ─────────────────────────────────────────────────── */}
        <div>
          <Label>Priority — how much the day score cares</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p.key}
                onClick={() => patch({ priority: p.key as Priority })}
                className={`py-2.5 rounded-xl text-center transition-all active:scale-95 ${
                  d.priority === p.key ? "text-white" : "glass-subtle text-slate-600 dark:text-slate-300"
                }`}
                style={d.priority === p.key ? { background: p.color, boxShadow: `0 6px 18px ${p.color}55` } : undefined}
              >
                <span className="block text-[12px] font-bold">{p.short}</span>
                <span className={`block text-[9.5px] ${d.priority === p.key ? "text-white/75" : "text-slate-400 dark:text-slate-500"}`}>×{p.weight}</span>
              </button>
            ))}
          </div>
          <Hint>{PRIORITIES.find((p) => p.key === d.priority)!.label} — carries {PRIORITIES.find((p) => p.key === d.priority)!.weight}× the weight of a "nice to have" in the daily score.</Hint>
        </div>

        {/* ── More: timeline, dates, renewal ───────────────────────────── */}
        {!more ? (
          <button onClick={() => setMore(true)} className="w-full py-3 rounded-2xl glass-subtle text-[12.5px] font-semibold text-brand-600 dark:text-brand-400">
            More — timeline, end date, renewal
          </button>
        ) : (
          <div className="space-y-5 animate-in">
            <div>
              <Label>Timeline</Label>
              <div className="flex gap-1.5 flex-wrap">
                {HORIZONS.map((h) => (
                  <button
                    key={h.key}
                    onClick={() => patch({ horizon: h.key, campaignGoal: h.key === "day" ? undefined : d.campaignGoal || (isNumber ? d.goal * 20 : 20) })}
                    className={`px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all active:scale-95 ${
                      d.horizon === h.key ? "accent-gradient text-white shadow-accent" : "glass-subtle text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
              <Hint>{HORIZONS.find((h) => h.key === d.horizon)!.hint}</Hint>

              {d.horizon !== "day" && (
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    value={d.campaignGoal != null ? String(d.campaignGoal) : ""}
                    onChange={(e) => patch({ campaignGoal: Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0) })}
                    type="text" inputMode="decimal" placeholder="total"
                    className="w-28 rounded-xl glass-subtle px-3 py-2.5 text-[17px] font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
                  />
                  <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">
                    {d.unit || (isNumber ? "units" : "times")} in total, {d.horizon === "week" ? "per week" : d.horizon === "month" ? "per month" : d.horizon === "quarter" ? "per quarter" : "per year"}
                  </span>
                </div>
              )}
            </div>

            <div>
              <Label>Runs from</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={d.startDate}
                  onChange={(e) => patch({ startDate: e.target.value || todayKey() })}
                  className="flex-1 rounded-xl glass-subtle px-3 py-2.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100 outline-none"
                />
                <span className="text-[12px] text-slate-400">to</span>
                <input
                  type="date"
                  value={d.endDate || ""}
                  min={d.startDate}
                  onChange={(e) => patch({ endDate: e.target.value || undefined })}
                  className="flex-1 rounded-xl glass-subtle px-3 py-2.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {([["No end", undefined], ["30 days", addDays(d.startDate, 29)], ["3 months", addMonths(d.startDate, 3)], ["End of year", `${d.startDate.slice(0, 4)}-12-31`]] as const).map(([l, v]) => (
                  <button
                    key={l}
                    onClick={() => patch({ endDate: v })}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                      (d.endDate || undefined) === v ? "accent-gradient-soft text-brand-600 dark:text-brand-300" : "glass-subtle text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {d.endDate && (
              <div>
                <Label>When it ends</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {RENEWALS.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => patch({ renewal: r.key })}
                      className={`px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-all active:scale-95 ${
                        d.renewal === r.key ? "accent-gradient text-white shadow-accent" : "glass-subtle text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Hint>
                  {d.renewal === "none"
                    ? "It leaves the board for good on that date — history kept."
                    : `The whole window shifts forward ${d.renewal === "weekly" ? "a week" : d.renewal === "monthly" ? "a month" : d.renewal === "quarterly" ? "a quarter" : "a year"} and the target comes back for another term.`}
                </Hint>
              </div>
            )}

            <div>
              <Label>Note to yourself (optional)</Label>
              <textarea
                value={d.note || ""}
                onChange={(e) => patch({ note: e.target.value.slice(0, 280) })}
                rows={2}
                placeholder="Why this one matters…"
                className="w-full rounded-xl glass-subtle px-3 py-2.5 text-[13px] text-slate-900 dark:text-slate-100 outline-none resize-none"
              />
            </div>

            {target && (
              <div className="flex gap-2">
                <button
                  onClick={() => { archiveTarget(target.id, !target.archived); onClose(); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-2xl glass-subtle text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 active:scale-95"
                >
                  <Archive size={15} /> {target.archived ? "Put back on the board" : "Retire (keep history)"}
                </button>
                <button
                  onClick={() => { duplicateTarget(target.id); onClose(); }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl glass-subtle text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 active:scale-95"
                >
                  <Copy size={15} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live summary so the rules are never a mystery */}
        <div className="rounded-2xl p-3.5" style={{ background: `${cat.color}14`, border: `1px solid ${cat.color}33` }}>
          <div className="flex items-center gap-2">
            <span className="text-[20px]">{d.emoji}</span>
            <p className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100 truncate">{d.title || "Your target"}</p>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">{preview}</p>
        </div>
      </div>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{children}</p>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
      <Info size={12} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </p>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-xl glass-subtle overflow-hidden">
      <button onClick={() => onChange(Math.max(min, value - 1))} className="w-10 h-10 text-[18px] font-bold text-slate-500 dark:text-slate-400 active:scale-90">−</button>
      <span className="w-10 text-center text-[16px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="w-10 h-10 text-[18px] font-bold text-slate-500 dark:text-slate-400 active:scale-90">＋</button>
    </div>
  );
}
