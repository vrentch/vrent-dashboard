import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Search, Languages, Sparkles, RotateCcw, X, Loader2, Trash2, MessageCircle, Send } from "lucide-react";
import { analyzeImage, aiTranslate, aiExplain, aiChat, type Identified, type ChatTurn } from "../../lib/api";
import { prepareImage } from "../../lib/image";
import { useAiAccess } from "../../lib/aiAccess";
import AiUnlock from "../ai/AiUnlock";
import Sheet from "../../components/Sheet";

const CATEGORY_EMOJI: Record<string, string> = {
  Object: "📦", Product: "🛍️", Plant: "🌿", Animal: "🐾", Food: "🍽️", Landmark: "🏛️",
  Artwork: "🎨", Text: "📝", Person: "🧑", Vehicle: "🚗", Nature: "🏞️", Other: "🔎",
};
const emojiFor = (c: string) => CATEGORY_EMOJI[c] || "🔎";

const LANGS = ["English", "German", "French", "Italian", "Spanish"];
const HISTORY_KEY = "vrent.scans.v1";

interface ScanRecord {
  title: string;
  category: string;
  summary: string;
  searchQuery: string;
  at: number;
}

function loadHistory(): ScanRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function ScanScreen() {
  const { status, unlock } = useAiAccess();
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Identified | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanRecord[]>(loadHistory);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [imgB64, setImgB64] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState("image/jpeg");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const img = await prepareImage(file);
      setPreview(img.dataUrl);
      setImgB64(img.base64);
      setMediaType(img.mediaType);
      const res = await analyzeImage<Identified>("identify", img.base64, img.mediaType);
      if (!res.ok || !res.data) {
        setError(res.configured === false ? "AI isn't set up yet." : res.error || "Couldn't analyze that photo.");
      } else {
        setResult(res.data);
        const rec: ScanRecord = {
          title: res.data.title, category: res.data.category, summary: res.data.summary,
          searchQuery: res.data.searchQuery, at: Date.now(),
        };
        const next = [rec, ...history].slice(0, 12);
        setHistory(next);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* quota */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
    setImgB64(null);
  }

  function persistHistory(next: ScanRecord[]) {
    setHistory(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }
  const deleteHistory = (i: number) => persistHistory(history.filter((_, idx) => idx !== i));
  const clearHistory = () => persistHistory([]);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 pt-3 pb-3">
          <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Scanner</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500">Point, snap & let AI tell you what it is</p>
        </div>
      </header>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />

      <div className="max-w-lg md:max-w-3xl mx-auto px-4 py-4 space-y-5">
        {status === "off" && <AiOffNotice />}
        {status === "locked" && <AiUnlock onSubmit={unlock} />}

        {/* Capture / preview */}
        {status === "locked" ? null : !preview ? (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={status === "loading"}
            className="w-full relative overflow-hidden rounded-3xl p-8 text-white active:scale-[0.99] transition disabled:opacity-60"
            style={{ background: "linear-gradient(140deg, #312e81 0%, #1e1b4b 52%, #0b0b14 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}
          >
            <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex flex-col items-center gap-3">
              <div className="grid place-items-center w-16 h-16 rounded-2xl bg-white/20 backdrop-blur">
                <Camera size={30} />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">Scan something</p>
                <p className="text-sm text-white/80">Take a photo or choose one</p>
              </div>
            </div>
          </button>
        ) : (
          <div className="rounded-3xl overflow-hidden glass relative">
            <img src={preview} alt="" className="w-full max-h-72 object-cover" />
            <button onClick={reset} className="absolute top-3 right-3 grid place-items-center w-9 h-9 rounded-full bg-black/50 text-white active:scale-95">
              <X size={18} />
            </button>
            {loading && (
              <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm text-white">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Loader2 size={18} className="animate-spin" /> Analyzing…
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-2xl glass-subtle p-4 text-sm text-rose-600 dark:text-rose-400">
            {error}
            <button onClick={() => fileRef.current?.click()} className="ml-2 underline font-semibold">Try again</button>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="rounded-3xl glass p-5 space-y-4 animate-in">
            <div className="flex items-start gap-3">
              <span className="text-3xl leading-none">{emojiFor(result.category)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">{result.category}</p>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">{result.title}</h2>
              </div>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{result.summary}</p>

            {Array.isArray(result.details) && result.details.length > 0 && (
              <div className="rounded-2xl glass-subtle divide-y divide-white/40 dark:divide-white/5">
                {result.details.map((d, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{d.label}</span>
                    <span className="text-[13px] font-medium text-slate-800 dark:text-slate-200 text-right">{d.value}</span>
                  </div>
                ))}
              </div>
            )}

            {result.detectedText?.trim() && (
              <div className="rounded-2xl glass-subtle p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Detected text</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-4">{result.detectedText}</p>
              </div>
            )}

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2">
              <ActionBtn icon={Search} label="Find online" onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(result.searchQuery || result.title)}`, "_blank")} />
              <ActionBtn icon={Languages} label="Translate" onClick={() => setTranslateOpen(true)} />
              <ActionBtn icon={Sparkles} label="Explain" onClick={() => setExplainOpen(true)} />
            </div>

            {/* Ask AI about this photo */}
            <button onClick={() => setChatOpen(true)} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-sm font-bold active:scale-[0.98] transition" style={{ background: "linear-gradient(140deg, #312e81 0%, #0f0e20 100%)" }}>
              <MessageCircle size={16} /> Ask AI about this
            </button>

            <button onClick={() => fileRef.current?.click()} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-[0.98]">
              <RotateCcw size={15} /> Scan another
            </button>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Recent scans</h2>
              <button onClick={clearHistory} className="text-xs font-semibold text-slate-400 dark:text-slate-500 active:text-rose-500">Clear all</button>
            </div>
            <div className="space-y-2">
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded-2xl glass-subtle p-3">
                  <button
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(h.searchQuery || h.title)}`, "_blank")}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left active:opacity-70"
                  >
                    <span className="text-2xl leading-none">{emojiFor(h.category)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{h.title}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{h.summary}</p>
                    </div>
                  </button>
                  <button onClick={() => deleteHistory(i)} className="grid place-items-center w-8 h-8 shrink-0 rounded-full text-slate-300 dark:text-slate-600 active:text-rose-500" aria-label="Delete scan">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {!preview && history.length === 0 && status === "ready" && (
          <button onClick={() => fileRef.current?.click()} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl glass-subtle text-sm font-medium text-slate-600 dark:text-slate-300">
            <ImageIcon size={16} /> Choose from library
          </button>
        )}
      </div>

      {result && (
        <>
          <TranslateSheet open={translateOpen} onClose={() => setTranslateOpen(false)} source={result.detectedText?.trim() || result.summary} hasText={!!result.detectedText?.trim()} />
          <ExplainSheet open={explainOpen} onClose={() => setExplainOpen(false)} topic={result.title} />
          <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} image={imgB64} mediaType={mediaType} subject={result.title} />
        </>
      )}
    </div>
  );
}

function ChatSheet({ open, onClose, image, mediaType, subject }: { open: boolean; onClose: () => void; image: string | null; mediaType: string; subject: string }) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setMessages([]); setInput(""); setErr(null); }
  }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  const suggestions = ["Where can I buy this?", "Tell me more", "Is it worth it?", "Translate any text"];

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setInput("");
    setErr(null);
    const next = [...messages, { role: "user" as const, text: t }];
    setMessages(next);
    setSending(true);
    try {
      const r = await aiChat(image, mediaType, next);
      if (r.ok && r.reply) setMessages((m) => [...m, { role: "assistant", text: r.reply! }]);
      else setErr(r.needCode ? "Enter your access code first." : r.error || "Couldn't get a reply.");
    } catch {
      setErr("Couldn't get a reply.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Ask about ${subject}`}>
      <div className="space-y-3">
        <div className="space-y-2.5 max-h-[46vh] overflow-y-auto no-scrollbar pr-0.5">
          {messages.length === 0 && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 py-2">Ask anything about the photo — identify details, find where to buy it, translate text on it, or give a task.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line ${m.role === "user" ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium" : "glass-subtle text-slate-800 dark:text-slate-100"}`}>
                {m.text}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3.5 py-2 glass-subtle text-slate-500 dark:text-slate-400"><Loader2 size={15} className="animate-spin" /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {err && <p className="text-[12px] text-rose-600 dark:text-rose-400">{err}</p>}

        {messages.length === 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {suggestions.map((sug) => (
              <button key={sug} onClick={() => send(sug)} className="shrink-0 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-600 dark:text-slate-300 active:scale-95">{sug}</button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
            placeholder="Ask a question…"
            className="flex-1 min-w-0 rounded-full glass-subtle px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
          />
          <button onClick={() => send(input)} disabled={!input.trim() || sending} className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-90 disabled:opacity-40">
            <Send size={16} />
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Search; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 py-3 rounded-2xl glass-subtle active:scale-95 transition">
      <Icon size={18} className="text-brand-600 dark:text-brand-400" />
      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{label}</span>
    </button>
  );
}

function TranslateSheet({ open, onClose, source, hasText }: { open: boolean; onClose: () => void; source: string; hasText: boolean }) {
  const [lang, setLang] = useState("English");
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<{ translation: string; sourceLang: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(target: string) {
    setLoading(true);
    setErr(null);
    setOut(null);
    try {
      const r = await aiTranslate(source, target);
      if (r.ok && r.data) setOut(r.data);
      else setErr(r.error || "Translation failed");
    } catch {
      setErr("Translation failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) { setOut(null); setErr(null); run(lang); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Translate">
      <div className="space-y-4">
        {!hasText && <p className="text-xs text-slate-400 dark:text-slate-500">No text found in the image — translating the description instead.</p>}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {LANGS.map((l) => (
            <button key={l} onClick={() => { setLang(l); run(l); }} className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${l === lang ? "bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700" : "glass-subtle text-slate-600 dark:text-slate-300 border-transparent"}`}>{l}</button>
          ))}
        </div>
        <div className="rounded-2xl glass-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Original</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{source}</p>
        </div>
        <div className="rounded-2xl bg-brand-50 dark:bg-brand-500/15 p-3 min-h-[64px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400 mb-1">{lang}</p>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 size={15} className="animate-spin" /> Translating…</div>
          ) : err ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
          ) : (
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{out?.translation}</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function ExplainSheet({ open, onClose, topic }: { open: boolean; onClose: () => void; topic: string }) {
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<{ explanation: string; keyPoints: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    setOut(null);
    aiExplain(topic)
      .then((r) => { if (r.ok && r.data) setOut(r.data); else setErr(r.error || "Failed"); })
      .catch(() => setErr("Failed"))
      .finally(() => setLoading(false));
  }, [open, topic]);

  return (
    <Sheet open={open} onClose={onClose} title={`About ${topic}`}>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Thinking…</div>
      ) : err ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">{out?.explanation}</p>
          {out?.keyPoints?.length ? (
            <div className="rounded-2xl glass-subtle p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">Key points</p>
              <ul className="space-y-1.5">
                {out.keyPoints.map((k, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300"><span className="text-brand-500">•</span> {k}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function AiOffNotice() {
  return (
    <div className="rounded-2xl glass-subtle p-4">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI isn't switched on yet</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
        The Scanner and food analysis need an Anthropic API key. Add <code className="px-1 rounded bg-slate-200/70 dark:bg-slate-700 text-[11px]">ANTHROPIC_API_KEY</code> in your Vercel project settings, then redeploy. See Settings → AI features for the steps.
      </p>
    </div>
  );
}
