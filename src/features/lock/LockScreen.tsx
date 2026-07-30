import { useState } from "react";
import { verifyPasscode, unlock } from "../../lib/lock";
import { Delete } from "lucide-react";

export default function LockScreen() {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  async function push(d: string) {
    const next = (pin + d).slice(0, 8);
    setPin(next);
    if (next.length >= 4 && (await verifyPasscode(next))) {
      unlock();
      return;
    }
    if (next.length >= 8) {
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin("");
      }, 400);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div className="fixed inset-0 z-[100] bg-[#f6f7f9] dark:bg-[#0b1120] flex flex-col items-center justify-center px-8 safe-top safe-bottom">
      <img src="/icon.svg" alt="AC App" className="w-16 h-16 rounded-2xl shadow-lg mb-5" />
      <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">AC App</h1>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 mb-6">Enter your passcode</p>

      <div className={`flex gap-3 mb-8 ${shake ? "animate-[wiggle_0.4s]" : ""}`} style={shake ? { animation: "wiggle 0.4s" } : undefined}>
        {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, i) => (
          <span
            key={i}
            className={`w-3.5 h-3.5 rounded-full transition ${
              i < pin.length ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {keys.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : k === "del" ? (
            <button
              key={i}
              onClick={() => setPin((p) => p.slice(0, -1))}
              className="grid place-items-center w-16 h-16 rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-800"
              aria-label="Delete"
            >
              <Delete size={22} />
            </button>
          ) : (
            <button
              key={i}
              onClick={() => push(k)}
              className="grid place-items-center w-16 h-16 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-2xl font-semibold text-slate-900 dark:text-slate-100 active:scale-95 card-shadow"
            >
              {k}
            </button>
          )
        )}
      </div>
    </div>
  );
}
