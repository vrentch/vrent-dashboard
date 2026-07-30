import { useEffect, useState } from "react";
import { LayoutGrid, Newspaper, CandlestickChart, Trophy, HeartPulse, ScanLine } from "lucide-react";
import HomeScreen from "./features/home/HomeScreen";
import NewsScreen from "./features/news/NewsScreen";
import MarketsScreen from "./features/markets/MarketsScreen";
import SportsScreen from "./features/sports/SportsScreen";
import HealthScreen from "./features/health/HealthScreen";
import ScanScreen from "./features/scan/ScanScreen";
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

export type Tab = "home" | "news" | "markets" | "sports" | "health" | "scan" | "calendar" | "settings" | "briefing";

// Six primary destinations in the bottom bar. Calendar and Settings are
// reachable from the Home screen (calendar widget + header gear) to keep the
// bar uncluttered.
const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "home", label: "Home", icon: LayoutGrid },
  { key: "news", label: "News", icon: Newspaper },
  { key: "markets", label: "Markets", icon: CandlestickChart },
  { key: "sports", label: "Sports", icon: Trophy },
  { key: "health", label: "Health", icon: HeartPulse },
  { key: "scan", label: "Scan", icon: ScanLine },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { theme } = usePrefs();
  const locked = useLocked();

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
        <ErrorBoundary resetKey={tab}>
          {tab === "home" && <HomeScreen onNavigate={setTab} />}
          {tab === "news" && <NewsScreen />}
          {tab === "markets" && <MarketsScreen />}
          {tab === "sports" && <SportsScreen />}
          {tab === "health" && <HealthScreen />}
          {tab === "scan" && <ScanScreen />}
          {tab === "calendar" && <CalendarScreen />}
          {tab === "briefing" && <BriefingScreen onBack={() => setTab("home")} />}
          {tab === "settings" && <SettingsScreen onNavigate={setTab} />}
        </ErrorBoundary>
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-nav border-t border-white/40 dark:border-white/10 safe-bottom">
        <div className="max-w-lg mx-auto grid grid-cols-6">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex flex-col items-center gap-1 py-2.5 active:scale-95 transition"
              >
                <Icon
                  size={21}
                  className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className={`text-[10px] font-medium ${active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
