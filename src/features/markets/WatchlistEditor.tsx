import { useState } from "react";
import Sheet from "../../components/Sheet";
import { usePrefs, setPrefs, toggleInList } from "../../lib/store";
import { Plus, X } from "lucide-react";

const SUGGESTIONS = [
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX",
  "^GSPC", "^IXIC", "^DJI", "^GDAXI",
  "BTC-USD", "ETH-USD", "EURUSD=X", "GC=F", "CL=F",
];

export default function WatchlistEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const [input, setInput] = useState("");

  function add(sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s || prefs.watchlist.includes(s)) return;
    setPrefs({ watchlist: [...prefs.watchlist, s] });
    setInput("");
  }

  return (
    <Sheet open={open} onClose={onClose} title="Edit watchlist">
      <div className="space-y-5">
        <div className="flex items-center gap-2 px-3 rounded-xl bg-slate-100 border border-slate-200 focus-within:border-brand-500 focus-within:bg-white transition">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && add(input)}
            placeholder="Add symbol e.g. AAPL, BTC-USD"
            className="flex-1 bg-transparent py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none uppercase"
          />
          <button
            onClick={() => add(input)}
            className="grid place-items-center w-8 h-8 rounded-lg bg-slate-900 text-white active:scale-95"
            aria-label="Add"
          >
            <Plus size={18} />
          </button>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Your symbols ({prefs.watchlist.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {prefs.watchlist.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-sm font-medium text-slate-900"
              >
                {s}
                <button
                  onClick={() => setPrefs({ watchlist: toggleInList(prefs.watchlist, s) })}
                  className="grid place-items-center w-5 h-5 rounded-full bg-slate-200 text-slate-500 active:scale-90"
                  aria-label={`Remove ${s}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {!prefs.watchlist.length && <p className="text-sm text-slate-400">No symbols yet — add some below.</p>}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Popular</h3>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.filter((s) => !prefs.watchlist.includes(s)).map((s) => (
              <button
                key={s}
                onClick={() => add(s)}
                className="px-3 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-sm font-medium text-brand-700 active:scale-95"
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
