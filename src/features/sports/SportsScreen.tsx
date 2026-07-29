import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronRight } from "lucide-react";
import { fetchScores, type Game, type ScoresResponse } from "../../lib/api";
import { SPORTS, type League, type Sport } from "../../data/sports";
import GameRow from "./GameRow";
import LeagueView from "./LeagueView";

// How many of a sport's leagues to aggregate for the top overview.
const FEATURED = 5;

export default function SportsScreen() {
  const [sport, setSport] = useState<Sport>(SPORTS[0]);
  const [scoresByLeague, setScoresByLeague] = useState<Record<string, ScoresResponse>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openLeague, setOpenLeague] = useState<League | null>(null);

  const featured = useMemo(() => sport.leagues.slice(0, FEATURED), [sport]);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        const results = await Promise.allSettled(featured.map((l) => fetchScores(sport.key, l.key)));
        const map: Record<string, ScoresResponse> = {};
        results.forEach((r, i) => {
          if (r.status === "fulfilled") map[featured[i].key] = r.value;
        });
        setScoresByLeague(map);
      } catch {
        /* tiles fall back to their static labels */
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [sport, featured]
  );

  useEffect(() => {
    setScoresByLeague({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport.key]);

  // Merge every featured league's games into one live-first overview.
  const overview = useMemo(() => {
    const all: (Game & { leagueKey: string })[] = [];
    for (const l of featured) {
      const games = scoresByLeague[l.key]?.games ?? [];
      for (const g of games) all.push({ ...g, leagueKey: l.key });
    }
    const live = all.filter((g) => g.state === "in");
    const soon = all
      .filter((g) => g.state === "pre" && g.date)
      .sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
    const recent = all
      .filter((g) => g.state === "post" && g.date)
      .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
    return [...live, ...soon.slice(0, 8), ...recent.slice(0, 4)].slice(0, 12);
  }, [scoresByLeague, featured]);

  const isTennis = sport.key === "tennis";

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Sports</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">Scores, fixtures & tables</p>
          </div>
          <button
            onClick={() => load(true)}
            className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        {/* Sport switcher */}
        <div className="max-w-lg mx-auto px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {SPORTS.map((s) => {
            const active = s.key === sport.key;
            return (
              <button
                key={s.key}
                onClick={() => setSport(s)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${
                  active
                    ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700"
                    : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"
                }`}
              >
                <span>{s.icon}</span> {s.name}
              </button>
            );
          })}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {/* Overview carousel */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            {overview.some((g) => g.state === "in") ? "🔴 Live & upcoming" : "Upcoming & recent"}
          </h2>
          {loading ? (
            <div className="flex gap-3 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-64 h-[104px] rounded-2xl skeleton shrink-0" />
              ))}
            </div>
          ) : overview.length ? (
            <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1 snap-x">
              {overview.map((g) => (
                <div key={g.leagueKey + g.id} className="w-64 shrink-0 snap-start">
                  <GameRow g={g} showTournament={isTennis} />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl glass-subtle p-5 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No games in the top {sport.name.toLowerCase()} competitions right now.</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Open a competition below to see fixtures & tables.</p>
            </div>
          )}
        </section>

        {/* League tiles */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Competitions</h2>
          <div className="grid grid-cols-2 gap-3">
            {sport.leagues.map((l) => {
              const games = scoresByLeague[l.key]?.games ?? [];
              const liveCount = games.filter((g) => g.state === "in").length;
              const sub = leagueSubtitle(games, liveCount);
              return (
                <button
                  key={l.key}
                  onClick={() => setOpenLeague(l)}
                  className="text-left rounded-2xl glass p-4 active:scale-[0.98] transition"
                >
                  <div className="flex items-start justify-between">
                    <span className="text-2xl leading-none">{l.flag}</span>
                    {liveCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> {liveCount}
                      </span>
                    ) : (
                      <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 mt-1" />
                    )}
                  </div>
                  <h3 className="mt-2 text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-tight">{l.name}</h3>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <LeagueView open={!!openLeague} onClose={() => setOpenLeague(null)} sport={sport} league={openLeague} />
    </div>
  );
}

function leagueSubtitle(games: Game[], liveCount: number): string {
  if (liveCount > 0) return `${liveCount} live now`;
  const next = games
    .filter((g) => g.state === "pre" && g.date)
    .sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!))[0];
  if (next?.date) {
    const d = new Date(next.date);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return "Next · " + (sameDay ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  }
  const done = games.filter((g) => g.state === "post").length;
  if (done) return `${done} result${done > 1 ? "s" : ""}`;
  return "Fixtures & table";
}
