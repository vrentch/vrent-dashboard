import { useEffect, useState } from "react";
import { Trash2, Check } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useBusiness, updateReceipt, removeReceipt, rememberVendorCode, type Receipt } from "../../lib/business/store";
import { getImage } from "../../lib/business/images";

const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];

export default function ReceiptSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useBusiness();
  const receipt = s.receipts.find((r) => r.id === id) || null;
  const [d, setD] = useState<Receipt | null>(null);
  const [img, setImg] = useState<string | null>(null);

  useEffect(() => {
    setD(receipt ? { ...receipt } : null);
    setImg(null);
    if (receipt?.hasImage && receipt.id) getImage(receipt.id).then(setImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!d) return <Sheet open={!!id} onClose={onClose} title="Receipt"><div /></Sheet>;

  const field = (patch: Partial<Receipt>) => setD({ ...d, ...patch });

  function save() {
    if (!d) return;
    updateReceipt(d.id, {
      date: d.date, vendor: d.vendor.trim(), amount: Number(d.amount) || 0, currency: d.currency,
      vatAmount: Number(d.vatAmount) || 0, vatRate: Number(d.vatRate) || 0,
      category: d.category.trim(), description: d.description.trim(), bexioCode: d.bexioCode.trim(),
    });
    // Learn this vendor → code so it auto-fills next time.
    rememberVendorCode(d.vendor, d.bexioCode);
    onClose();
  }
  function del() {
    if (d) removeReceipt(d.id);
    onClose();
  }

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title="Receipt"
      footer={
        <div className="flex gap-2">
          <button onClick={del} className="grid place-items-center w-11 shrink-0 rounded-xl glass-subtle text-rose-500 active:scale-95" aria-label="Delete"><Trash2 size={16} /></button>
          <button onClick={save} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold active:scale-[0.98]"><Check size={16} /> Save</button>
        </div>
      }
    >
      <div className="space-y-4">
        {img && <img src={img} alt="" className="w-full max-h-64 object-contain rounded-2xl bg-slate-100 dark:bg-slate-800" />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={d.date} onChange={(e) => field({ date: e.target.value })} className={inputCls} /></Field>
          <Field label="Vendor"><input value={d.vendor} onChange={(e) => field({ vendor: e.target.value })} placeholder="Supplier" className={inputCls} /></Field>
          <Field label="Amount (gross)"><input type="number" inputMode="decimal" value={d.amount || ""} onChange={(e) => field({ amount: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Currency">
            <select value={d.currency} onChange={(e) => field({ currency: e.target.value })} className={inputCls}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="VAT amount"><input type="number" inputMode="decimal" value={d.vatAmount || ""} onChange={(e) => field({ vatAmount: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="VAT rate %"><input type="number" inputMode="decimal" value={d.vatRate || ""} onChange={(e) => field({ vatRate: Number(e.target.value) })} className={inputCls} /></Field>
        </div>

        <Field label="Bexio account code">
          <input
            list="bexio-codes"
            value={d.bexioCode}
            onChange={(e) => field({ bexioCode: e.target.value })}
            placeholder="Type or pick a code…"
            className={inputCls}
          />
          <datalist id="bexio-codes">
            {s.bexioCodes.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.label}</option>)}
          </datalist>
        </Field>

        <Field label="Category"><input value={d.category} onChange={(e) => field({ category: e.target.value })} placeholder="e.g. Software" className={inputCls} /></Field>
        <Field label="Description (for Bexio)"><textarea rows={2} value={d.description} onChange={(e) => field({ description: e.target.value })} className={`${inputCls} resize-none`} /></Field>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">Fields were pre-filled by AI from the image — check the amount, VAT and pick the right Bexio code. Add your codes in Setup.</p>
      </div>
    </Sheet>
  );
}

const inputCls = "mt-1 w-full rounded-xl glass-subtle px-3 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-400 dark:text-slate-500">{label}</span>
      {children}
    </label>
  );
}
