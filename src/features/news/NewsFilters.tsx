import { useState } from "react";
import Sheet from "../../components/Sheet";
import TopicIcon from "../../components/TopicIcon";
import { COUNTRIES, TOPICS } from "../../../shared/catalog";
import { usePrefs, setPrefs, toggleInList } from "../../lib/store";
import { RotateCcw, Search } from "lucide-react";

export default function NewsFilters({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const [q, setQ] = useState(prefs.newsQuery);

  function apply() {
    setPrefs({ newsQuery: q.trim() });
    onClose();
  }

  const footer = (
    <div className="flex items-center gap-3">
      <button
        onClick={() => {
          setPrefs({ countries: [], topics: [], newsQuery: "" });
          setQ("");
        }}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 bg-white/5 active:scale-95"
      >
        <RotateCcw size={15} /> Clear
      </button>
      <button
        onClick={apply}
        className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-500 active:scale-[0.98]"
      >
        Show {prefs.countries.length || "all"} × {prefs.topics.length || "all"} feeds
      </button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Customise your news" footer={footer}>
      <div className="space-y-6">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Keyword (optional)
          </label>
          <div className="mt-2 flex items-center gap-2 px-3 rounded-xl bg-white/5 border border-white/10 focus-within:border-sky-500/50">
            <Search size={16} className="text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              placeholder="e.g. elections, AI, interest rates"
              className="flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-slate-500 outline-none"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-white">Countries</h3>
            <span className="text-xs text-slate-500">{prefs.countries.length} selected</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((c) => {
              const on = prefs.countries.includes(c.code);
              return (
                <button
                  key={c.code}
                  onClick={() => setPrefs({ countries: toggleInList(prefs.countries, c.code) })}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition active:scale-95 border ${
                    on
                      ? "bg-sky-500 text-white border-sky-400"
                      : "bg-white/5 text-slate-300 border-white/10"
                  }`}
                >
                  <span className="mr-1">{c.flag}</span>
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-white">Field areas</h3>
            <span className="text-xs text-slate-500">{prefs.topics.length} selected</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TOPICS.map((t) => {
              const on = prefs.topics.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => setPrefs({ topics: toggleInList(prefs.topics, t.key) })}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition active:scale-95 border ${
                    on
                      ? "bg-sky-500/15 text-sky-200 border-sky-500/40"
                      : "bg-white/5 text-slate-300 border-white/10"
                  }`}
                >
                  <TopicIcon name={t.icon} size={16} className={on ? "text-sky-400" : "text-slate-500"} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
