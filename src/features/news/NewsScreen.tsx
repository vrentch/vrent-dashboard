import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, RefreshCw, Globe2, AlertCircle } from "lucide-react";
import { fetchNews, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { topicByKey, countryByCode } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import NewsCard from "./NewsCard";
import NewsFilters from "./NewsFilters";

export default function NewsScreen() {
  const prefs = usePrefs();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [activeCountry, setActiveCountry] = useState<string>("all");

  const key = `${prefs.countries.join(",")}|${prefs.topics.join(",")}|${prefs.newsQuery}`;

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const res = await fetchNews({
          countries: prefs.countries,
          topics: prefs.topics,
          query: prefs.newsQuery || undefined,
        });
        setItems(res.items);
        if (!res.items.length && res.errors.length) {
          setError("Couldn't load these feeds. Try different countries or topics.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load news");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reset local filter chips when the underlying selection changes.
  useEffect(() => {
    setActiveTopic("all");
    setActiveCountry("all");
  }, [key]);

  const visible = useMemo(
    () =>
      items.filter(
        (it) =>
          (activeTopic === "all" || it.topicKey === activeTopic) &&
          (activeCountry === "all" || it.countryCode === activeCountry)
      ),
    [items, activeTopic, activeCountry]
  );

  return (
    <div>
      <header className="sticky top-0 z-30 bg-ink-950/85 backdrop-blur-xl border-b border-white/5 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">World News</h1>
              <p className="text-xs text-slate-500">
                {prefs.countries.length || "all"} countries · {prefs.topics.length || "all"} topics
                {prefs.newsQuery ? ` · “${prefs.newsQuery}”` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(true)}
                className="grid place-items-center w-10 h-10 rounded-full bg-white/5 text-slate-300 active:scale-95"
                aria-label="Refresh"
              >
                <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setFiltersOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-sky-500 text-white text-sm font-semibold active:scale-95"
              >
                <SlidersHorizontal size={16} /> Adjust
              </button>
            </div>
          </div>

          {/* Quick filter chips over the loaded results */}
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <Chip active={activeTopic === "all" && activeCountry === "all"} onClick={() => { setActiveTopic("all"); setActiveCountry("all"); }}>
              <Globe2 size={13} /> All
            </Chip>
            {prefs.topics.map((k) => {
              const t = topicByKey(k);
              if (!t) return null;
              return (
                <Chip key={k} active={activeTopic === k} onClick={() => setActiveTopic(activeTopic === k ? "all" : k)}>
                  <TopicIcon name={t.icon} size={13} /> {t.label}
                </Chip>
              );
            })}
            {prefs.countries.length > 1 &&
              prefs.countries.map((c) => {
                const co = countryByCode(c);
                if (!co) return null;
                return (
                  <Chip key={c} active={activeCountry === c} onClick={() => setActiveCountry(activeCountry === c ? "all" : c)}>
                    {co.flag} {co.code}
                  </Chip>
                );
              })}
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {loading && <SkeletonList />}

        {!loading && error && items.length === 0 && (
          <div className="text-center py-16 px-6">
            <AlertCircle className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-400 text-sm">{error}</p>
            <button
              onClick={() => setFiltersOpen(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-sky-500 text-white text-sm font-semibold"
            >
              Adjust filters
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && items.length > 0 && (
          <p className="text-center text-slate-500 text-sm py-10">No stories match this filter.</p>
        )}

        {!loading &&
          visible.map((it, i) => <NewsCard key={it.id} item={it} index={i} />)}
      </div>

      <NewsFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition active:scale-95 border ${
        active ? "bg-white text-ink-950 border-white" : "bg-white/5 text-slate-300 border-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function SkeletonList() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-ink-900 border border-white/5 overflow-hidden">
          <div className="h-40 skeleton" />
          <div className="p-3.5 space-y-2">
            <div className="h-4 w-3/4 rounded skeleton" />
            <div className="h-4 w-1/2 rounded skeleton" />
          </div>
        </div>
      ))}
    </>
  );
}
