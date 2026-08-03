import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Loader2, Plus, RefreshCw, X, FileText, Paperclip, Check, EyeOff, Eye } from "lucide-react";
import Sheet from "../../components/Sheet";
import {
  gmailStatus, gmailConnectUrl, gmailScan, gmailFetch, gmailDisconnect,
  analyzeReceipt, aiReceiptFromText, type GmailEmail,
} from "../../lib/api";
import { prepareImage } from "../../lib/image";
import { useBusiness, addReceipt, markEmail, unmarkEmail, emailKey, suggestCodeForVendor } from "../../lib/business/store";
import { putImage } from "../../lib/business/images";

const todayISO = () => new Date().toISOString().slice(0, 10);

function b64ToFile(b64: string, filename: string, mime: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

// Scan connected Gmail inboxes for invoices and turn them into Business
// receipts one by one — Accept runs the same AI extraction as a scanned photo;
// Ignore hides the email from future scans.
export default function EmailImportSheet({
  open, onClose, companyId, aiReady, onAdded,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  aiReady: boolean;
  onAdded: (receiptId: string) => void;
}) {
  const s = useBusiness();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [emails, setEmails] = useState<GmailEmail[] | null>(null);
  const [days, setDays] = useState(90);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showHandled, setShowHandled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const st = await gmailStatus();
      setConfigured(st.configured);
      setAccounts(st.accounts || []);
      return st;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (open) { setError(""); setEmails(null); refreshStatus(); }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open, refreshStatus]);

  // After the user taps Connect, Google opens in a browser tab — poll until the
  // mailbox shows up so the sheet updates by itself when they come back.
  function connect() {
    window.open(gmailConnectUrl(), "_blank");
    if (pollRef.current) clearInterval(pollRef.current);
    const before = accounts.length;
    pollRef.current = setInterval(async () => {
      const st = await refreshStatus();
      if (st && (st.accounts?.length || 0) > before && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }

  async function disconnect(email: string) {
    const res = await gmailDisconnect(email);
    if (res?.ok) setAccounts(res.accounts || []);
  }

  async function scan(d = days) {
    setScanning(true);
    setError("");
    try {
      const res = await gmailScan(d);
      if (!res.ok) { setError(res.error || "Scan failed — try again."); return; }
      setEmails(res.emails || []);
      setAccounts(res.accounts || accounts);
    } catch {
      setError("Scan failed — check your connection and try again.");
    } finally {
      setScanning(false);
    }
  }

  // Accept: pull the attachment (or email text), run the receipt AI, store it,
  // and open the normal confirm sheet so the user checks vendor/amount/code.
  async function accept(e: GmailEmail) {
    setBusyId(e.id);
    setError("");
    try {
      // Prefer a PDF attachment, then any image; fall back to the email text.
      const att = e.atts.find((a) => /pdf/i.test(a.mime) || /\.pdf$/i.test(a.filename)) || e.atts[0];
      if (att) {
        const res = await gmailFetch(e.account, e.id, att.id);
        if (!res.ok || !res.data) { setError(res.error || "Could not download the attachment."); return; }
        const file = b64ToFile(res.data, att.filename, att.mime || "application/pdf");
        const { isPdf, renderPdfFirstPage } = await import("../../lib/business/pdf");
        const src = isPdf(file) ? await renderPdfFirstPage(file, 1900) : (await prepareImage(file, 2200, 0.92)).dataUrl;
        const img = await prepareImage(src, 1700, 0.85);
        let ex: Awaited<ReturnType<typeof analyzeReceipt>>["data"] | null = null;
        if (aiReady) {
          const ai = await analyzeReceipt(img.base64, img.mediaType);
          if (ai.ok && ai.data) ex = ai.data;
        }
        const id = addReceipt({
          companyId,
          date: ex?.date || e.date || todayISO(),
          vendor: ex?.vendor || e.from,
          amount: ex?.total || 0,
          currency: ex?.currency || "CHF",
          vatAmount: ex?.vatAmount || 0,
          vatRate: ex?.vatRate || 0,
          category: ex?.category || "",
          description: ex?.description || e.subject,
          bexioCode: suggestCodeForVendor(ex?.vendor || e.from),
          hasImage: true,
        });
        await putImage(id, img.dataUrl);
        markEmail(e.account, e.id, "added");
        onAdded(id);
      } else {
        // No attachment — the invoice lives in the email body itself.
        if (!aiReady) { setError("Unlock AI first — text invoices need it to read the details."); return; }
        const res = await gmailFetch(e.account, e.id);
        if (!res.ok || !res.text) { setError(res.error || "Could not read the email."); return; }
        const ai = await aiReceiptFromText(`From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${res.text}`);
        if (!ai.ok || !ai.data) { setError(ai.error || "AI could not read this invoice."); return; }
        const ex = ai.data;
        // Render the email itself into a receipt document, so text-only
        // invoices get a visual file for the list, sheet and ZIP export too.
        let docUrl = "";
        try {
          const { renderEmailDocument } = await import("../../lib/business/emailDoc");
          docUrl = renderEmailDocument({ from: e.from, subject: e.subject, date: e.date, account: e.account }, res.text);
        } catch { /* data-only receipt if rendering fails */ }
        const id = addReceipt({
          companyId,
          date: ex.date || e.date || todayISO(),
          vendor: ex.vendor || e.from,
          amount: ex.total || 0,
          currency: ex.currency || "CHF",
          vatAmount: ex.vatAmount || 0,
          vatRate: ex.vatRate || 0,
          category: ex.category || "",
          description: ex.description || e.subject,
          bexioCode: suggestCodeForVendor(ex.vendor || e.from),
          hasImage: !!docUrl,
        });
        if (docUrl) await putImage(id, docUrl);
        markEmail(e.account, e.id, "added");
        onAdded(id);
      }
    } catch {
      setError("Something went wrong reading that email — try again.");
    } finally {
      setBusyId(null);
    }
  }

  const visible = (emails || []).filter((e) => showHandled || !s.emailStatus[emailKey(e.account, e.id)]);
  const handledCount = (emails || []).length - (emails || []).filter((e) => !s.emailStatus[emailKey(e.account, e.id)]).length;

  return (
    <Sheet open={open} onClose={onClose} title="Email invoices">
      <div className="space-y-4">
        {configured === false && (
          <div className="rounded-2xl glass-subtle p-4 text-sm text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-slate-100 mb-1">One-time server setup needed</p>
            Gmail import needs Google API keys on the server (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in Vercel). Ask Claude for the step-by-step — it takes ~10 minutes.
          </div>
        )}

        {configured && (
          <>
            {/* Connected mailboxes */}
            <div className="flex flex-wrap items-center gap-2">
              {accounts.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Mail size={12} className="text-brand-600 dark:text-brand-400" /> {a}
                  <button onClick={() => disconnect(a)} className="grid place-items-center w-5 h-5 rounded-full text-slate-400 active:scale-90" aria-label={`Disconnect ${a}`}><X size={12} /></button>
                </span>
              ))}
              <button onClick={connect} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-brand-600 dark:text-brand-400 active:scale-95">
                <Plus size={12} /> {accounts.length ? "Add mailbox" : "Connect Gmail"}
              </button>
            </div>
            {accounts.length === 0 && (
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                Read-only access — the app can look for invoices but never send, change or delete anything. You approve it on Google's own page.
              </p>
            )}

            {accounts.length > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <button onClick={() => scan()} disabled={scanning} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl accent-gradient text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-60">
                    {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {scanning ? "Scanning inboxes…" : "Scan for invoices"}
                  </button>
                  <select value={days} onChange={(ev) => { const d = Number(ev.target.value); setDays(d); if (emails) scan(d); }} className="rounded-xl glass-subtle px-2.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none">
                    <option value={30}>30 days</option>
                    <option value={90}>3 months</option>
                    <option value={180}>6 months</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>

                {emails && (
                  <div className="flex items-baseline justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {visible.length} to review{handledCount > 0 ? ` · ${handledCount} handled` : ""}
                    </p>
                    {handledCount > 0 && (
                      <button onClick={() => setShowHandled((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                        {showHandled ? <EyeOff size={11} /> : <Eye size={11} />} {showHandled ? "Hide handled" : "Show handled"}
                      </button>
                    )}
                  </div>
                )}

                {emails && visible.length === 0 && (
                  <div className="rounded-2xl glass-subtle p-5 text-center text-sm text-slate-500 dark:text-slate-400">
                    {emails.length === 0 ? "No invoice-looking emails found in this period." : "All caught up — every found invoice is handled."}
                  </div>
                )}

                <div className="space-y-2">
                  {visible.map((e) => {
                    const status = s.emailStatus[emailKey(e.account, e.id)];
                    const busy = busyId === e.id;
                    return (
                      <div key={`${e.account}:${e.id}`} className={`rounded-2xl glass-subtle p-3 ${status ? "opacity-60" : ""}`}>
                        <div className="flex items-start gap-2.5">
                          <span className="grid place-items-center w-9 h-9 rounded-xl bg-white/60 dark:bg-white/5 shrink-0 text-slate-500 dark:text-slate-400">
                            {e.atts.length ? <Paperclip size={15} /> : <FileText size={15} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{e.from}</p>
                            <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{e.subject}</p>
                            <p className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {e.date}{e.atts.length ? ` · ${e.atts[0].filename}` : " · text invoice"}{accounts.length > 1 ? ` · ${e.account}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {status ? (
                            <>
                              <span className={`flex-1 text-[11px] font-semibold ${status === "added" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`}>
                                {status === "added" ? "✓ Added to receipts" : "Ignored"}
                              </span>
                              {status === "added" ? (
                                <button onClick={() => accept(e)} disabled={busy || busyId != null} className="px-3 py-1.5 rounded-lg glass-subtle text-[11px] font-semibold text-brand-600 dark:text-brand-400 active:scale-[0.97] disabled:opacity-50">
                                  {busy ? "Reading…" : "Add again"}
                                </button>
                              ) : (
                                <button onClick={() => unmarkEmail(e.account, e.id)} className="px-3 py-1.5 rounded-lg glass-subtle text-[11px] font-semibold text-brand-600 dark:text-brand-400 active:scale-[0.97]">
                                  Undo
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <button onClick={() => accept(e)} disabled={busy || busyId != null} className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold active:scale-[0.97] disabled:opacity-50">
                                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                {busy ? "Reading…" : "Add"}
                              </button>
                              <button onClick={() => markEmail(e.account, e.id, "ignored")} disabled={busy} className="px-3.5 py-2 rounded-lg glass-subtle text-xs font-semibold text-slate-500 dark:text-slate-400 active:scale-[0.97]">
                                Ignore
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {error && <p className="text-[12px] font-medium text-rose-600 dark:text-rose-400">{error}</p>}
        {configured === null && <div className="py-6 grid place-items-center"><Loader2 size={18} className="animate-spin text-slate-400" /></div>}
      </div>
    </Sheet>
  );
}
