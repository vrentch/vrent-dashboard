import type { Game, GameSide } from "../../lib/api";

/** Local, timezone-aware time/label for a fixture. */
function whenLabel(g: Game): string {
  if (!g.date) return g.detail || "";
  const d = new Date(g.date);
  if (isNaN(d.getTime())) return g.detail || "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " · " + time;
}

function StatusPill({ g }: { g: Game }) {
  if (g.state === "in") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-bold">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
        {g.clock || g.detail || "LIVE"}
      </span>
    );
  }
  if (g.state === "post") {
    return <span className="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 dark:text-slate-400 text-[11px] font-bold">{g.detail || "Final"}</span>;
  }
  return <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{whenLabel(g)}</span>;
}

function Row({ side, g }: { side: GameSide | null; g: Game }) {
  if (!side) return null;
  const showScore = g.state !== "pre" && side.score !== "";
  const dim = g.state === "post" && !side.winner;
  return (
    <div className="flex items-center gap-2.5">
      {side.logo ? (
        <img src={side.logo} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />
      ) : (
        <span className="w-5 h-5 grid place-items-center text-[10px] shrink-0 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold">
          {side.abbrev.slice(0, 3) || "?"}
        </span>
      )}
      <span className={`flex-1 min-w-0 truncate text-sm ${dim ? "text-slate-400 dark:text-slate-500" : "font-semibold text-slate-900 dark:text-slate-100"}`}>
        {side.name}
      </span>
      {side.winner && g.state === "post" && <span className="text-emerald-500 text-xs">▸</span>}
      {showScore && (
        <span className={`tabular-nums text-sm font-bold ${dim ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>
          {side.score}
        </span>
      )}
    </div>
  );
}

export default function GameRow({ g, showTournament }: { g: Game; showTournament?: boolean }) {
  return (
    <div className="rounded-2xl glass-subtle p-3">
      <div className="flex items-center justify-between mb-2">
        {showTournament && g.tournament ? (
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate pr-2">{g.tournament}{g.round ? ` · ${g.round}` : ""}</span>
        ) : (
          <span />
        )}
        <StatusPill g={g} />
      </div>
      <div className="space-y-1.5">
        <Row side={g.home} g={g} />
        <Row side={g.away} g={g} />
      </div>
      {g.note && <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 truncate">{g.note}</p>}
    </div>
  );
}
