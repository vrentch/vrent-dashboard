import { useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import type { BexioCode } from "../../lib/business/store";

// A tap-to-open Bexio code picker. Replaces the native <datalist>, which iOS
// Safari / installed PWAs don't render — so on iPhone the old dropdown showed
// nothing. This is a plain button + list that works everywhere, with search
// and the option to enter a custom code.
export default function CodePicker({
  value,
  codes,
  onChange,
}: {
  value: string;
  codes: BexioCode[];
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = codes.find((c) => c.code === value);
  const qt = q.trim();
  const filtered = codes.filter(
    (c) => !qt || c.code.includes(qt) || c.label.toLowerCase().includes(qt.toLowerCase())
  );
  const customAvailable = !!qt && !codes.some((c) => c.code === qt);

  function choose(code: string) {
    onChange(code);
    setOpen(false);
    setQ("");
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium flex items-center justify-between gap-2 text-left"
      >
        <span className={value ? "text-slate-900 dark:text-slate-100 truncate" : "text-slate-400 dark:text-slate-500"}>
          {value ? `${value}${selected ? " — " + selected.label : ""}` : "Pick a Bexio code…"}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-xl overflow-hidden border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-black/5 dark:border-white/10">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode="text"
              placeholder="Search or type a code"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => choose(c.code)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 w-11 shrink-0">{c.code}</span>
                <span className="flex-1 min-w-0 text-sm text-slate-600 dark:text-slate-300 truncate">{c.label}</span>
                {value === c.code && <Check size={15} className="text-emerald-500 shrink-0" />}
              </button>
            ))}
            {customAvailable && (
              <button
                type="button"
                onClick={() => choose(qt)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left active:bg-black/5 dark:active:bg-white/10 border-t border-black/5 dark:border-white/10"
              >
                <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">Use “{qt}”</span>
              </button>
            )}
            {filtered.length === 0 && !customAvailable && (
              <p className="px-3 py-3 text-sm text-slate-400 dark:text-slate-500">No codes yet — add them in Setup.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
