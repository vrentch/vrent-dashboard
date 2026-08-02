import { useEffect, useState } from "react";
import { Home, Newspaper, CandlestickChart, HeartPulse, ScanLine, Receipt, CalendarDays, Mic } from "lucide-react";
import type { NewsMode } from "./components/NewsSportSegment";
import AssistantSheet from "./features/assistant/AssistantSheet";
import HomeScreen from "./features/home/HomeScreen";
import NewsScreen from "./features/news/NewsScreen";
import MarketsScreen from "./features/markets/MarketsScreen";
import SportsScreen from "./features/sports/SportsScreen";
import HealthScreen from "./features/health/HealthScreen";
import ScanScreen from "./features/scan/ScanScreen";
import BusinessScreen from "./features/business/BusinessScreen";
import CalendarScreen from "./features/calendar/CalendarScreen";
import BriefingScreen from "./features/briefing/BriefingScreen";
import SettingsScreen from "./features/settings/SettingsScreen";
import LockScreen from "./features/lock/LockScreen";
import ErrorBoundary from "./components/ErrorBoundary";
import { usePrefs } from "./lib/store";
import { ingestHealth, getSyncKey, applyHealthDays } from "./lib/health";
import { fetchHealthStatus, pullHealth } from "./lib/api";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { useLocked } from "./lib/lock";

export type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "business" | "calendar" | "settings" | "briefing";

// Bottom bar: three tabs each side of the raised center Scan (AI) button.
// News hosts both News & Sport via an in-header switch; Settings & Briefing are
// reached from Home.
type NavItem = { key: Tab; label: string; icon: typeof Home };
const LEFT_TABS: NavItem[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "news", label: "News", icon: Newspaper },
  { key: "markets", label: "Markets", icon: CandlestickChart },
];
const RIGHT_TABS: NavItem[] = [
  { key: "health", label: "Health", icon: HeartPulse },
  { key: "business", label: "Business", icon: Receipt },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [newsMode, setNewsMode] = useState<NewsMode>("news");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { theme } = usePrefs();
  const locked = useLocked();

  // The assistant navigates by tab name (with News/Sport handled together).
  const assistantNavigate = (t: string) => {
    if (t === "sport") { setNewsMode("sport"); setTab("news"); }
    else if (t === "news") { setNewsMode("news"); setTab("news"); }
    else setTab(t as Tab);
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => watchSystemTheme(() => theme), [theme]);

  // Apple Health bridge: an iOS Shortcut can open the app with ?steps=&weight=…
  // We log whatever it sends, then strip the params from the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = (k: string) => {
      const v = q.get(k);
      if (v == null || v === "") return undefined;
      const f = parseFloat(v);
      return isFinite(f) ? f : undefined;
    };
    const payload = { steps: n("steps"), weightKg: n("weight"), sleepH: n("sleep"), waterMl: n("water"), activeKcal: n("kcal"), date: q.get("date") || undefined };
    if (payload.steps || payload.weightKg || payload.sleepH || payload.waterMl || payload.activeKcal) {
      try {
        ingestHealth(payload);
        setTab("health");
      } catch {
        /* ignore malformed input */
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Background sync: pull the metrics the iOS Shortcut sent to the server (keyed
  // by this device's private sync key) so they appear in the installed app,
  // whose storage is isolated from Safari. Runs on open and when refocused.
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try {
        const st = await fetchHealthStatus();
        if (!alive || !st.configured) return;
        const { days } = await pullHealth(getSyncKey());
        if (alive) applyHealthDays(days);
      } catch {
        /* offline or sync not set up — ignore */
      }
    };
    sync();
    const onVis = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (locked) return <LockScreen />;

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-20">
        <ErrorBoundary resetKey={tab === "news" ? `news-${newsMode}` : tab}>
          {tab === "home" && <HomeScreen onNavigate={setTab} />}
          {tab === "news" && (newsMode === "sport"
            ? <SportsScreen mode={newsMode} onMode={setNewsMode} />
            : <NewsScreen mode={newsMode} onMode={setNewsMode} />)}
          {tab === "markets" && <MarketsScreen />}
          {tab === "sports" && <SportsScreen />}
          {tab === "health" && <HealthScreen />}
          {tab === "scan" && <ScanScreen />}
          {tab === "business" && <BusinessScreen />}
          {tab === "calendar" && <CalendarScreen />}
          {tab === "briefing" && <BriefingScreen onBack={() => setTab("home")} />}
          {tab === "settings" && <SettingsScreen onNavigate={setTab} />}
        </ErrorBoundary>
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-nav border-t border-white/40 dark:border-white/10 safe-bottom">
        <div className="max-w-lg mx-auto relative flex items-end px-1">
          <div className="flex-1 grid grid-cols-3">
            {LEFT_TABS.map((t) => <TabButton key={t.key} item={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          </div>
          <div className="w-16 shrink-0" aria-hidden />
          <div className="flex-1 grid grid-cols-3">
            {RIGHT_TABS.map((t) => <TabButton key={t.key} item={t} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          </div>
          {/* Raised center Scan (AI) button */}
          <button
            onClick={() => setTab("scan")}
            aria-label="AI Scan"
            className={`absolute left-1/2 -translate-x-1/2 -top-5 w-16 h-16 rounded-full accent-gradient text-white grid place-items-center shadow-accent active:scale-95 transition border-4 border-[#eef0f7] dark:border-[#0d0d12] ${tab === "scan" ? "ring-accent" : ""}`}
          >
            <ScanLine size={26} strokeWidth={2.4} />
          </button>
        </div>
      </nav>

      {/* Global Ask-AI (voice + text) launcher */}
      <button
        onClick={() => setAssistantOpen(true)}
        aria-label="Ask AI"
        className="fixed right-4 bottom-24 z-30 inline-flex items-center gap-1.5 h-11 pl-3.5 pr-4 rounded-full accent-gradient text-white text-sm font-semibold shadow-accent active:scale-95"
      >
        <Mic size={17} /> Ask AI
      </button>

      <AssistantSheet open={assistantOpen} onClose={() => setAssistantOpen(false)} onNavigate={assistantNavigate} />
    </div>
  );
}

function TabButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const { label, icon: Icon } = item;
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 py-2.5 active:scale-95 transition">
      <Icon
        size={21}
        className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}
        strokeWidth={active ? 2.5 : 2}
      />
      <span className={`text-[10px] font-medium ${active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
        {label}
      </span>
    </button>
  );
}
