import { useEffect, useState } from "react";
import { fetchAiStatus, getAiCode, clearAiCode } from "../../lib/api";
import { Sparkles } from "lucide-react";
import {
  Newspaper,
  CandlestickChart,
  RotateCcw,
  ShieldCheck,
  Rss,
  Smartphone,
  Info,
  Check,
  Users,
  Sun,
  Moon,
  Monitor,
  Lock,
  Link2,
  Copy,
  Share2,
} from "lucide-react";

// The app's canonical, always-current public link. Shown and shared verbatim
// so the right URL goes out no matter which domain the app was opened from.
const SHARE_URL = "https://ac-news-tau.vercel.app";
const SHARE_HOST = SHARE_URL.replace(/^https?:\/\//, "");
import { usePrefs, resetPrefs, setPrefs, type Theme } from "../../lib/store";
import { hasPasscode, clearPasscode } from "../../lib/lock";
import PasscodeSetup from "../lock/PasscodeSetup";
import NotificationsSettings from "./NotificationsSettings";
import { countryByCode, topicByKey } from "../../../shared/catalog";

const THEMES: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "Auto", icon: Monitor },
];

type Tab = "news" | "markets" | "settings";

export default function SettingsScreen({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const prefs = usePrefs();
  const [didReset, setDidReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lockSetup, setLockSetup] = useState(false);
  const lockOn = hasPasscode();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: "AC News", text: "Live world news & markets", url: SHARE_URL });
      else await copyLink();
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Settings</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">Your preferences are saved on this device</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <section className="rounded-2xl glass p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Appearance</h2>
          <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {THEMES.map(({ key, label, icon: Icon }) => {
              const on = prefs.theme === key;
              return (
                <button
                  key={key}
                  onClick={() => setPrefs({ theme: key })}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition ${
                    on ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  <Icon size={15} /> {label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl glass p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid place-items-center w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
                <Lock size={17} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">App lock</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{lockOn ? "Passcode required to open" : "Off"}</p>
              </div>
            </div>
            {lockOn ? (
              <div className="flex gap-2">
                <button onClick={() => setLockSetup(true)} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 active:scale-95">
                  Change
                </button>
                <button onClick={() => clearPasscode()} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 active:scale-95">
                  Turn off
                </button>
              </div>
            ) : (
              <button onClick={() => setLockSetup(true)} className="px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-slate-900 dark:bg-slate-700 text-white active:scale-95">
                Set up
              </button>
            )}
          </div>
        </section>

        <NotificationsSettings />

        <AiFeatures />

        <section className="rounded-2xl glass p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Your news feed</h2>
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
                  <span className="text-sm text-slate-400 dark:text-slate-500">All</span>
                )}
              </div>
            </Row>
            <Row label="Topics">
              <span className="text-sm text-slate-600 dark:text-slate-300 text-right">
                {prefs.topics.length
                  ? prefs.topics.map((t) => topicByKey(t)?.label).filter(Boolean).join(", ")
                  : "All"}
              </span>
            </Row>
            {prefs.newsQuery && (
              <Row label="Keyword">
                <span className="text-sm text-slate-600 dark:text-slate-300">"{prefs.newsQuery}"</span>
              </Row>
            )}
          </div>
          <button
            onClick={() => onNavigate("news")}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 active:scale-[0.98]"
          >
            <Newspaper size={16} /> Adjust in News tab
          </button>
        </section>

        <section className="rounded-2xl glass p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Your watchlist</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{prefs.watchlist.join(" · ") || "Empty"}</p>
          <button
            onClick={() => onNavigate("markets")}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 active:scale-[0.98]"
          >
            <CandlestickChart size={16} /> Edit in Markets tab
          </button>
        </section>

        <section className="rounded-2xl glass p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="grid place-items-center w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
              <Share2 size={17} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Share AC News</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">This is your app's link — send it to anyone</p>
            </div>
          </div>

          <button
            onClick={copyLink}
            className="w-full flex items-center gap-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-left active:scale-[0.99] transition"
          >
            <Link2 size={15} className="text-slate-400 dark:text-slate-500 shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{SHARE_HOST}</span>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${copied ? "text-emerald-600 dark:text-emerald-400" : "text-brand-600 dark:text-brand-400"}`}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </span>
          </button>

          <button
            onClick={share}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-600 text-white text-sm font-semibold active:scale-[0.98]"
          >
            <Users size={16} /> Share with a friend
          </button>
        </section>

        <section className="rounded-2xl glass p-4 space-y-3">
          <InfoRow icon={Users} title="Sharing keeps everyone separate">
            Send friends the app link and each person adjusts their own countries,
            topics and watchlist. Every choice is saved only on that person's phone —
            changing yours never affects theirs, and vice-versa.
          </InfoRow>
          <InfoRow icon={Rss} title="Where the data comes from">
            Headlines are aggregated live from public news feeds (Google News, which
            surfaces outlets like CNBC, 20 Minuten, DZEN and thousands more). Market
            quotes and charts come from CNBC. No account or API key needed.
          </InfoRow>
          <InfoRow icon={ShieldCheck} title="Privacy">
            No logins and no tracking. Your choices never leave your phone — they're
            stored only in this browser.
          </InfoRow>
          <InfoRow icon={Smartphone} title="Install on your phone">
            Open in your browser, then choose "Add to Home Screen". It opens
            full-screen like a native app.
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
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-600 dark:text-slate-300 active:scale-[0.98]"
        >
          {didReset ? <Check size={16} className="text-emerald-600 dark:text-emerald-400" /> : <RotateCcw size={16} />}
          {didReset ? "Reset to defaults" : "Reset all preferences"}
        </button>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 pt-2">AC News · News, markets &amp; sports · v0.4</p>
      </div>

      <PasscodeSetup open={lockSetup} onClose={() => setLockSetup(false)} />
    </div>
  );
}

function AiFeatures() {
  const [state, setState] = useState<{ configured: boolean; model: string | null; locked: boolean } | null>(null);
  const [hasCode, setHasCode] = useState(false);
  useEffect(() => {
    fetchAiStatus().then(setState).catch(() => setState({ configured: false, model: null, locked: false }));
    setHasCode(!!getAiCode());
  }, []);
  const on = state?.configured;
  const locked = state?.locked;
  const label = on == null ? "…" : !on ? "Off" : locked ? "On · locked" : "On";

  return (
    <section className="rounded-2xl glass p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
            <Sparkles size={17} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI features</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Scanner & food calorie counting</p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${on == null ? "bg-slate-100 dark:bg-slate-800 text-slate-400" : on ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}>
          {label}
        </span>
      </div>

      {!on ? (
        <div className="text-[13px] text-slate-500 dark:text-slate-400 space-y-1.5">
          <p>To turn on the Scanner and food calorie counting, add an Anthropic API key to your Vercel project:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Get a key at console.anthropic.com (add a little billing credit).</li>
            <li>Vercel → your project → Settings → Environment Variables.</li>
            <li>Add <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">ANTHROPIC_API_KEY</code> = your key.</li>
            <li>Redeploy. (Optional: <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">AI_MODEL</code> to pick a model.)</li>
          </ol>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Costs pennies per scan. The key stays on the server — never in the app.</p>
        </div>
      ) : locked ? (
        <div className="text-[13px] text-slate-500 dark:text-slate-400 space-y-2">
          <p>Ready{state?.model ? ` · ${state.model}` : ""}, protected with an access code. Share the code with people you trust — they enter it once, then use AI on your credit.</p>
          <p className="text-[12px]">To change or revoke the code: update <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">AI_ACCESS_CODE</code> in Vercel and redeploy (old code stops working).</p>
          {hasCode && (
            <button onClick={() => { clearAiCode(); setHasCode(false); }} className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              Forget code on this device
            </button>
          )}
        </div>
      ) : (
        <div className="text-[13px] text-slate-500 dark:text-slate-400 space-y-2">
          <p>Ready{state?.model ? ` · ${state.model}` : ""}. Snap food in Health or scan anything in the Scan tab.</p>
          <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-300">
            <p className="font-semibold">Anyone with the app link can use AI on your credit.</p>
            <p className="mt-0.5">To protect it, add <code className="px-1 rounded bg-amber-100/70 dark:bg-amber-500/20 text-[11px]">AI_ACCESS_CODE</code> (a password of your choice) in Vercel → Environment Variables, then redeploy. People enter it once. Set a spend limit at console.anthropic.com too.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-slate-400 dark:text-slate-500 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, title, children }: { icon: typeof Rss; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid place-items-center w-9 h-9 shrink-0 rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
        <Icon size={17} />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
        <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 mt-0.5">{children}</p>
      </div>
    </div>
  );
}
