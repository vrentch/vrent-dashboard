import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import { Footprints, Scale, Moon, Droplets, Flame, CheckCircle2, AlertCircle } from "lucide-react";
import { getSyncKey } from "../../lib/health";
import { fetchHealthStatus } from "../../lib/api";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://ac-news-tau.vercel.app";

export default function AppleHealthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<"checking" | "on" | "off">("checking");
  const key = getSyncKey();
  // Base link for the Shortcut's Text action — append the Sum variable after "=".
  const example = `${ORIGIN}/api/health-push?key=${key}&steps=`;

  useEffect(() => {
    if (!open) return;
    setStatus("checking");
    fetchHealthStatus()
      .then((s) => setStatus(s.configured ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Connect Apple Health">
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          {status === "on" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={14} /> Sync is ready
            </span>
          ) : status === "off" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertCircle size={14} /> Sync not set up yet
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full glass-subtle px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Checking…
            </span>
          )}
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          An iPhone <b>Shortcut</b> quietly sends your Health data to the app in the background — no browser, nothing to open. Your steps, weight, sleep and more then show up here every time you open the app.
        </p>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">What it can bring in</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Footprints, label: "Steps" },
              { icon: Flame, label: "Active energy" },
              { icon: Scale, label: "Weight" },
              { icon: Moon, label: "Sleep" },
              { icon: Droplets, label: "Water" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 rounded-xl glass-subtle px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Icon size={15} className="text-slate-400 dark:text-slate-500" /> {label}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Set it up once</h3>
          <ol className="space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
            <li><b>1.</b> Open <b>Shortcuts</b> → <b>＋</b> → add <b>Find Health Samples</b> (e.g. Steps, today).</li>
            <li><b>2.</b> Add <b>Calculate Statistics</b> → <b>Sum</b> of those samples.</li>
            <li><b>3.</b> Add a <b>Text</b> action, paste the link below, and drop the <b>Sum</b> in right after <code className="text-[11px]">steps=</code>.</li>
            <li><b>4.</b> Add <b>Get Contents of URL</b> and set it to that <b>Text</b>. (This sends it silently — don't use “Open URLs”.)</li>
            <li><b>5.</b> Add a daily <b>Automation</b> so it runs on its own.</li>
          </ol>
        </div>

        <div className="rounded-2xl glass-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Your private link</p>
          <p className="text-[12px] font-mono text-slate-700 dark:text-slate-300 break-all">{example}</p>
          <button
            onClick={() => navigator.clipboard?.writeText(example).catch(() => {})}
            className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-400"
          >
            Copy link
          </button>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          The link contains your device's private sync code, so only this phone sees this data. Add more values by putting each Sum after <code className="text-[11px]">&weight=</code>, <code className="text-[11px]">&sleep=</code>, <code className="text-[11px]">&water=</code>. Everything stays editable here.
        </p>
      </div>
    </Sheet>
  );
}
