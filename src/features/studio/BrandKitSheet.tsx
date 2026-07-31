import { useRef, useState } from "react";
import { Upload, Trash2, Check } from "lucide-react";
import Sheet from "../../components/Sheet";
import { useBrand, setBrand, prepareLogo, type BrandKit } from "../../lib/studio/brand";

const LANGS = ["English", "German", "French", "Italian", "Spanish"];

/** Edit the brand kit the Studio stamps on every design. */
export default function BrandKitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const brand = useBrand();
  const [draft, setDraft] = useState<BrandKit | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const b = draft ?? brand;
  const patch = (p: Partial<BrandKit>) => setDraft({ ...b, ...p });

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      patch({ logo: await prepareLogo(file) });
    } catch {
      /* unreadable file — keep the current logo */
    }
  }

  function save() {
    if (draft) setBrand(draft);
    setDraft(null);
    onClose();
  }

  const field =
    "w-full rounded-xl glass-subtle px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400";
  const label = "text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 block";

  return (
    <Sheet
      open={open}
      onClose={() => { setDraft(null); onClose(); }}
      title="Brand kit"
      footer={
        <button
          onClick={save}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold active:scale-[0.98]"
        >
          <Check size={16} /> Save brand kit
        </button>
      }
    >
      <input ref={fileRef} type="file" accept="image/*" onChange={onLogo} className="hidden" />
      <div className="space-y-4">
        <div>
          <span className={label}>Logo (PNG with transparency looks best)</span>
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-20 h-20 rounded-2xl glass-subtle overflow-hidden">
              {b.logo ? <img src={b.logo} alt="Logo" className="max-w-[70%] max-h-[70%] object-contain" /> : <span className="text-xs text-slate-400">None</span>}
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl glass text-[13px] font-semibold text-slate-700 dark:text-slate-200 active:scale-95">
                <Upload size={14} /> Upload
              </button>
              {b.logo && (
                <button onClick={() => patch({ logo: null })} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold text-rose-500 active:scale-95">
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div>
          <span className={label}>Business name</span>
          <input value={b.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. VRent" className={field} />
        </div>
        <div>
          <span className={label}>Instagram handle</span>
          <input value={b.handle} onChange={(e) => patch({ handle: e.target.value })} placeholder="@yourbusiness" className={field} />
        </div>
        <div>
          <span className={label}>Tagline</span>
          <input value={b.tagline} onChange={(e) => patch({ tagline: e.target.value })} placeholder="Short slogan" className={field} />
        </div>
        <div>
          <span className={label}>About the business (helps the AI write on-brand)</span>
          <textarea value={b.about} onChange={(e) => patch({ about: e.target.value })} rows={3} placeholder="What you do, who your customers are, your vibe…" className={`${field} resize-none`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>Primary color</span>
            <input type="color" value={b.primary} onChange={(e) => patch({ primary: e.target.value })} className="w-full h-11 rounded-xl glass-subtle p-1 cursor-pointer" />
          </div>
          <div>
            <span className={label}>Secondary color</span>
            <input type="color" value={b.secondary} onChange={(e) => patch({ secondary: e.target.value })} className="w-full h-11 rounded-xl glass-subtle p-1 cursor-pointer" />
          </div>
        </div>
        <div>
          <span className={label}>Caption language</span>
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <button
                key={l}
                onClick={() => patch({ language: l })}
                className={`px-3.5 py-2 rounded-full text-[13px] font-semibold transition active:scale-95 ${
                  b.language === l ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900" : "glass-subtle text-slate-600 dark:text-slate-300"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
