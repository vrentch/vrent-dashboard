import { useEffect, useRef, useState } from "react";
import { Receipt as ReceiptIcon, Camera, Settings, Loader2, Share2, FileText, Plus, ChevronDown } from "lucide-react";
import { prepareImage } from "../../lib/image";
import { analyzeReceipt } from "../../lib/api";
import { useAiAccess } from "../../lib/aiAccess";
import AiUnlock from "../ai/AiUnlock";
import {
  useBusiness, addCompany, setActiveCompany, addReceipt, receiptsFor, totalsFor,
} from "../../lib/business/store";
import { putImage, getImage } from "../../lib/business/images";
import { buildReceiptsPdf, shareOrDownloadPdf } from "../../lib/business/export";
import ReceiptSheet from "./ReceiptSheet";
import SetupSheet from "./SetupSheet";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function BusinessScreen() {
  const s = useBusiness();
  const { status: aiStatus, unlock } = useAiAccess();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [companyMenu, setCompanyMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  const activeId = s.activeCompanyId;
  const company = s.companies.find((c) => c.id === activeId) || null;
  const receipts = receiptsFor(s, activeId);
  const totals = totalsFor(receipts);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeId) return;
    setAdding(true);
    try {
      const img = await prepareImage(file, 1700, 0.85);
      let ex: Awaited<ReturnType<typeof analyzeReceipt>>["data"] | null = null;
      if (aiStatus === "ready") {
        const res = await analyzeReceipt(img.base64, img.mediaType);
        if (res.ok && res.data) ex = res.data;
      }
      const id = addReceipt({
        companyId: activeId,
        date: ex?.date || todayISO(),
        vendor: ex?.vendor || "",
        amount: ex?.total || 0,
        currency: ex?.currency || "CHF",
        vatAmount: ex?.vatAmount || 0,
        vatRate: ex?.vatRate || 0,
        category: ex?.category || "",
        description: ex?.description || "",
        bexioCode: "",
        hasImage: true,
      });
      await putImage(id, img.dataUrl);
      setEditId(id);
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  }

  async function doExport() {
    if (!company || receipts.length === 0) return;
    setExporting(true);
    try {
      const blob = await buildReceiptsPdf(company, receipts);
      await shareOrDownloadPdf(blob, `${company.name.replace(/\s+/g, "_")}_receipts_${todayISO()}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Business</h1>
            {company ? (
              <button onClick={() => setCompanyMenu((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                {company.name} <ChevronDown size={13} />
              </button>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">Receipts & expenses for Bexio</p>
            )}
          </div>
          <button onClick={() => setSetupOpen(true)} className="grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95" aria-label="Setup"><Settings size={18} /></button>
        </div>
        {companyMenu && s.companies.length > 0 && (
          <div className="max-w-lg mx-auto px-4 pb-2 flex flex-wrap gap-2">
            {s.companies.map((c) => (
              <button key={c.id} onClick={() => { setActiveCompany(c.id); setCompanyMenu(false); }} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${c.id === activeId ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}>{c.name}</button>
            ))}
            <button onClick={() => { setCompanyMenu(false); setSetupOpen(true); }} className="px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-brand-600 dark:text-brand-400 inline-flex items-center gap-1"><Plus size={12} /> New</button>
          </div>
        )}
      </header>

      <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {aiStatus === "locked" && <AiUnlock onSubmit={unlock} compact />}

        {!company ? (
          <div className="rounded-3xl glass p-6 text-center">
            <ReceiptIcon size={30} className="mx-auto text-slate-400 dark:text-slate-500" />
            <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">Create your company</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-3">e.g. Vrent GmbH — then scan receipts into it.</p>
            <button onClick={() => { addCompany("Vrent GmbH"); setSetupOpen(true); }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold"><Plus size={15} /> Add company</button>
          </div>
        ) : (
          <>
            {/* Capture */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={adding}
              className="w-full relative overflow-hidden rounded-3xl p-5 text-white active:scale-[0.99] transition disabled:opacity-70"
              style={{ background: "linear-gradient(135deg, #27272a 0%, #18181b 55%, #09090b 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
            >
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-12 h-12 rounded-2xl bg-white/15 backdrop-blur">
                  {adding ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
                </span>
                <div className="text-left">
                  <p className="text-base font-bold">{adding ? "Reading receipt…" : "Add a receipt"}</p>
                  <p className="text-[12px] text-white/80">Photo or screenshot — AI fills in the details</p>
                </div>
              </div>
            </button>

            {/* Totals */}
            <div className="grid grid-cols-3 gap-2">
              <Tile label="Receipts" value={String(totals.count)} />
              <Tile label="Total" value={totals.gross ? totals.gross.toFixed(0) : "—"} />
              <Tile label="VAT" value={totals.vat ? totals.vat.toFixed(0) : "—"} />
            </div>

            {/* Export */}
            <button onClick={doExport} disabled={exporting || receipts.length === 0} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl glass text-sm font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.98] disabled:opacity-50">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Export all as one PDF → email
            </button>

            {/* List */}
            {receipts.length > 0 ? (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Receipts</h2>
                <div className="space-y-2">
                  {receipts.map((r) => (
                    <button key={r.id} onClick={() => setEditId(r.id)} className="w-full flex items-center gap-3 rounded-2xl glass-subtle p-2.5 text-left active:scale-[0.99] transition">
                      <Thumb id={r.id} hasImage={r.hasImage} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{r.vendor || "Untitled receipt"}</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{r.date || "—"}{r.category ? ` · ${r.category}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{r.amount ? `${r.currency} ${r.amount.toFixed(2)}` : "—"}</p>
                        <span className={`text-[10px] font-semibold ${r.bexioCode ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{r.bexioCode ? `Bexio ${r.bexioCode}` : "needs code"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="rounded-2xl glass-subtle p-5 text-center text-sm text-slate-500 dark:text-slate-400">
                <FileText size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                No receipts yet. Tap <b>Add a receipt</b> to scan one or add a screenshot.
              </div>
            )}
          </>
        )}
      </div>

      <ReceiptSheet id={editId} onClose={() => setEditId(null)} />
      <SetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl glass p-3 text-center">
      <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function Thumb({ id, hasImage }: { id: string; hasImage: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (hasImage) getImage(id).then((v) => { if (alive) setSrc(v); });
    return () => { alive = false; };
  }, [id, hasImage]);
  return (
    <span className="grid place-items-center w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden">
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <ReceiptIcon size={16} className="text-slate-400 dark:text-slate-500" />}
    </span>
  );
}
