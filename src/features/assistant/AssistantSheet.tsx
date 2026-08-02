import { useEffect, useRef, useState } from "react";
import { Mic, Send, Loader2, Volume2, VolumeX, Sparkles, Square } from "lucide-react";
import Sheet from "../../components/Sheet";
import { aiAssistant } from "../../lib/api";
import {
  useHealth, macrosOn, calorieTarget, stepsOn, waterOn, foodsOn, todayKey, foodHints,
  addFood, addWater, setSteps, addWeight, addActivity, rememberFood,
} from "../../lib/health";
import { useBusiness, receiptsFor, receiptsInMonth, totalsFor } from "../../lib/business/store";
import { useEvents, upcoming, saveEvent } from "../../lib/calendar";

type Msg = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "How many calories can I still eat?",
  "Log 2 boiled eggs and a coffee",
  "Open my markets",
  "Add dentist tomorrow at 3pm",
  "What's my spend this month?",
];

// Web Speech API (voice input) — available on Chrome/Android; iOS falls back to
// the keyboard's dictation mic.
const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

export default function AssistantSheet({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (tab: string) => void }) {
  const h = useHealth();
  const biz = useBusiness();
  const events = useEvents();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Stop any speech / recognition when the sheet closes.
  useEffect(() => {
    if (!open) {
      try { recRef.current?.stop(); } catch { /* noop */ }
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
      setListening(false);
    }
  }, [open]);

  function buildContext() {
    const today = todayKey();
    const eaten = macrosOn(h, today);
    const target = calorieTarget(h.profile);
    const activeId = biz.activeCompanyId;
    const company = biz.companies.find((c) => c.id === activeId);
    const month = today.slice(0, 7);
    const monthReceipts = activeId ? receiptsInMonth(receiptsFor(biz, activeId), month) : [];
    const bt = totalsFor(monthReceipts);
    return {
      date: today,
      health: {
        calories_eaten: Math.round(eaten.calories),
        calorie_target: target,
        calories_left: Math.max(0, target - Math.round(eaten.calories)),
        protein_g: Math.round(eaten.protein_g),
        carbs_g: Math.round(eaten.carbs_g),
        fat_g: Math.round(eaten.fat_g),
        steps: stepsOn(h, today),
        water_ml: waterOn(h, today),
        meals_today: foodsOn(h, today).length,
        your_foods: foodHints(8),
      },
      business: company ? { company: company.name, month, receipts: bt.count, spend_chf: Math.round(bt.gross), vat_chf: Math.round(bt.vat) } : null,
      upcoming_events: upcoming(events, today).slice(0, 6).map((e) => ({ title: e.title, date: e.date, time: e.start || "", done: !!e.done })),
    };
  }

  function runActions(actions: any[]) {
    let nav: string | null = null;
    for (const a of actions || []) {
      try {
        switch (a?.type) {
          case "navigate": nav = a.tab; break;
          case "log_food":
            addFood({ name: a.name, calories: Math.round(a.calories || 0), protein_g: Math.round(a.protein_g || 0), carbs_g: Math.round(a.carbs_g || 0), fat_g: Math.round(a.fat_g || 0) });
            if (a.calories > 0) rememberFood({ name: a.name, unit: a.unit || "g", quantity: a.quantity || 1, calories: a.calories, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g });
            break;
          case "log_water": addWater(Math.round(a.ml || 0)); break;
          case "log_steps": setSteps(Math.round(a.steps || 0)); break;
          case "log_weight": addWeight(a.kg || 0); break;
          case "log_activity": addActivity({ kind: "workout", label: a.label || "Workout", minutes: Math.round(a.minutes || 0), calories: Math.round(a.calories || 0) }); break;
          case "add_event": saveEvent({ title: a.title || "Event", date: a.date || todayKey(), allDay: !a.time, start: a.time || undefined, category: a.category || "other", remind: null }); break;
        }
      } catch { /* skip a bad action */ }
    }
    if (nav) setTimeout(() => { onNavigate(nav as string); onClose(); }, 650);
  }

  function speak(text: string) {
    if (!speakOn) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* TTS unavailable */ }
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setHint(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await aiAssistant(q, buildContext());
      if (r.ok && r.data) {
        const reply = r.data.reply || "Done.";
        setMessages((m) => [...m, { role: "assistant", text: reply }]);
        runActions(r.data.actions || []);
        speak(reply);
      } else {
        const err = r.needCode ? "Enter your access code in Settings first." : r.error || "Sorry, I couldn't do that.";
        setMessages((m) => [...m, { role: "assistant", text: err }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong. Try again." }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (!SR) {
      inputRef.current?.focus();
      setHint("Voice isn't available here — tap the 🎤 on your keyboard to dictate.");
      return;
    }
    if (listening) { try { recRef.current?.stop(); } catch { /* noop */ } return; }
    try {
      const rec = new SR();
      recRef.current = rec;
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e: any) => {
        const t = e.results?.[0]?.[0]?.transcript || "";
        setListening(false);
        if (t) send(t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask AI"
      footer={
        <div>
          {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2 px-1">{hint}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMic}
              className={`grid place-items-center w-11 h-11 shrink-0 rounded-full active:scale-95 transition ${listening ? "bg-rose-500 text-white" : "accent-gradient text-white shadow-accent"}`}
              aria-label="Voice"
            >
              {listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={listening ? "Listening…" : "Ask or tell me anything…"}
              className="flex-1 min-w-0 rounded-full glass-subtle px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none"
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="grid place-items-center w-11 h-11 shrink-0 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-95 disabled:opacity-40"
              aria-label="Send"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}
            </button>
          </div>
        </div>
      }
    >
      <div ref={scrollRef} className="min-h-[280px] max-h-[52vh] overflow-y-auto -mx-1 px-1">
        {messages.length === 0 ? (
          <div className="py-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="grid place-items-center w-9 h-9 rounded-xl accent-gradient text-white shrink-0"><Sparkles size={17} /></span>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Your assistant</p>
                <p className="text-[12px] text-slate-500 dark:text-slate-400">Log food, open sections, add events, ask about your day.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-left rounded-xl glass-subtle px-3 py-2.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 active:scale-[0.99]">
                  “{s}”
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 py-1">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-800 dark:text-slate-100"}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="glass-subtle rounded-2xl px-3.5 py-2.5"><Loader2 size={15} className="animate-spin text-slate-400" /></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/10">
        <button onClick={() => setSpeakOn((v) => !v)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 active:scale-95">
          {speakOn ? <Volume2 size={14} /> : <VolumeX size={14} />} {speakOn ? "Voice replies on" : "Voice replies off"}
        </button>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 active:scale-95">Clear</button>
        )}
      </div>
    </Sheet>
  );
}
