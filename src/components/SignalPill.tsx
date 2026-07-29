import type { SignalTone } from "../lib/api";

const STYLES: Record<SignalTone, string> = {
  pos: "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30",
  neg: "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30",
  neutral: "text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700",
};
const DOT: Record<SignalTone, string> = {
  pos: "bg-emerald-500",
  neg: "bg-rose-500",
  neutral: "bg-slate-400 dark:bg-slate-500",
};

export default function SignalPill({
  label,
  tone,
  size = "sm",
}: {
  label: string;
  tone: SignalTone;
  size?: "sm" | "md";
}) {
  const pad = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${pad} ${STYLES[tone]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  );
}
