import { useEffect, useState } from "react";
import { allStatuses } from "../lib/marketStatus";

export default function MarketStatusBar() {
  const [statuses, setStatuses] = useState(() => allStatuses());

  // Refresh every minute so open/closed and countdowns stay current.
  useEffect(() => {
    const id = setInterval(() => setStatuses(allStatuses()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
      {statuses.map((s) => (
        <div
          key={s.key}
          className="shrink-0 flex items-center gap-2 pl-2.5 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/60 card-shadow"
        >
          <span className="text-base leading-none">{s.flag}</span>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${s.open ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{s.name}</span>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{s.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
