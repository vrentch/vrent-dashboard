import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt as ReceiptIcon, Camera, Settings, Loader2, Share2, FileText, Plus, ChevronDown, Mail } from "lucide-react";
import { prepareImage } from "../../lib/image";
import { analyzeReceipt } from "../../lib/api";
import { useAiAccess } from "../../lib/aiAccess";
import AiUnlock from "../ai/AiUnlock";
import {
  useBusiness, addCompany, setActiveCompany, addReceipt, receiptsFor, removeReceipt,
  suggestCodeForVendor, monthsWith, receiptsInMonth,
} from "../../lib/business/store";
import SwipeRow from "../../components/SwipeRow";
import { chf, monthChip, monthLabel } from "../../lib/business/format";
import { putImage, getImage } from "../../lib/business/images";
import { buildReceiptsZip, shareOrDownloadFile } from "../../lib/business/export";
import ReceiptSheet from "./ReceiptSheet";
import EmailImportSheet from "./EmailImportSheet";
import SetupSheet from "./SetupSheet";
import ImageCropper from "./ImageCropper";
import Stats from "./Stats";

const todayISO = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => todayISO().slice(0, 7);

export default function BusinessScreen() {
  const s = useBusiness();
  const { status: aiStatus, unlock } = useAiAccess();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [companyMenu, setCompanyMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null); // shown in the crop editor
  const [scope, setScope] = useState<string>(thisMonth()); // "all" or "YYYY-MM"

  const activeId = s.activeCompanyId;
  const company = s.companies.find((c) => c.id === activeId) || null;
  const allReceipts = receiptsFor(s, activeId);
  const months = useMemo(() => monthsWith(allReceipts), [allReceipts]);
  // The receipts shown/exported/analysed for the selected month (or all).
  const receipts = useMemo(() => receiptsInMonth(allReceipts, scope), [allReceipts, scope]);

  // Step 1: turn the picked file (photo, screenshot, or PDF invoice) into a
  // data URL and hand it to the crop editor.
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeId) return;
    setAdding(true);
    try {
      const { isPdf } = await import("../../lib/business/pdf");
      let src: string;
      if (isPdf(file)) {
        const { renderPdfFirstPage } = await import("../../lib/business/pdf");
        src = await renderPdfFirstPage(file, 1900);
      } else {
        // Load at a generous size so cropping stays sharp; final capped later.
        src = (await prepareImage(file, 2200, 0.92)).dataUrl;
      }
      setCropSrc(src);
    } catch {
      /* ignore unreadable file */
    } finally {
      setAdding(false);
    }
  }

  // Step 2: user confirmed the crop → downscale, run AI, store, open the sheet.
  async function onCropDone(dataUrl: string) {
    if (!activeId) { setCropSrc(null); return; }
    setAdding(true);
    try {
      const img = await prepareImage(dataUrl, 1700, 0.85);
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
        // Auto-fill the code the user has used for this vendor before.
        bexioCode: suggestCodeForVendor(ex?.vendor || ""),
        hasImage: true,
      });
      await putImage(id, img.dataUrl);
      setCropSrc(null);
      setEditId(id);
    } catch {
      setCropSrc(null);
    } finally {
      setAdding(false);
    }
  }

  async function doExport() {
    if (!company || receipts.length === 0) return;
    setExporting(true);
    try {
      const tag = scope === "all" ? "all" : scope;
      const blob = await buildReceiptsZip(company, receipts, s.bexioCodes, tag);
      await shareOrDownloadFile(blob, `${company.name.replace(/\s+/g, "_")}_receipts_${tag}.zip`);
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

      <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onPick} className="hidden" />

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
              style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b14 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
            >
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-12 h-12 rounded-2xl bg-white/15 backdrop-blur">
                  {adding ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
                </span>
                <div className="text-left">
                  <p className="text-base font-bold">{adding ? "Reading receipt…" : "Add a receipt"}</p>
                  <p className="text-[12px] text-white/80">Photo, screenshot or PDF invoice — crop, then AI fills it in</p>
                </div>
              </div>
            </button>

            {/* Email invoices */}
            <button
              onClick={() => setEmailOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl glass text-sm font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.98]"
            >
              <Mail size={16} className="text-brand-600 dark:text-brand-400" /> Import from Gmail — scan for invoices
            </button>

            {/* Month selector */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-0.5">
              {[thisMonth(), ...months.filter((m) => m !== thisMonth())].map((m) => (
                <button
                  key={m}
                  onClick={() => setScope(m)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${scope === m ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}
                >
                  {m === thisMonth() ? "This month" : monthChip(m)}
                </button>
              ))}
              <button
                onClick={() => setScope("all")}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${scope === "all" ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"}`}
              >
                All time
              </button>
            </div>

            {/* Statistics */}
            <Stats receipts={receipts} all={allReceipts} codes={s.bexioCodes} scope={scope} onPickMonth={setScope} />

            {/* Export */}
            <button onClick={doExport} disabled={exporting || receipts.length === 0} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl glass text-sm font-semibold text-slate-800 dark:text-slate-100 active:scale-[0.98] disabled:opacity-50">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
              {scope === "all" ? " Export all — summary + files (zip)" : ` Export ${monthLabel(scope)} — summary + files (zip)`}
            </button>

            {/* List */}
            {receipts.length > 0 ? (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                  {scope === "all" ? "All receipts" : monthLabel(scope)} · {receipts.length}
                </h2>
                <div className="space-y-2">
                  {receipts.map((r) => (
                    <SwipeRow key={r.id} onDelete={() => removeReceipt(r.id)}>
                      <button onClick={() => setEditId(r.id)} className="w-full flex items-center gap-3 glass-subtle p-2.5 text-left active:scale-[0.99] transition">
                        <Thumb id={r.id} hasImage={r.hasImage} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{r.vendor || "Untitled receipt"}</p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">{r.date || "—"}{r.category ? ` · ${r.category}` : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{r.amount ? chf(r.amount, r.currency || "CHF") : "—"}</p>
                          <span className={`text-[10px] font-semibold ${r.bexioCode ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{r.bexioCode ? `Bexio ${r.bexioCode}` : "needs code"}</span>
                        </div>
                      </button>
                    </SwipeRow>
                  ))}
                </div>
              </section>
            ) : (
              <div className="rounded-2xl glass-subtle p-5 text-center text-sm text-slate-500 dark:text-slate-400">
                <FileText size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                {allReceipts.length === 0
                  ? <>No receipts yet. Tap <b>Add a receipt</b> to scan one or add a screenshot.</>
                  : <>No receipts in {monthLabel(scope)}. Pick another month above.</>}
              </div>
            )}
          </>
        )}
      </div>

      {cropSrc && (
        <ImageCropper
          src={cropSrc}
          busy={adding}
          onCancel={() => setCropSrc(null)}
          onDone={onCropDone}
        />
      )}
      {activeId && (
        <EmailImportSheet
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          companyId={activeId}
          aiReady={aiStatus === "ready"}
          onAdded={(id) => setEditId(id)}
        />
      )}
      {/* Mounted after the email sheet so the confirm sheet stacks on top of it. */}
      <ReceiptSheet id={editId} onClose={() => setEditId(null)} />
      <SetupSheet open={setupOpen} onClose={() => setSetupOpen(false)} />
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
