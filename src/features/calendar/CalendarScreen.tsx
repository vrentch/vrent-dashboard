import { useMemo, useState } from "react";
import { Plus, Bell, MapPin, CalendarDays, Check } from "lucide-react";
import {
  useEvents,
  eventsOn,
  upcoming,
  categoryOf,
  toggleDone,
  deleteEvent,
  todayKey,
  toKey,
  type CalEvent,
} from "../../lib/calendar";
import SwipeRow from "../../components/SwipeRow";
import MonthGrid from "./MonthGrid";
import EventEditor from "./EventEditor";

type View = "agenda" | "month";

function dayLabel(key: string): string {
  const today = todayKey();
  const tomorrow = toKey(new Date(Date.now() + 86400000));
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  const d = new Date(key + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export default function CalendarScreen() {
  const events = useEvents();
  const [view, setView] = useState<View>("agenda");
  const [selected, setSelected] = useState(todayKey());
  const [month, setMonth] = useState(() => new Date());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);

  function openNew(date?: string) {
    setEditing(null);
    setEditorOpen(true);
    setSelected(date || selected);
  }
  function openEdit(ev: CalEvent) {
    setEditing(ev);
    setEditorOpen(true);
  }

  const agendaGroups = useMemo(() => {
    const list = upcoming(events, todayKey());
    const groups: { key: string; items: CalEvent[] }[] = [];
    for (const e of list) {
      let g = groups.find((x) => x.key === e.date);
      if (!g) {
        g = { key: e.date, items: [] };
        groups.push(g);
      }
      g.items.push(e);
    }
    return groups;
  }, [events]);

  const dayEvents = eventsOn(events, selected);

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Calendar</h1>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {events.length} {events.length === 1 ? "event" : "events"} · saved on this device
              </p>
            </div>
            <button
              onClick={() => openNew()}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold active:scale-95"
            >
              <Plus size={16} /> New
            </button>
          </div>

          <div className="mt-3 inline-flex p-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-sm">
            {(["agenda", "month"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-full font-medium capitalize transition ${
                  view === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {view === "agenda" && (
          <>
            {agendaGroups.length === 0 && <Empty onAdd={() => openNew()} />}
            {agendaGroups.map((g) => (
              <section key={g.key}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{dayLabel(g.key)}</h2>
                <div className="space-y-2">
                  {g.items.map((ev) => (
                    <EventRow key={ev.id} ev={ev} onEdit={() => openEdit(ev)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {view === "month" && (
          <>
            <MonthGrid
              month={month}
              events={events}
              selected={selected}
              onSelectDay={setSelected}
              onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{dayLabel(selected)}</h2>
              <button onClick={() => openNew(selected)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                <Plus size={14} /> Add
              </button>
            </div>
            {dayEvents.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">Nothing on this day.</p>
            ) : (
              <div className="space-y-2">
                {dayEvents.map((ev) => (
                  <EventRow key={ev.id} ev={ev} onEdit={() => openEdit(ev)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <EventEditor open={editorOpen} onClose={() => setEditorOpen(false)} event={editing} defaultDate={selected} />
    </div>
  );
}

function EventRow({ ev, onEdit }: { ev: CalEvent; onEdit: () => void }) {
  const cat = categoryOf(ev.category);
  const time = ev.allDay ? "All day" : `${ev.start ?? ""}${ev.end ? " – " + ev.end : ""}`;
  return (
    <SwipeRow onDelete={() => deleteEvent(ev.id)}>
    <div className="flex items-stretch gap-3 p-3 glass">
      <span className="w-1 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleDone(ev.id);
        }}
        className={`grid place-items-center w-6 h-6 shrink-0 self-center rounded-full border-2 transition ${
          ev.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600 text-transparent"
        }`}
        aria-label="Toggle done"
      >
        <Check size={13} strokeWidth={3} />
      </button>
      <button onClick={onEdit} className="flex-1 min-w-0 text-left active:opacity-70">
        <p className={`text-[15px] font-semibold ${ev.done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100"}`}>
          {ev.title}
        </p>
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 mt-0.5 flex-wrap">
          <span className="font-medium" style={{ color: cat.color }}>{cat.label}</span>
          <span>· {time}</span>
          {ev.location && (
            <span className="inline-flex items-center gap-0.5">
              · <MapPin size={11} /> {ev.location}
            </span>
          )}
          {ev.remind != null && <Bell size={11} className="text-brand-500" />}
        </div>
        {ev.notes && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">{ev.notes}</p>}
      </button>
    </div>
    </SwipeRow>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-16 px-6">
      <CalendarDays className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={36} />
      <p className="text-slate-500 dark:text-slate-400 text-sm">No upcoming events.</p>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-semibold">
        <Plus size={15} /> Add your first event
      </button>
    </div>
  );
}
