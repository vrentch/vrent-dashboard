import { useState } from "react";
import {
  Newspaper,
  CandlestickChart,
  RotateCcw,
  ShieldCheck,
  Rss,
  Smartphone,
  Info,
  Check,
} from "lucide-react";
import { usePrefs, resetPrefs } from "../../lib/store";
import { countryByCode, topicByKey } from "../../../shared/catalog";

type Tab = "news" | "markets" | "settings";

export default function SettingsScreen({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const prefs = usePrefs();
  const [didReset, setDidReset] = useState(false);

  return (
    <div>
      <header className="sticky top-0 z-30 bg-ink-950/85 backdrop-blur-xl border-b border-white/5 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <h1 className="text-xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-xs text-slate-500">Your preferences are saved on this device</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <section className="rounded-2xl bg-ink-900 border border-white/5 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Your news feed</h2>
          <div className="space-y-2.5">
            <Row label="Countries">
              <div className="flex flex-wrap gap-1.5 justify-end">
                {prefs.countries.length ? (
                  prefs.countries.map((c) => (
                    <span key={c} className="text-sm">
                      {countryByCode(c)?.flag} {c}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">All</span>
                )}
              </div>
            </Row>
            <Row label="Topics">
              <span className="text-sm text-slate-300 text-right">
                {prefs.topics.length
                  ? prefs.topics.map((t) => topicByKey(t)?.label).filter(Boolean).join(", ")
                  : "All"}
              </span>
            </Row>
            {prefs.newsQuery && (
              <Row label="Keyword">
                <span className="text-sm text-slate-300">“{prefs.newsQuery}”</span>
              </Row>
            )}
          </div>
          <button
            onClick={() => onNavigate("news")}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 text-sm font-medium text-white active:scale-[0.98]"
          >
            <Newspaper size={16} /> Adjust in News tab
          </button>
        </section>

        <section className="rounded-2xl bg-ink-900 border border-white/5 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Your watchlist</h2>
          <p className="text-sm text-slate-300">{prefs.watchlist.join(" · ") || "Empty"}</p>
          <button
            onClick={() => onNavigate("markets")}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 text-sm font-medium text-white active:scale-[0.98]"
          >
            <CandlestickChart size={16} /> Edit in Markets tab
          </button>
        </section>

        <section className="rounded-2xl bg-ink-900 border border-white/5 p-4 space-y-3">
          <InfoRow icon={Rss} title="Where the data comes from">
            Headlines are aggregated live from public news feeds (Google News, which
            surfaces outlets like CNBC, 20 Minuten, DZEN and thousands more). Market
            quotes and charts come from CNBC's public market data. No account or API
            key needed.
          </InfoRow>
          <InfoRow icon={ShieldCheck} title="Privacy">
            There are no logins and no tracking. Your country, topic and watchlist
            choices never leave your phone — they're stored only in this browser.
          </InfoRow>
          <InfoRow icon={Smartphone} title="Install on your phone">
            Open this page in your browser, then choose “Add to Home Screen”. It opens
            full-screen like a native app and works offline for the shell.
          </InfoRow>
          <InfoRow icon={Info} title="Good to know">
            Market data is delayed and for information only — not financial advice.
          </InfoRow>
        </section>

        <button
          onClick={() => {
            resetPrefs();
            setDidReset(true);
            setTimeout(() => setDidReset(false), 1800);
          }}
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/10 text-sm font-medium text-slate-300 active:scale-[0.98]"
        >
          {didReset ? <Check size={16} className="text-emerald-400" /> : <RotateCcw size={16} />}
          {didReset ? "Reset to defaults" : "Reset all preferences"}
        </button>

        <p className="text-center text-xs text-slate-600 pt-2">AC News · World news &amp; markets · v0.1</p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Rss;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-sky-500/10 text-sky-400">
        <Icon size={17} />
      </div>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-[13px] leading-relaxed text-slate-400 mt-0.5">{children}</p>
      </div>
    </div>
  );
}
