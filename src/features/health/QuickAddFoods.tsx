import { useState } from "react";
import { addFood, addWater } from "../../lib/health";

type QuickItem = {
  emoji: string;
  name: string;
  kind: "food" | "water";
  kcal?: number;
  p?: number;
  c?: number;
  f?: number;
  ml?: number;
};

// One-tap logging for the things people have constantly. Water items go to the
// water tracker; everything else logs as a meal with rough macros.
const ITEMS: QuickItem[] = [
  { emoji: "💧", name: "Water 250", kind: "water", ml: 250 },
  { emoji: "💧", name: "Water 500", kind: "water", ml: 500 },
  { emoji: "💧", name: "Water 1L", kind: "water", ml: 1000 },
  { emoji: "☕️", name: "Espresso", kind: "food", kcal: 5, p: 0, c: 1, f: 0 },
  { emoji: "☕️", name: "Cappuccino", kind: "food", kcal: 120, p: 6, c: 10, f: 6 },
  { emoji: "☕️", name: "Latte", kind: "food", kcal: 150, p: 8, c: 12, f: 6 },
  { emoji: "🍵", name: "Tea", kind: "food", kcal: 2, p: 0, c: 0, f: 0 },
  { emoji: "🥤", name: "Protein shake", kind: "food", kcal: 160, p: 30, c: 6, f: 3 },
  { emoji: "🥤", name: "Cola", kind: "food", kcal: 140, p: 0, c: 39, f: 0 },
  { emoji: "🥤", name: "Diet cola", kind: "food", kcal: 1, p: 0, c: 0, f: 0 },
  { emoji: "🍺", name: "Beer", kind: "food", kcal: 150, p: 2, c: 13, f: 0 },
  // Wine by the glass (1.5 dl) and the two apéro classics.
  { emoji: "🍷", name: "Red wine", kind: "food", kcal: 125, p: 0, c: 4, f: 0 },
  { emoji: "🥂", name: "White wine", kind: "food", kcal: 120, p: 0, c: 4, f: 0 },
  { emoji: "🌸", name: "Rosé", kind: "food", kcal: 125, p: 0, c: 6, f: 0 },
  { emoji: "🍹", name: "Aperol spritz", kind: "food", kcal: 175, p: 0, c: 17, f: 0 },
  { emoji: "🍸", name: "Gin tonic", kind: "food", kcal: 170, p: 0, c: 16, f: 0 },
  { emoji: "🍌", name: "Banana", kind: "food", kcal: 105, p: 1, c: 27, f: 0 },
  { emoji: "🍎", name: "Apple", kind: "food", kcal: 95, p: 0, c: 25, f: 0 },
  { emoji: "🥚", name: "Egg", kind: "food", kcal: 78, p: 6, c: 1, f: 5 },
  { emoji: "🍫", name: "Choc bar", kind: "food", kcal: 230, p: 3, c: 30, f: 12 },
];

export default function QuickAddFoods({ date }: { date?: string }) {
  const [added, setAdded] = useState<string | null>(null);

  function add(it: QuickItem) {
    if (it.kind === "water") {
      addWater(it.ml || 0, date);
    } else {
      addFood({ date, name: it.name, calories: it.kcal || 0, protein_g: it.p || 0, carbs_g: it.c || 0, fat_g: it.f || 0 });
    }
    setAdded(it.name);
    window.setTimeout(() => setAdded((a) => (a === it.name ? null : a)), 1400);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Quick add</h2>
        {added && <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Added {added} ✓</span>}
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        {ITEMS.map((it) => (
          <button
            key={it.name}
            onClick={() => add(it)}
            className="shrink-0 flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-2xl glass-subtle active:scale-95 transition min-w-[74px]"
          >
            <span className="text-xl leading-none">{it.emoji}</span>
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">{it.name}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{it.kind === "water" ? `${it.ml}ml` : `${it.kcal} kcal`}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
