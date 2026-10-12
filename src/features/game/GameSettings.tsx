import { useState } from "react";
import { RotateCcw, Bell } from "lucide-react";
import Sheet from "../../components/Sheet";
import { type GameState, RIVALS, setSettings, resetGame } from "../../lib/game/store";
import { DIFFICULTIES } from "../../lib/game/scoring";
import { syncDayCloseTime } from "../../lib/push";

// How the game treats you. Defaults are deliberate: a 22:00 close, a rival
// just under your form, and late edits allowed — forgiving enough to survive a
// bad week, strict enough that the number means something.

export default function GameSettings({ open, s, onClose }: { open: boolean; s: GameState; onClose: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const st = s.settings;

  // Moving the close time moves the push whistle with it.
  function setClose(closeTime: string) {
    setSettings({ closeTime });
    syncDayCloseTime(closeTime);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Game settings">
      <div className="space-y-5">
        {/* ── The rival ─────────────────────────────────────────────────── */}
        <div>
          <Label>Your rival</Label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const i = RIVALS.findIndex((r) => r.emoji === st.rivalEmoji);
                const next = RIVALS[(i + 1) % RIVALS.length];
                setSettings({ rivalEmoji: next.emoji });
              }}
              className="grid place-items-center w-12 h-12 shrink-0 rounded-xl glass-subtle text-[24px] active:scale-95"
              aria-label="Change rival icon"
            >
              {st.rivalEmoji}
            </button>
            <input
              value={st.rivalName}
              onChange={(e) => setSettings({ rivalName: e.target.value.slice(0, 18) })}
              placeholder="Nemo"
              className="flex-1 min-w-0 rounded-xl glass-subtle px-3.5 text-[15px] font-semibold text-slate-900 dark:text-slate-100 outline-none"
            />
          </div>
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {RIVALS.map((r) => (
              <button
                key={r.name}
                onClick={() => setSettings({ rivalName: r.name, rivalEmoji: r.emoji })}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold ${
                  st.rivalName === r.name ? "accent-gradient-soft text-brand-600 dark:text-brand-300" : "glass-subtle text-slate-500 dark:text-slate-400"
                }`}
              >
                {r.emoji} {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Difficulty ────────────────────────────────────────────────── */}
        <div>
          <Label>How hard it plays</Label>
          <div className="space-y-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.key}
                onClick={() => setSettings({ difficulty: d.key })}
                className={`w-full text-left px-3.5 py-3 rounded-2xl transition-all active:scale-[0.99] ${
                  st.difficulty === d.key ? "accent-gradient text-white shadow-accent" : "glass-subtle"
                }`}
              >
                <p className={`text-[13px] font-bold ${st.difficulty === d.key ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>{d.label}</p>
                <p className={`text-[11px] mt-0.5 ${st.difficulty === d.key ? "text-white/75" : "text-slate-400 dark:text-slate-500"}`}>{d.blurb}</p>
              </button>
            ))}
          </div>
          <Hint>The rival's score is built from your own recent form, so changing this shifts it relative to you — it never becomes impossible or free.</Hint>
        </div>

        {/* ── The close ─────────────────────────────────────────────────── */}
        <div>
          <Label>When the day is scored</Label>
          <div className="flex gap-2 items-center">
            <input
              type="time"
              value={st.closeTime}
              onChange={(e) => setClose(e.target.value || "22:00")}
              className="rounded-xl glass-subtle px-3 py-2.5 text-[15px] font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none"
            />
            <div className="flex gap-1.5">
              {["21:00", "22:00", "23:00"].map((t) => (
                <button
                  key={t}
                  onClick={() => setClose(t)}
                  className={`px-2.5 py-2 rounded-lg text-[11.5px] font-bold tabular-nums ${
                    st.closeTime === t ? "accent-gradient-soft text-brand-600 dark:text-brand-300" : "glass-subtle text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setSettings({ lateEdits: !st.lateEdits })}
            className="mt-2.5 w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl glass-subtle text-left active:scale-[0.99]"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Allow late edits</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Keep logging after the close until midnight. The score re-settles honestly; the verdict only plays once.
              </p>
            </div>
            <span className={`relative w-11 h-7 rounded-full shrink-0 transition-colors ${st.lateEdits ? "accent-gradient" : "bg-slate-300 dark:bg-slate-700"}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${st.lateEdits ? "left-5" : "left-1"}`} />
            </span>
          </button>

          <div className="mt-2.5 flex items-start gap-1.5 rounded-2xl glass-subtle px-3.5 py-3">
            <Bell size={14} className="text-brand-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Want a push at the close? <strong className="text-slate-700 dark:text-slate-200">Settings → Notifications → Day close</strong> sends the
              whistle to your phone at this time.
            </p>
          </div>
        </div>

        {/* ── The streak line ───────────────────────────────────────────── */}
        <div>
          <Label>Streak line — the score that keeps it alive</Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={40}
              max={100}
              step={5}
              value={st.streakGoal}
              onChange={(e) => setSettings({ streakGoal: parseInt(e.target.value, 10) })}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-12 text-right text-[18px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{st.streakGoal}</span>
          </div>
          <Hint>
            {st.streakGoal >= 90
              ? "Brutal. Only near-perfect days count — expect short streaks."
              : st.streakGoal >= 70
                ? "A solid bar: most of the important things done, most days."
                : "Generous — good while you're still building the habit of showing up."}
          </Hint>
        </div>

        {/* ── Reset ─────────────────────────────────────────────────────── */}
        <div className="pt-1">
          <button
            onClick={() => {
              if (!confirmReset) { setConfirmReset(true); return; }
              resetGame();
              setConfirmReset(false);
              onClose();
            }}
            className={`w-full inline-flex items-center justify-center gap-1.5 h-12 rounded-2xl text-[13px] font-bold active:scale-[0.98] ${
              confirmReset ? "bg-rose-500 text-white" : "glass-subtle text-rose-600 dark:text-rose-400"
            }`}
          >
            <RotateCcw size={15} />
            {confirmReset ? "Yes — wipe targets, logs and trophies" : "Start the whole game over"}
          </button>
          {confirmReset && (
            <button onClick={() => setConfirmReset(false)} className="mt-2 w-full py-2 text-[12px] font-semibold text-slate-400">
              Cancel
            </button>
          )}
          <p className="mt-2 text-[10.5px] text-slate-400 dark:text-slate-500 text-center">
            Everything lives on this device only — nothing about your targets leaves the phone.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{children}</p>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-slate-400 dark:text-slate-500">{children}</p>;
}
