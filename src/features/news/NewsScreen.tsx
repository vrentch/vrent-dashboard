import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, RefreshCw, AlertCircle, ChevronRight, ChevronLeft } from "lucide-react";
import { fetchNews, type NewsItem } from "../../lib/api";
import { usePrefs } from "../../lib/store";
import { topicByKey, countryByCode } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import NewsCard from "./NewsCard";
import NewsFilters from "./NewsFilters";

type GroupBy = "country" | "topic";
type Focus = { type: GroupBy; value: string } | null;

export default function NewsScreen() {
  const prefs = usePrefs();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("country");
  const [focus, setFocus] = useState<Focus>(null);

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
  useEffect(() => setFocus(null), [key]);

  // Build ordered groups following the user's own selection order.
  const groups = useMemo(() => {
    const order = groupBy === "country" ? prefs.countries : prefs.topics;
    return order
      .map((val) => ({
        value: val,
        items: items.filter((it) => (groupBy === "country" ? it.countryCode : it.topicKey) === val),
      }))
      .filter((g) => g.items.length > 0);
  }, [items, groupBy, prefs.countries, prefs.topics]);

  const focusItems = useMemo(() => {
    if (!focus) return [];
    return items.filter((it) => (focus.type === "country" ? it.countryCode : it.topicKey) === focus.value);
  }, [items, focus]);

  const groupLabel = (type: GroupBy, value: string) => {
    if (type === "country") {
      const c = countryByCode(value);
      return { icon: <span className="text-lg leading-none">{c?.flag}</span>, name: c?.name ?? value };
    }
    const t = topicByKey(value);
    return {
      icon: <TopicIcon name={t?.icon ?? "Tag"} size={17} className="text-brand-600" />,
      name: t?.label ?? value,
    };
  };

  return (
    <div>
      <header className="sticky top-0 z-30 bg-[#f6f7f9]/85 backdrop-blur-xl border-b border-slate-200/70 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">News</h1>
              <p className="text-xs text-slate-400">
                {prefs.countries.length || "all"} countries · {prefs.topics.length || "all"} topics
                {prefs.newsQuery ? ` · "${prefs.newsQuery}"` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => load(true)}
                className="grid place-items-center w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-600 active:scale-95"
                aria-label="Refresh"
              >
                <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setFiltersOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-slate-900 text-white text-sm font-semibold active:scale-95"
              >
                <SlidersHorizontal size={16} /> Adjust
              </button>
            </div>
          </div>

          {!focus && (
            <div className="mt-3 inline-flex p-0.5 rounded-full bg-slate-200/70 text-sm">
              {(["country", "topic"] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={`px-4 py-1.5 rounded-full font-medium transition ${
                    groupBy === g ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {g === "country" ? "By country" : "By topic"}
                </button>
              ))}
            </div>
          )}

          {focus && (
            <button
              onClick={() => setFocus(null)}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600"
            >
              <ChevronLeft size={16} /> Back to overview
            </button>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4">
        {loading && <SkeletonSections />}

        {!loading && error && items.length === 0 && (
          <EmptyState message={error} onAction={() => setFiltersOpen(true)} actionLabel="Adjust filters" />
        )}

        {/* Focused (filtered) list */}
        {!loading && focus && (
          <div className="space-y-3">
            <SectionTitle {...groupLabel(focus.type, focus.value)} count={focusItems.length} />
            {focusItems.map((it, i) => (
              <NewsCard key={it.id} item={it} index={i} showCountry={focus.type !== "country"} />
            ))}
          </div>
        )}

        {/* Grouped overview */}
        {!loading && !focus &&
          groups.map((g) => {
            const { icon, name } = groupLabel(groupBy, g.value);
            return (
              <section key={g.value} className="mb-6">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    {icon}
                    <h2 className="text-[15px] font-bold text-slate-900">{name}</h2>
                    <span className="text-xs text-slate-400 font-medium">{g.items.length}</span>
                  </div>
                  <button
                    onClick={() => setFocus({ type: groupBy, value: g.value })}
                    className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 active:scale-95"
                  >
                    See all <ChevronRight size={14} />
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto no-scrollbar snap-row -mx-4 px-4 pb-1">
                  {g.items.slice(0, 10).map((it, i) => (
                    <NewsCard
                      key={it.id}
                      item={it}
                      index={i}
                      variant="compact"
                      showCountry={groupBy !== "country"}
                    />
                  ))}
                </div>
              </section>
            );
          })}

        {!loading && !focus && !error && groups.length === 0 && (
          <EmptyState message="No stories right now — try adjusting your filters." onAction={() => setFiltersOpen(true)} actionLabel="Adjust" />
        )}
      </div>

      <NewsFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} />
    </div>
  );
}

function SectionTitle({ icon, name, count }: { icon: React.ReactNode; name: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      {icon}
      <h2 className="text-[15px] font-bold text-slate-900">{name}</h2>
      <span className="text-xs text-slate-400 font-medium">{count} stories</span>
    </div>
  );
}

function EmptyState({ message, onAction, actionLabel }: { message: string; onAction: () => void; actionLabel: string }) {
  return (
    <div className="text-center py-16 px-6">
      <AlertCircle className="mx-auto text-slate-300 mb-3" size={32} />
      <p className="text-slate-500 text-sm">{message}</p>
      <button onClick={onAction} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold">
        {actionLabel}
      </button>
    </div>
  );
}

function SkeletonSections() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s}>
          <div className="h-5 w-40 rounded skeleton mb-3" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-[250px] shrink-0 rounded-2xl bg-white border border-slate-200/70 overflow-hidden">
                <div className="h-32 skeleton" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-3/4 rounded skeleton" />
                  <div className="h-4 w-1/2 rounded skeleton" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
