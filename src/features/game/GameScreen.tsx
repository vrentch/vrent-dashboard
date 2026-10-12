import { useEffect, useState } from "react";
import { ChevronLeft, Settings2, Swords, ListChecks, TrendingUp, Trophy } from "lucide-react";
import { type Target, useGame, todayKey } from "../../lib/game/store";
import { timeline, isSealed } from "../../lib/game/scoring";
import ArenaView from "./ArenaView";
import TargetsView from "./TargetsView";
import GrowthView from "./GrowthView";
import TrophiesView from "./TrophiesView";
import TargetEditor from "./TargetEditor";
import GameSettings from "./GameSettings";
import DayVerdict from "./DayVerdict";

// The Daily Game — four screens behind one header.
//   Arena    what's on the line today, and whether you're beating the rival
//   Targets  the board itself: add, adjust, retire
//   Growth   levels, streaks, 13 weeks of evidence
//   Trophies achievements, weekly/monthly/yearly medals, season recaps

type View = "arena" | "targets" | "growth" | "trophies";

const TABS: { key: View; label: string; icon: typeof Swords }[] = [
  { key: "arena", label: "Arena", icon: Swords },
  { key: "targets", label: "Targets", icon: ListChecks },
  { key: "growth", label: "Growth", icon: TrendingUp },
  { key: "trophies", label: "Trophies", icon: Trophy },
];

export default function GameScreen({ onBack }: { onBack: () => void }) {
  const s = useGame();
  const [view, setView] = useState<View>("arena");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Target | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [verdictDate, setVerdictDate] = useState<string | null>(null);

  const tl = timeline(s, todayKey());

  // Auto-raise the verdict once the day closes. Checked on mount, when the app
  // comes back to the foreground, and on a slow timer — so leaving the app open
  // through 22:00 still lands the moment.
  useEffect(() => {
    const check = () => {
      const today = todayKey();
      if (!isSealed(s, today)) return;
      if (s.meta.verdictSeen.includes(today)) return;
      const day = tl.byDate[today];
      // Nothing was due and nothing was logged — no drama to stage.
      if (!day || (day.dueCount === 0 && day.doneCount === 0 && day.bonusCount === 0)) return;
      setVerdictDate(today);
    };
    check();
    const id = setInterval(check, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [s, tl]);

  function openEditor(t: Target | null) {
    setEditing(t);
    setEditorOpen(true);
  }

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-2.5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <button onClick={onBack} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400 mb-0.5">
                <ChevronLeft size={14} /> Home
              </button>
              <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">
                The Daily Game
              </h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1 h-9 px-3 rounded-full glass text-[11.5px] font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                {tl.level.emoji} Lv {tl.level.level}
              </span>
              <button
                onClick={() => setSettingsOpen(true)}
                className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
                aria-label="Game settings"
              >
                <Settings2 size={18} />
              </button>
            </div>
          </div>

          <div className="mt-2.5 segment grid grid-cols-4 gap-0">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = view === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setView(t.key)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[12px] font-bold transition-all ${
                    active ? "segment-pill text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  <Icon size={13} strokeWidth={active ? 2.6 : 2} />
                  <span className="hidden min-[380px]:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-3.5">
        {view === "arena" && (
          <ArenaView
            s={s}
            onAddTarget={() => openEditor(null)}
            onEditTarget={openEditor}
            onVerdict={setVerdictDate}
            onTrophies={() => setView("trophies")}
          />
        )}
        {view === "targets" && <TargetsView s={s} onAdd={() => openEditor(null)} onEdit={openEditor} />}
        {view === "growth" && <GrowthView s={s} onTrophies={() => setView("trophies")} onDay={setVerdictDate} />}
        {view === "trophies" && <TrophiesView s={s} />}
      </div>

      <TargetEditor open={editorOpen} target={editing} onClose={() => { setEditorOpen(false); setEditing(null); }} />
      <GameSettings open={settingsOpen} s={s} onClose={() => setSettingsOpen(false)} />
      {verdictDate && (
        <DayVerdict
          date={verdictDate}
          onClose={() => setVerdictDate(null)}
          onGrowth={() => setView("growth")}
        />
      )}
    </div>
  );
}
