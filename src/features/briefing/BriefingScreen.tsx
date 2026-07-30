import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, RefreshCw, Loader2, Newspaper, LineChart, HeartPulse, ExternalLink, Sparkles, Sun, Sunrise, Sunset } from "lucide-react";
import { useHealth } from "../../lib/health";
import { useAiAccess } from "../../lib/aiAccess";
import { currentSlot, slotLabel, greeting, achievements, healthContext, hasHealthData, type Slot } from "../../lib/briefing";
import { fetchBriefing, type BriefingResult } from "../../lib/api";
import AiUnlock from "../ai/AiUnlock";

const SLOTS: { key: Slot; icon: typeof Sun }[] = [
  { key: "morning", icon: Sunrise },
  { key: "lunch", icon: Sun },
  { key: "evening", icon: Sunset },
];

export default function BriefingScreen({ onBack }: { onBack: () => void }) {
  const s = useHealth();
  const ai = useAiAccess();
  const [slot, setSlot] = useState<Slot>(currentSlot());
  const [data, setData] = useState<BriefingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dateStr = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), []);
  const achieved = useMemo(() => achievements(s), [s]);

  const load = useCallback(async () => {
    if (ai.status !== "ready") return;
    setLoading(true);
    setErr(null);
    try {
      const ctx = hasHealthData(s) ? healthContext(s) : null;
      const res = await fetchBriefing(slot, ctx);
      if (!res.ok) setErr(res.needCode ? "Enter your access code above." : res.configured === false ? "Briefings need AI set up." : "Couldn't build your briefing.");
      setData(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, ai.status]);

  useEffect(() => {
    load();
  }, [load]);

  // Group the ranked news by section for a magazine feel.
  const sections = useMemo(() => {
    const items = data?.news?.items || [];
    const map = new Map<string, typeof items>();
    for (const it of items) {
      const k = (it.section || "Top stories").trim() || "Top stories";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-2.5">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400 active:scale-95">
              <ChevronLeft size={18} /> Home
            </button>
            <button onClick={load} disabled={loading || ai.status !== "ready"} className="grid place-items-center w-9 h-9 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95 disabled:opacity-40" aria-label="Refresh">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          <h1 className="mt-1 text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">{greeting(slot)}</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">{dateStr} · your {slot} briefing</p>

          <div className="mt-3 inline-flex p-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-sm">
            {SLOTS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSlot(key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-medium transition ${slot === key ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400"}`}
              >
                <Icon size={14} /> {slotLabel(key)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {ai.status === "locked" && (
          <AiUnlock onSubmit={ai.unlock} />
        )}
        {ai.status === "off" && (
          <div className="rounded-2xl glass p-4 text-sm text-slate-600 dark:text-slate-300">
            Briefings are AI-powered. Add <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">ANTHROPIC_API_KEY</code> in Vercel to switch them on. Your achievements below work without it.
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-8 justify-center">
            <Loader2 size={16} className="animate-spin" /> Building your {slot} briefing…
          </div>
        )}

        {err && !loading && <div className="rounded-2xl glass p-4 text-sm text-slate-600 dark:text-slate-300">{err}</div>}

        {/* Top news */}
        {sections.length > 0 && (
          <section>
            <SectionHeader icon={Newspaper} title="Today's top news" />
            <div className="space-y-4">
              {sections.map(([label, items]) => (
                <div key={label}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400 mb-1.5">{label}</p>
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <button key={i} onClick={() => window.open(it.link, "_blank")} className="w-full text-left rounded-2xl glass-subtle p-3 active:scale-[0.99] transition">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">{it.title}</p>
                          <ExternalLink size={13} className="mt-1 shrink-0 text-slate-300 dark:text-slate-600" />
                        </div>
                        {it.why && <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-snug">{it.why}</p>}
                        <p className="mt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">{it.source}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {data?.news?.note && sections.length === 0 && !loading && (
          <div className="rounded-2xl glass-subtle p-3 text-[13px] text-slate-500 dark:text-slate-400">{data.news.note}</div>
        )}

        {/* Markets */}
        {data?.market && data.market.length > 0 && (
          <section>
            <SectionHeader icon={LineChart} title="Markets" />
            <div className="grid grid-cols-2 gap-2">
              {data.market.map((m) => {
                const up = (m.changePercent ?? 0) >= 0;
                return (
                  <div key={m.symbol} className="rounded-2xl glass-subtle p-3">
                    <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">{m.name || m.symbol}</p>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{m.price != null ? m.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}</span>
                      {m.changePercent != null && (
                        <span className={`text-[12px] font-bold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          {up ? "+" : ""}{m.changePercent.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Health */}
        <section>
          <SectionHeader icon={HeartPulse} title="Health" />
          {achieved.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {achieved.map((a, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${a.tone === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "glass-subtle text-slate-600 dark:text-slate-300"}`}>
                  <span>{a.emoji}</span> {a.text}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">Log some steps, food or water and your achievements show up here.</p>
          )}

          {data?.health && (
            <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg, #27272a 0%, #09090b 100%)" }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles size={14} className="text-white/80" />
                <p className="text-sm font-bold">{data.health.headline || "Your recommendation"}</p>
              </div>
              <p className="text-[13px] text-white/85 leading-relaxed">{data.health.advice}</p>
              {data.health.focus?.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {data.health.focus.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-white/90">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-white/70 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: typeof Newspaper; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon size={17} className="text-slate-500 dark:text-slate-400" />
      <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{title}</h2>
    </div>
  );
}
