import type { StandingsResponse, TableEntry } from "../../lib/api";

export default function StandingsTable({ data }: { data: StandingsResponse }) {
  const { hasDraws, groups } = data;
  return (
    <div className="space-y-5">
      {groups.map((grp, gi) => (
        <div key={gi}>
          {(groups.length > 1 || grp.name) && grp.name && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{grp.name}</h3>
          )}
          <div className="rounded-2xl glass-subtle overflow-hidden">
            <div className="grid items-center gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-white/40 dark:border-white/5"
              style={{ gridTemplateColumns: `1.5rem 1fr ${hasDraws ? "repeat(5, 1.4rem)" : "repeat(3, 1.8rem)"}` }}>
              <span>#</span>
              <span>Team</span>
              {hasDraws ? (
                <>
                  <span className="text-right">P</span>
                  <span className="text-right">W</span>
                  <span className="text-right">D</span>
                  <span className="text-right">L</span>
                  <span className="text-right font-bold text-slate-500 dark:text-slate-300">Pts</span>
                </>
              ) : (
                <>
                  <span className="text-right">W</span>
                  <span className="text-right">L</span>
                  <span className="text-right font-bold text-slate-500 dark:text-slate-300">Pct</span>
                </>
              )}
            </div>
            <div className="divide-y divide-white/40 dark:divide-white/5">
              {grp.entries.map((e, i) => (
                <TableRow key={e.name + i} e={e} i={i} hasDraws={hasDraws} />
              ))}
            </div>
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="text-center py-14 text-sm text-slate-500 dark:text-slate-400">No table available yet.</p>
      )}
    </div>
  );
}

function TableRow({ e, i, hasDraws }: { e: TableEntry; i: number; hasDraws: boolean }) {
  const rank = e.rank || String(i + 1);
  return (
    <div className="grid items-center gap-2 px-3 py-2 text-[13px]"
      style={{ gridTemplateColumns: `1.5rem 1fr ${hasDraws ? "repeat(5, 1.4rem)" : "repeat(3, 1.8rem)"}` }}>
      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 tabular-nums">{rank}</span>
      <div className="flex items-center gap-2 min-w-0">
        {e.logo ? (
          <img src={e.logo} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />
        ) : (
          <span className="w-5 h-5 shrink-0 rounded bg-slate-200/70 dark:bg-slate-700" />
        )}
        <span className="truncate font-semibold text-slate-900 dark:text-slate-100">{e.name}</span>
      </div>
      {hasDraws ? (
        <>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.played || "—"}</span>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.win || "—"}</span>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.draw || "—"}</span>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.loss || "—"}</span>
          <span className="text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">{e.pts || "0"}</span>
        </>
      ) : (
        <>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.win || "—"}</span>
          <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{e.loss || "—"}</span>
          <span className="text-right tabular-nums font-bold text-slate-900 dark:text-slate-100">{e.pct || "—"}</span>
        </>
      )}
    </div>
  );
}
