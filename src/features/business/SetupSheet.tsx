import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  useBusiness, addCompany, renameCompany, removeCompany,
  addBexioCode, removeBexioCode,
} from "../../lib/business/store";

export default function SetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useBusiness();
  const [newCo, setNewCo] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  return (
    <Sheet open={open} onClose={onClose} title="Business setup">
      <div className="space-y-6">
        {/* Companies */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Companies</h3>
          <div className="space-y-2">
            {s.companies.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl glass-subtle px-3 py-2">
                <input
                  value={c.name}
                  onChange={(e) => renameCompany(c.id, e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none"
                />
                <button onClick={() => removeCompany(c.id)} className="grid place-items-center w-7 h-7 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Delete company"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={newCo} onChange={(e) => setNewCo(e.target.value)} placeholder="e.g. Vrent GmbH" className="flex-1 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <button onClick={() => { if (newCo.trim()) { addCompany(newCo); setNewCo(""); } }} className="inline-flex items-center gap-1 px-3 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-95"><Plus size={15} /> Add</button>
          </div>
        </section>

        {/* Bexio codes */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Bexio account codes</h3>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2">Add the account codes you use in Bexio so you can pick them per receipt.</p>
          <div className="space-y-2">
            {s.bexioCodes.map((b) => (
              <div key={b.code} className="flex items-center gap-2 rounded-xl glass-subtle px-3 py-2">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">{b.code}</span>
                <span className="flex-1 min-w-0 text-sm text-slate-600 dark:text-slate-300 truncate">{b.label}</span>
                <button onClick={() => removeBexioCode(b.code)} className="grid place-items-center w-7 h-7 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Delete code"><Trash2 size={14} /></button>
              </div>
            ))}
            {s.bexioCodes.length === 0 && <p className="text-[13px] text-slate-500 dark:text-slate-400">No codes yet.</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-20 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label e.g. Büromaterial" className="flex-1 min-w-0 rounded-xl glass-subtle px-3 py-2.5 text-sm outline-none text-slate-900 dark:text-slate-100" />
            <button onClick={() => { if (code.trim()) { addBexioCode(code, label); setCode(""); setLabel(""); } }} className="inline-flex items-center px-3 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-95"><Plus size={15} /></button>
          </div>
        </section>
      </div>
    </Sheet>
  );
}
