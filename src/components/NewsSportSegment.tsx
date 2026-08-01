import { Newspaper, Trophy } from "lucide-react";

export type NewsMode = "news" | "sport";

// The shared News ⇄ Sport switch that lives in both the News and Sport headers,
// so the two live under one bottom-bar tab.
export default function NewsSportSegment({ mode, onMode }: { mode: NewsMode; onMode: (m: NewsMode) => void }) {
  return (
    <div className="segment inline-flex text-sm font-semibold">
      {([["news", "News", Newspaper], ["sport", "Sport", Trophy]] as const).map(([m, label, Icon]) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onMode(m)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] transition ${
              active ? "segment-pill text-brand-700 dark:text-brand-300" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <Icon size={15} strokeWidth={active ? 2.5 : 2} /> {label}
          </button>
        );
      })}
    </div>
  );
}
