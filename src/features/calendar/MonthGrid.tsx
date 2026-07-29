import { categoryOf, toKey, todayKey, type CalEvent } from "../../lib/calendar";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export default function MonthGrid({
  month,
  events,
  selected,
  onSelectDay,
  onPrev,
  onNext,
}: {
  month: Date; // any day within the month
  events: CalEvent[];
  selected: string;
  onSelectDay: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const firstWeekday = (new Date(year, m, 1).getDay() + 6) % 7; // Monday-first
  const today = todayKey();

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toKey(new Date(year, m, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  const dotsFor = (key: string) => {
    const cats = [...new Set(events.filter((e) => e.date === key).map((e) => e.category))].slice(0, 3);
    return cats;
  };

  return (
    <div className="rounded-2xl glass p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <button onClick={onPrev} className="grid place-items-center w-8 h-8 rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-800" aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <button onClick={onNext} className="grid place-items-center w-8 h-8 rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-800" aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WD.map((w) => (
          <div key={w} className="text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((key, i) => {
          if (!key) return <div key={i} />;
          const day = parseInt(key.slice(-2), 10);
          const isToday = key === today;
          const isSel = key === selected;
          const dots = dotsFor(key);
          return (
            <button key={key} onClick={() => onSelectDay(key)} className="flex flex-col items-center py-1">
              <span
                className={`grid place-items-center w-9 h-9 rounded-full text-sm font-semibold ${
                  isSel
                    ? "bg-brand-600 text-white"
                    : isToday
                    ? "text-brand-600 dark:text-brand-400 ring-1 ring-brand-400"
                    : "text-slate-700 dark:text-slate-300"
                }`}
              >
                {day}
              </span>
              <span className="flex gap-0.5 h-1.5 mt-0.5">
                {dots.map((c, j) => (
                  <span key={j} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: categoryOf(c).color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
