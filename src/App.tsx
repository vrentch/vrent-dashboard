import { useEffect, useState } from "react";
import { LayoutGrid, Newspaper, CandlestickChart, Settings } from "lucide-react";
import HomeScreen from "./features/home/HomeScreen";
import NewsScreen from "./features/news/NewsScreen";
import MarketsScreen from "./features/markets/MarketsScreen";
import SettingsScreen from "./features/settings/SettingsScreen";
import { usePrefs } from "./lib/store";
import { applyTheme, watchSystemTheme } from "./lib/theme";

type Tab = "home" | "news" | "markets" | "settings";

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "home", label: "Home", icon: LayoutGrid },
  { key: "news", label: "News", icon: Newspaper },
  { key: "markets", label: "Markets", icon: CandlestickChart },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { theme } = usePrefs();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => watchSystemTheme(() => theme), [theme]);

  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-20">
        {tab === "home" && <HomeScreen onNavigate={setTab} />}
        {tab === "news" && <NewsScreen />}
        {tab === "markets" && <MarketsScreen />}
        {tab === "settings" && <SettingsScreen onNavigate={setTab} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 dark:border-slate-700 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl safe-bottom">
        <div className="max-w-lg mx-auto grid grid-cols-4">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex flex-col items-center gap-1 py-2.5 active:scale-95 transition"
              >
                <Icon
                  size={22}
                  className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className={`text-[11px] font-medium ${active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
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
