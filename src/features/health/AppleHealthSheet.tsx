import Sheet from "../../components/Sheet";
import { Footprints, Scale, Moon, Droplets, Flame } from "lucide-react";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://ac-news-tau.vercel.app";

export default function AppleHealthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const example = `${ORIGIN}/?steps=[Steps]&weight=[Weight]&sleep=[Sleep]&water=[Water]&kcal=[Active Energy]`;

  return (
    <Sheet open={open} onClose={onClose} title="Connect Apple Health">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          iPhone web apps can't read Health directly, but you can push your data in with a quick <b>Shortcut</b> — one tap (or a daily automation) sends your steps, weight, sleep and more straight into your log.
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Set it up once (5 min)</h3>
          <ol className="space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
            <li><b>1.</b> Open the <b>Shortcuts</b> app → <b>＋</b> → new shortcut.</li>
            <li><b>2.</b> Add <b>Find Health Samples</b> (e.g. Steps, Today) to get each value you want.</li>
            <li><b>3.</b> Add <b>Open URLs</b> and paste the link below, replacing each <code className="text-[11px]">[Value]</code> with the matching Health variable.</li>
            <li><b>4.</b> Run it — AC App opens and logs the data. Add it as a <b>daily automation</b> to keep steps in sync automatically.</li>
          </ol>
        </div>

        <div className="rounded-2xl glass-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Your link</p>
          <p className="text-[12px] font-mono text-slate-700 dark:text-slate-300 break-all">{example}</p>
          <button
            onClick={() => navigator.clipboard?.writeText(example).catch(() => {})}
            className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-400"
          >
            Copy link
          </button>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Only include the values you want — any you leave out are simply skipped. Everything stays on your phone and remains editable here.
        </p>
      </div>
    </Sheet>
  );
}
