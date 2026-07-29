import type { SignalTone } from "../lib/api";

const STYLES: Record<SignalTone, string> = {
  pos: "text-emerald-700 bg-emerald-50 border-emerald-200",
  neg: "text-rose-700 bg-rose-50 border-rose-200",
  neutral: "text-slate-600 bg-slate-100 border-slate-200",
};
const DOT: Record<SignalTone, string> = {
  pos: "bg-emerald-500",
  neg: "bg-rose-500",
  neutral: "bg-slate-400",
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
