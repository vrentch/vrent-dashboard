import { useState } from "react";
import { Newspaper, CandlestickChart, Settings } from "lucide-react";
import NewsScreen from "./features/news/NewsScreen";
import MarketsScreen from "./features/markets/MarketsScreen";
import SettingsScreen from "./features/settings/SettingsScreen";

type Tab = "news" | "markets" | "settings";

const TABS: { key: Tab; label: string; icon: typeof Newspaper }[] = [
  { key: "news", label: "News", icon: Newspaper },
  { key: "markets", label: "Markets", icon: CandlestickChart },
  { key: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("news");

  return (
    <div className="min-h-full flex flex-col bg-ink-950">
      <main className="flex-1 pb-20">
        {tab === "news" && <NewsScreen />}
        {tab === "markets" && <MarketsScreen />}
        {tab === "settings" && <SettingsScreen onNavigate={setTab} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-ink-900/90 backdrop-blur-xl safe-bottom">
        <div className="max-w-lg mx-auto grid grid-cols-3">
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
                  className={active ? "text-sky-400" : "text-slate-500"}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className={`text-[11px] font-medium ${active ? "text-sky-400" : "text-slate-500"}`}>
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
