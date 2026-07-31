import { useState } from "react";
import { Trash2, Download, Copy, Check, FolderOpen } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useLibrary, groupByCategory, deleteItem, type LibraryItem } from "../../lib/studio/library";
import { downloadDataUrl } from "../../lib/studio/render";

/** Past creations, grouped under the categories the AI assigned. */
export default function LibraryView() {
  const { items, loading } = useLibrary();
  const [filter, setFilter] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<LibraryItem | null>(null);

  if (loading) {
    return <div className="rounded-3xl glass p-8 text-center text-sm text-slate-400">Loading your library…</div>;
  }
  if (!items.length) {
    return (
      <div className="rounded-3xl glass p-8 flex flex-col items-center gap-3 text-center">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
          <FolderOpen size={24} />
        </div>
        <div>
          <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Nothing here yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Everything you create is saved here, sorted into categories by the AI.</p>
        </div>
      </div>
    );
  }

  const groups = groupByCategory(items);
  const shown = filter ? groups.filter((g) => g.category === filter) : groups;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        <Chip label={`All (${items.length})`} on={!filter} onClick={() => setFilter(null)} />
        {groups.map((g) => (
          <Chip key={g.category} label={`${g.category} (${g.items.length})`} on={filter === g.category} onClick={() => setFilter(filter === g.category ? null : g.category)} />
        ))}
      </div>

      {shown.map((g) => (
        <div key={g.category}>
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-2">{g.category}</p>
          <div className="grid grid-cols-3 gap-2">
            {g.items.map((it) => (
              <button key={it.id} onClick={() => setOpenItem(it)} className="relative aspect-[4/5] rounded-2xl overflow-hidden active:scale-95 transition">
                <img src={it.renders.post || it.photos[0]} alt={it.concept} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ))}

      <ItemSheet item={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3.5 py-2 rounded-full text-[13px] font-semibold transition active:scale-95 ${
        on ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function ItemSheet({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!item) return null;
  const caption = `${item.pkg.post.caption}\n\n${item.pkg.post.hashtags.join(" ")}`;

  return (
    <Sheet open onClose={onClose} title={item.pkg.concept || item.category}>
      <div className="space-y-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {item.renders.post && <img src={item.renders.post} alt="Post" className="h-56 rounded-2xl" />}
          {item.renders.story && <img src={item.renders.story} alt="Story" className="h-56 rounded-2xl" />}
          {item.renders.cover && <img src={item.renders.cover} alt="Reel cover" className="h-56 rounded-2xl" />}
        </div>

        <div className="flex flex-wrap gap-2">
          {item.renders.post && (
            <ActionBtn icon={Download} label="Post" onClick={() => downloadDataUrl(item.renders.post!, "instagram-post.jpg")} />
          )}
          {item.renders.story && (
            <ActionBtn icon={Download} label="Story" onClick={() => downloadDataUrl(item.renders.story!, "instagram-story.jpg")} />
          )}
          {item.renders.cover && (
            <ActionBtn icon={Download} label="Cover" onClick={() => downloadDataUrl(item.renders.cover!, "reel-cover.jpg")} />
          )}
          <ActionBtn
            icon={copied ? Check : Copy}
            label={copied ? "Copied" : "Caption"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(caption);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch { /* clipboard unavailable */ }
            }}
          />
          <ActionBtn
            icon={Trash2}
            label="Delete"
            danger
            onClick={async () => {
              await deleteItem(item.id);
              onClose();
            }}
          />
        </div>

        <div className="rounded-2xl glass-subtle p-4">
          <p className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{item.pkg.post.caption}</p>
          <p className="text-[12px] text-sky-600 dark:text-sky-400 mt-2 break-words">{item.pkg.post.hashtags.join(" ")}</p>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Created {new Date(item.createdAt).toLocaleDateString()} · {item.prompt || "no prompt"}
        </p>
      </div>
    </Sheet>
  );
}

function ActionBtn({ icon: Icon, label, onClick, danger }: { icon: typeof Download; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold active:scale-95 ${
        danger ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400" : "glass-subtle text-slate-600 dark:text-slate-300"
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
