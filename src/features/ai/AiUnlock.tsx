import { useState } from "react";
import { Lock, Loader2, Sparkles } from "lucide-react";

/** Card shown when the paid AI features are gated behind an access code. */
export default function AiUnlock({
  onSubmit,
  compact,
}: {
  onSubmit: (code: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function go() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr(false);
    const ok = await onSubmit(code);
    setBusy(false);
    if (!ok) setErr(true);
  }

  return (
    <div className="rounded-3xl glass p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="grid place-items-center w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
          <Lock size={20} />
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Unlock AI features</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Enter the access code you were given</p>
        </div>
      </div>

      {!compact && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">
          The Scanner and food analysis run on a shared account. Enter the code once — this device will remember it.
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="password"
          value={code}
          onChange={(e) => { setCode(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="Access code"
          autoComplete="one-time-code"
          className={`flex-1 min-w-0 rounded-xl glass-subtle px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none border ${err ? "border-rose-400" : "border-transparent"}`}
        />
        <button
          onClick={go}
          disabled={busy || !code.trim()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Unlock
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">That code didn't work — double-check it and try again.</p>}
    </div>
  );
}
