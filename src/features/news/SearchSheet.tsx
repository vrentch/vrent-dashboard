import { useEffect, useRef, useState } from "react";
import Sheet from "../../components/Sheet";
import { fetchNews, type NewsItem } from "../../lib/api";
import { usePrefs, addRecentSearch } from "../../lib/store";
import NewsCard from "./NewsCard";
import { Search, X, Clock } from "lucide-react";

const SUGGESTIONS = ["Bitcoin", "Elections", "AI", "Interest rates", "Climate", "Ukraine", "Football"];

export default function SearchSheet({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (item: NewsItem) => void;
}) {
  const prefs = usePrefs();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
    if (!open) {
      setQ("");
      setResults([]);
      setSearched(false);
    }
  }, [open]);

  async function run(term: string) {
    const query = term.trim();
    if (!query) return;
    setQ(query);
    setLoading(true);
    setSearched(true);
    try {
      const countries = prefs.countries.length ? prefs.countries : ["US", "GB"];
      const res = await fetchNews({ countries, topics: ["top"], query });
      setResults(res.items);
      addRecentSearch(query);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Search news">
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-3 rounded-xl bg-slate-100 border border-slate-200 focus-within:border-brand-500 focus-within:bg-white transition">
          <Search size={17} className="text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(q)}
            placeholder="Search any topic, company, person…"
            className="flex-1 bg-transparent py-2.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none"
          />
          {q && (
            <button onClick={() => setQ("")} className="text-slate-400 active:scale-90" aria-label="Clear">
              <X size={16} />
            </button>
          )}
        </div>

        {!searched && (
          <div className="space-y-4">
            {prefs.recentSearches.length > 0 && (
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  <Clock size={12} /> Recent
                </h3>
                <div className="flex flex-wrap gap-2">
                  {prefs.recentSearches.map((s) => (
                    <button
                      key={s}
                      onClick={() => run(s)}
                      className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700 active:scale-95"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Try</h3>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => run(s)}
                    className="px-3 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-sm font-medium text-brand-700 active:scale-95"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl skeleton" />
            ))}
          </div>
        )}

        {searched && !loading && (
          <div className="space-y-3">
            {results.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-10">No results for “{q}”. Try another term.</p>
            ) : (
              <>
                <p className="text-xs text-slate-400">{results.length} results for “{q}”</p>
                {results.map((it, i) => (
                  <NewsCard key={it.id} item={it} index={i} onOpen={onOpen} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
