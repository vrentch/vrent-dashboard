import { useEffect, useMemo, useState } from "react";
import Sheet from "../../components/Sheet";
import GameRow from "./GameRow";
import StandingsTable from "./StandingsTable";
import { fetchScores, fetchStandings, type Game, type ScoresResponse, type StandingsResponse } from "../../lib/api";
import type { League, Sport } from "../../data/sports";

type TabKey = "matches" | "table";

export default function LeagueView({ open, onClose, sport, league }: { open: boolean; onClose: () => void; sport: Sport | null; league: League | null }) {
  const [tab, setTab] = useState<TabKey>("matches");
  const [scores, setScores] = useState<ScoresResponse | null>(null);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setTab("matches");
  }, [open, league?.key]);

  useEffect(() => {
    if (!open || !sport || !league) return;
    let cancelled = false;
    setLoading(true);
    setScores(null);
    setStandings(null);
    fetchScores(sport.key, league.key)
      .then((r) => !cancelled && setScores(r))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    if (league.standings) {
      fetchStandings(sport.key, league.key)
        .then((r) => !cancelled && setStandings(r))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [open, sport, league]);

  const grouped = useMemo(() => groupGames(scores?.games ?? []), [scores]);
  const isTennis = sport?.key === "tennis";

  return (
    <Sheet open={open} onClose={onClose} title={`${league?.flag ?? ""} ${league?.name ?? ""}`}>
      {/* Segmented control */}
      {league?.standings && (
        <div className="flex p-1 mb-4 rounded-xl glass-subtle">
          {(["matches", "table"] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition ${
                tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {t === "matches" ? "Matches" : "Table"}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[92px] rounded-2xl skeleton" />
          ))}
        </div>
      )}

      {!loading && tab === "table" && standings && <StandingsTable data={standings} />}
      {!loading && tab === "table" && !standings && (
        <p className="text-center py-14 text-sm text-slate-500 dark:text-slate-400">No table available.</p>
      )}

      {!loading && tab === "matches" && (
        <div className="space-y-5">
          {scores?.season && (
            <p className="text-xs text-slate-400 dark:text-slate-500 -mt-1">{scores.season}</p>
          )}
          {grouped.live.length > 0 && (
            <Section label="🔴 Live now" games={grouped.live} showTournament={isTennis} />
          )}
          {grouped.upcoming.length > 0 && (
            <Section label={isTennis ? "Upcoming" : "Fixtures"} games={grouped.upcoming} showTournament={isTennis} />
          )}
          {grouped.finished.length > 0 && (
            <Section label="Results" games={grouped.finished} showTournament={isTennis} />
          )}
          {grouped.live.length + grouped.upcoming.length + grouped.finished.length === 0 && (
            <div className="text-center py-14">
              <p className="text-sm text-slate-500 dark:text-slate-400">No matches scheduled right now.</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Check back on a match day.</p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Section({ label, games, showTournament }: { label: string; games: Game[]; showTournament?: boolean }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{label}</h3>
      <div className="space-y-2.5">
        {games.map((g) => (
          <GameRow key={g.id} g={g} showTournament={showTournament} />
        ))}
      </div>
    </div>
  );
}

function groupGames(games: Game[]) {
  const live = games.filter((g) => g.state === "in");
  const upcoming = games
    .filter((g) => g.state === "pre")
    .sort((a, b) => (a.date ? Date.parse(a.date) : 0) - (b.date ? Date.parse(b.date) : 0));
  const finished = games
    .filter((g) => g.state === "post")
    .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
  return { live, upcoming, finished };
}
