import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import { CheckCircle2, AlertCircle, Wallet, Zap } from "lucide-react";
import { getWalletKey } from "../../lib/money/store";
import { fetchHealthStatus } from "../../lib/api";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://ac-news-tau.vercel.app";

// Apple Pay auto-tracking: an iOS Shortcuts "Transaction" automation fires on
// every Apple Pay payment and silently pushes amount + merchant to the app.
export default function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<"checking" | "on" | "off">("checking");
  const key = getWalletKey();
  const example = `${ORIGIN}/api/money-push?key=${key}&amount=`;

  useEffect(() => {
    if (!open) return;
    setStatus("checking");
    // Same storage backend as health sync — one check covers both.
    fetchHealthStatus()
      .then((s) => setStatus(s.configured ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Track Apple Pay automatically">
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          {status === "on" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={14} /> Server ready
            </span>
          ) : status === "off" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertCircle size={14} /> Storage not configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full glass-subtle px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Checking…</span>
          )}
        </div>

        <div className="flex items-start gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient-soft text-brand-600 dark:text-brand-300 shrink-0"><Zap size={17} /></span>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Every time you pay with <b>Apple Pay</b>, your iPhone can send the amount and shop name here — instantly and silently. You pick which cards; the expense appears in Money with a guessed category (Migros → Groceries, SBB → Transport…), and you can edit or swipe it away.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Set it up once (~2 min)</h3>
          <ol className="space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
            <li><b>1.</b> Open <b>Shortcuts</b> → <b>Automation</b> tab → <b>＋</b> → scroll to <b>Transaction</b>.</li>
            <li><b>2.</b> Select the <b>cards</b> you want tracked → choose <b>Run Immediately</b> → Next.</li>
            <li><b>3.</b> Add a <b>Text</b> action and paste your private link below. Right after <code className="text-[11px]">amount=</code> insert the automation's <b>Amount</b> variable, then add <code className="text-[11px]">&merchant=</code> and insert the <b>Merchant</b> variable, then <code className="text-[11px]">&card=</code> with the <b>Card</b> variable.</li>
            <li><b>4.</b> Add <b>Get Contents of URL</b> and point it at that Text. (Not "Open URLs" — this one is silent.)</li>
            <li><b>5.</b> Done. Pay somewhere with Apple Pay and open Money — the expense is there.</li>
          </ol>
        </div>

        <div className="rounded-2xl glass-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Your private link</p>
          <p className="text-[12px] font-mono text-slate-700 dark:text-slate-300 break-all">{example}</p>
          <button onClick={() => navigator.clipboard?.writeText(example).catch(() => {})} className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-400">
            Copy link
          </button>
        </div>

        <div className="rounded-2xl glass-subtle p-3 flex items-start gap-2">
          <Wallet size={15} className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Works for Apple Pay payments with the cards you select (physical-card swipes don't trigger iPhone automations — add those manually). The link holds this phone's private code; transactions are kept 90 days on the server, then only in your app.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
