import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import { setPasscode } from "../../lib/lock";

export default function PasscodeSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPin("");
      setConfirm("");
      setError("");
    }
  }, [open]);

  async function save() {
    if (pin.length < 4) {
      setError("Use at least 4 digits.");
      return;
    }
    if (pin !== confirm) {
      setError("The two entries don't match.");
      return;
    }
    await setPasscode(pin);
    onClose();
  }

  const inputCls =
    "w-full text-center tracking-[0.5em] text-xl px-3 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set app passcode"
      footer={
        <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-900 dark:bg-slate-700 active:scale-[0.98]">
          Turn on app lock
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You'll enter this passcode each time you open AC App on this device. Choose 4–8 digits.
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          type="password"
          inputMode="numeric"
          placeholder="New passcode"
          className={inputCls}
          autoFocus
        />
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))}
          type="password"
          inputMode="numeric"
          placeholder="Confirm passcode"
          className={inputCls}
        />
        {error && <p className="text-sm text-rose-600 dark:text-rose-400 text-center">{error}</p>}
      </div>
    </Sheet>
  );
}
