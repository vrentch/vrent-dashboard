import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** A mobile bottom-sheet modal with backdrop. */
export default function Sheet({ open, onClose, title, children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full sm:max-w-lg max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-ink-900 border border-white/10 shadow-2xl animate-in">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <div className="mx-auto sm:mx-0">
            <div className="sm:hidden w-10 h-1 rounded-full bg-white/20 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid place-items-center w-9 h-9 rounded-full bg-white/5 text-slate-300 active:scale-95"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-white/10 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}
