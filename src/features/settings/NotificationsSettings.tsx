import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import {
  usePushSettings,
  setPushSettings,
  pushSupported,
  serverConfigured,
  enablePush,
  disablePush,
  syncPush,
  sendTestPush,
} from "../../lib/push";
import { Bell, Check, Loader2, ExternalLink } from "lucide-react";

export default function NotificationsSettings() {
  const s = usePushSettings();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [supported] = useState(() => pushSupported());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    serverConfigured().then(setConfigured);
  }, []);

  async function toggleEnable() {
    setBusy(true);
    setMsg("");
    if (s.enabled) {
      await disablePush();
    } else {
      const r = await enablePush(s);
      if (!r.ok) setMsg(r.reason || "Couldn't enable notifications.");
    }
    setBusy(false);
  }

  function update(patch: Partial<typeof s>) {
    setPushSettings(patch);
    if (s.enabled) syncPush({ ...s, ...patch });
  }

  async function test() {
    setBusy(true);
    const ok = await sendTestPush();
    setMsg(ok ? "Test sent — check your notifications." : "Couldn't send a test.");
    setBusy(false);
  }

  return (
    <section className="rounded-2xl glass p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
          <Bell size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Market open/close &amp; a daily recap</p>
        </div>
      </div>

      {!supported && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Add AC App to your Home Screen first, then reopen it here to enable notifications.
        </p>
      )}

      {supported && configured === false && (
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Push needs a quick one-time backend setup before it can be switched on.
          </p>
          <button onClick={() => setGuide(true)} className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold">
            <ExternalLink size={15} /> How to set it up
          </button>
        </div>
      )}

      {supported && configured && (
        <div className="space-y-3">
          <button
            onClick={toggleEnable}
            disabled={busy}
            className={`w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] ${
              s.enabled ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300" : "bg-slate-900 dark:bg-slate-700 text-white"
            }`}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : s.enabled ? <Check size={16} /> : <Bell size={16} />}
            {s.enabled ? "Notifications on — tap to turn off" : "Enable notifications"}
          </button>

          {s.enabled && (
            <div className="space-y-1">
              <Toggle label="Market open" on={s.marketOpen} onChange={(v) => update({ marketOpen: v })} />
              <Toggle label="Market close" on={s.marketClose} onChange={(v) => update({ marketClose: v })} />
              <Toggle label="Daily recap" on={s.dailyRecap} onChange={(v) => update({ dailyRecap: v })} />
              {s.dailyRecap && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-slate-700 dark:text-slate-300">Recap time</span>
                  <input
                    type="time"
                    value={s.recapTime}
                    onChange={(e) => update({ recapTime: e.target.value })}
                    className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>
              )}
              <button onClick={test} disabled={busy} className="mt-1 text-sm font-medium text-brand-600 dark:text-brand-400">
                Send a test notification
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{msg}</p>}

      <SetupGuide open={guide} onClose={() => setGuide(false)} />
    </section>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
      <button
        onClick={() => onChange(!on)}
        className={`relative w-11 h-6 rounded-full transition ${on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`}
        aria-pressed={on}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

function SetupGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Turn on notifications">
      <ol className="space-y-3 text-sm text-slate-600 dark:text-slate-300 list-decimal pl-5">
        <li>
          In your <b>Vercel</b> dashboard, open the <b>ac-news</b> project → <b>Storage</b> → <b>Create Database</b> → <b>KV</b>, and connect it to the project. This adds the storage keys automatically.
        </li>
        <li>
          Still in Vercel → <b>Settings → Environment Variables</b>, add <b>VAPID_PRIVATE</b> (the value I gave you) and optionally <b>VAPID_SUBJECT</b> = <code>mailto:info@vrent.ch</code>. Save.
        </li>
        <li>
          A tiny scheduler runs from the project's <b>GitHub Actions</b> automatically (every ~5&nbsp;min) to deliver alerts — make sure Actions are enabled on the <b>ac-news</b> repo.
        </li>
        <li>
          Redeploy (Vercel → Deployments → redeploy latest, so the new keys load), then come back here and press <b>Enable notifications</b> → <b>Allow</b>.
        </li>
      </ol>
      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
        Everything is free. Only market open/close and the daily recap are sent — nothing about your calendar or watchlist leaves your phone.
      </p>
    </Sheet>
  );
}
