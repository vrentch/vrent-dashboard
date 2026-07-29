import { useEffect, useState } from "react";
import { LayoutGrid, Newspaper, CandlestickChart, CalendarDays, Settings } from "lucide-react";
import HomeScreen from "./features/home/HomeScreen";
import NewsScreen from "./features/news/NewsScreen";
import MarketsScreen from "./features/markets/MarketsScreen";
import CalendarScreen from "./features/calendar/CalendarScreen";
import SettingsScreen from "./features/settings/SettingsScreen";
import LockScreen from "./features/lock/LockScreen";
import { usePrefs } from "./lib/store";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { useLocked } from "./lib/lock";

type Tab = "home" | "news" | "markets" | "calendar" | "settings";

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "home", label: "Home", icon: LayoutGrid },
  { key: "news", label: "News", icon: Newspaper },
  { key: "markets", label: "Markets", icon: CandlestickChart },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { theme } = usePrefs();
  const locked = useLocked();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => watchSystemTheme(() => theme), [theme]);

  if (locked) return <LockScreen />;

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-20">
        {tab === "home" && <HomeScreen onNavigate={setTab} />}
        {tab === "news" && <NewsScreen />}
        {tab === "markets" && <MarketsScreen />}
        {tab === "calendar" && <CalendarScreen />}
        {tab === "settings" && <SettingsScreen onNavigate={setTab} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 glass-nav border-t border-white/40 dark:border-white/10 safe-bottom">
        <div className="max-w-lg mx-auto grid grid-cols-5">
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
