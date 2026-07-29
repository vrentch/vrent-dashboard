import { useState } from "react";
import Sheet from "../../components/Sheet";
import {
  usePrefs,
  setPrefs,
  toggleInList,
  activeWatchlist,
  setActiveWatchlist,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
} from "../../lib/store";
import { Plus, X, Trash2, ListPlus } from "lucide-react";

const SUGGESTIONS = [
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX",
  "^GSPC", "^IXIC", "NESN-CH", "NOVN-CH",
  "BTC-USD", "ETH-USD", "GC=F", "CL=F",
];

export default function WatchlistEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const active = activeWatchlist(prefs);
  const [input, setInput] = useState("");

  function add(sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || active.symbols.includes(s)) return;
    setPrefs({ watchlist: [...active.symbols, s] });
    setInput("");
  }

  return (
    <Sheet open={open} onClose={onClose} title="Watchlists">
      <div className="space-y-5">
        {/* Lists */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Your lists</h3>
          <div className="flex flex-wrap gap-2">
            {prefs.watchlists.map((w) => {
              const on = w.id === prefs.activeWatchlistId;
              return (
                <button
                  key={w.id}
                  onClick={() => setActiveWatchlist(w.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition active:scale-95 ${
                    on ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                  }`}
                >
                  {w.name} <span className={on ? "text-white/70" : "text-slate-400 dark:text-slate-500"}>{w.symbols.length}</span>
                </button>
              );
            })}
            <button
              onClick={() => createWatchlist(`List ${prefs.watchlists.length + 1}`)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/30 active:scale-95"
            >
              <ListPlus size={15} /> New
            </button>
          </div>
        </div>

        {/* Active list: rename + delete */}
        <div className="flex items-center gap-2">
          <input
            value={active.name}
            onChange={(e) => renameWatchlist(active.id, e.target.value)}
            className="flex-1 px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500 focus:bg-white"
            aria-label="List name"
          />
          {prefs.watchlists.length > 1 && (
            <button
              onClick={() => deleteWatchlist(active.id)}
              className="grid place-items-center w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 active:scale-95"
              aria-label="Delete list"
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>

        {/* Add symbol */}
        <div className="flex items-center gap-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus-within:border-brand-500 focus-within:bg-white transition">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && add(input)}
            placeholder={`Add to ${active.name}`}
            className="flex-1 bg-transparent py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none uppercase"
          />
          <button onClick={() => add(input)} className="grid place-items-center w-8 h-8 rounded-lg bg-slate-900 dark:bg-slate-700 text-white active:scale-95" aria-label="Add">
            <Plus size={18} />
          </button>
        </div>

        {/* Current symbols */}
        <div className="flex flex-wrap gap-2">
          {active.symbols.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-900 dark:text-slate-100">
              {s}
              <button
                onClick={() => setPrefs({ watchlist: toggleInList(active.symbols, s) })}
                className="grid place-items-center w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 active:scale-90"
                aria-label={`Remove ${s}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {!active.symbols.length && <p className="text-sm text-slate-400 dark:text-slate-500">No symbols yet — add some.</p>}
        </div>

        {/* Suggestions */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Popular</h3>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.filter((s) => !active.symbols.includes(s)).map((s) => (
              <button
                key={s}
                onClick={() => add(s)}
                className="px-3 py-1.5 rounded-full bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 text-sm font-medium text-brand-700 dark:text-brand-300 active:scale-95"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
