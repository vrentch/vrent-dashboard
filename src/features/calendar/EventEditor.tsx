import { useEffect, useState } from "react";
import Sheet from "../../components/Sheet";
import { CATEGORIES, REMIND_OPTIONS, saveEvent, deleteEvent, type CalEvent, todayKey } from "../../lib/calendar";
import { Trash2, Clock } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  event?: CalEvent | null;
  defaultDate?: string;
}

export default function EventEditor({ open, onClose, event, defaultDate }: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate || todayKey());
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [category, setCategory] = useState("work");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [remind, setRemind] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setDate(event.date);
      setAllDay(event.allDay);
      setStart(event.start || "09:00");
      setEnd(event.end || "10:00");
      setCategory(event.category);
      setLocation(event.location || "");
      setNotes(event.notes || "");
      setRemind(event.remind ?? null);
    } else {
      setTitle("");
      setDate(defaultDate || todayKey());
      setAllDay(false);
      setStart("09:00");
      setEnd("10:00");
      setCategory("work");
      setLocation("");
      setNotes("");
      setRemind(null);
    }
  }, [open, event, defaultDate]);

  function save() {
    if (!title.trim()) return;
    saveEvent({
      id: event?.id,
      title: title.trim(),
      date,
      allDay,
      start: allDay ? undefined : start,
      end: allDay ? undefined : end,
      category,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      remind,
      done: event?.done ?? false,
    });
    onClose();
  }

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      footer={
        <div className="flex items-center gap-3">
          {event && (
            <button
              onClick={() => {
                deleteEvent(event.id);
                onClose();
              }}
              className="grid place-items-center w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 active:scale-95"
              aria-label="Delete"
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            onClick={save}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-900 dark:bg-slate-700 active:scale-[0.98]"
          >
            {event ? "Save changes" : "Add to calendar"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title"
          className="w-full px-3 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-base font-semibold text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500"
          autoFocus
        />

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition active:scale-95 ${
                  on ? "text-white border-transparent" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                }`}
                style={on ? { backgroundColor: c.color } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? "#fff" : c.color }} />
                {c.label}
              </button>
            );
          })}
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`mt-1.5 ${inputCls}`} />
        </div>

        <label className="flex items-center justify-between py-1">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">All day</span>
          <button
            onClick={() => setAllDay((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition ${allDay ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`}
            aria-pressed={allDay}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${allDay ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </label>

        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Start</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`mt-1.5 ${inputCls}`} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">End</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`mt-1.5 ${inputCls}`} />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Location (optional)</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Zoom, Office" className={`mt-1.5 ${inputCls}`} />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <Clock size={12} /> Reminder
          </label>
          <select value={String(remind)} onChange={(e) => setRemind(e.target.value === "null" ? null : Number(e.target.value))} className={`mt-1.5 ${inputCls}`}>
            {REMIND_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Details…" className={`mt-1.5 ${inputCls} resize-none`} />
        </div>
      </div>
    </Sheet>
  );
}
