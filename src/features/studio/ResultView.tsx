import { useState } from "react";
import { Copy, Check, Download, Share2, Clapperboard, Loader2, RefreshCw, Plus, Lightbulb, Music } from "lucide-react";
import type { LibraryItem } from "../../lib/studio/library";
import { useBrand } from "../../lib/studio/brand";
import { loadImage, renderScene, downloadDataUrl, downloadBlob, shareImage } from "../../lib/studio/render";
import { exportReelVideo, videoExportSupported } from "../../lib/studio/video";

type Tab = "post" | "story" | "reel";

export default function ResultView({
  item,
  onRegenerate,
  onNew,
}: {
  item: LibraryItem;
  onRegenerate: (revision: string) => void;
  onNew: () => void;
}) {
  const [tab, setTab] = useState<Tab>("post");
  const [revision, setRevision] = useState("");

  return (
    <div className="space-y-4 animate-in">
      <div className="rounded-3xl glass p-4">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{item.category}</p>
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{item.pkg.concept || "Your content is ready"}</p>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl glass-subtle">
        {(["post", "story", "reel"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2 rounded-xl text-sm font-semibold capitalize transition ${
              tab === t ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white card-shadow" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "post" && <PostTab item={item} />}
      {tab === "story" && <StoryTab item={item} />}
      {tab === "reel" && <ReelTab item={item} />}

      {(item.pkg.tips.length > 0 || item.pkg.alternatives.length > 0) && (
        <div className="rounded-3xl glass p-4 space-y-2">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 dark:text-slate-100">
            <Lightbulb size={15} /> AI suggestions
          </p>
          {item.pkg.tips.map((t, i) => (
            <p key={`t${i}`} className="text-[13px] text-slate-600 dark:text-slate-300">• {t}</p>
          ))}
          {item.pkg.alternatives.map((a, i) => (
            <p key={`a${i}`} className="text-[13px] text-slate-400 dark:text-slate-500">↳ Next time: {a}</p>
          ))}
        </div>
      )}

      <div className="rounded-3xl glass p-4">
        <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-2">Not quite right?</p>
        <div className="flex gap-2">
          <input
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            placeholder="e.g. shorter caption, warmer tone…"
            className="flex-1 min-w-0 rounded-xl glass-subtle px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => { onRegenerate(revision); setRevision(""); }}
            className="grid place-items-center px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-95"
            aria-label="Regenerate"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <button onClick={onNew} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl glass text-sm font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98]">
        <Plus size={16} /> New creation
      </button>
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch { /* clipboard unavailable */ }
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-600 dark:text-slate-300 active:scale-95"
    >
      {done ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {done ? "Copied" : label}
    </button>
  );
}

function SaveShareRow({ dataUrl, filename, shareText }: { dataUrl?: string; filename: string; shareText?: string }) {
  if (!dataUrl) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => downloadDataUrl(dataUrl, filename)}
        className="flex items-center justify-center gap-2 py-3 rounded-2xl glass text-sm font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98]"
      >
        <Download size={16} /> Download
      </button>
      <button
        onClick={async () => {
          const ok = await shareImage(dataUrl, filename, shareText);
          if (!ok) downloadDataUrl(dataUrl, filename);
        }}
        className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold active:scale-[0.98]"
      >
        <Share2 size={16} /> Share
      </button>
    </div>
  );
}

function Preview({ src, ratio }: { src?: string; ratio: string }) {
  if (!src) return null;
  return (
    <div className={`rounded-3xl overflow-hidden card-shadow mx-auto ${ratio === "story" ? "max-w-[260px]" : ""}`}>
      <img src={src} alt="Preview" className="w-full" style={{ aspectRatio: ratio === "story" ? "9/16" : "4/5" }} />
    </div>
  );
}

function PostTab({ item }: { item: LibraryItem }) {
  const fullCaption = `${item.pkg.post.caption}\n\n${item.pkg.post.hashtags.join(" ")}`;
  return (
    <div className="space-y-3">
      <Preview src={item.renders.post} ratio="post" />
      <SaveShareRow dataUrl={item.renders.post} filename="instagram-post.jpg" shareText={fullCaption} />
      <div className="rounded-3xl glass p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Caption</p>
          <CopyBtn text={fullCaption} label="Copy all" />
        </div>
        <p className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{item.pkg.post.caption}</p>
        <p className="text-[12px] text-sky-600 dark:text-sky-400 mt-3 break-words">{item.pkg.post.hashtags.join(" ")}</p>
      </div>
    </div>
  );
}

function StoryTab({ item }: { item: LibraryItem }) {
  return (
    <div className="space-y-3">
      <Preview src={item.renders.story} ratio="story" />
      <SaveShareRow dataUrl={item.renders.story} filename="instagram-story.jpg" />
      {item.pkg.story.sticker && (
        <div className="rounded-3xl glass p-4">
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-1">Engagement sticker idea</p>
          <p className="text-[13px] text-slate-600 dark:text-slate-300">{item.pkg.story.sticker}</p>
        </div>
      )}
    </div>
  );
}

function ReelTab({ item }: { item: LibraryItem }) {
  const brand = useBrand();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const reel = item.pkg.reel;
  const fullCaption = reel.caption || item.pkg.post.caption;

  async function exportVideo() {
    setExporting(true);
    setErr(null);
    setProgress(0);
    try {
      const photos = await Promise.all(item.photos.map(loadImage));
      const logo = brand.logo ? await loadImage(brand.logo).catch(() => null) : null;
      const accent = reel.cover.accentColor || "#ffffff";
      const scenes = reel.scenes.length ? reel.scenes : [{ text: reel.hook, photoIndex: 0, seconds: 3 }];
      const frames = scenes.map((s, i) => ({ canvas: renderScene(s, i, photos, logo, brand, accent), seconds: s.seconds }));
      const { blob, ext } = await exportReelVideo(frames, setProgress);
      downloadBlob(blob, `instagram-reel.${ext}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Video export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Preview src={item.renders.cover} ratio="story" />
      <div className="rounded-3xl glass p-4 space-y-3">
        <div>
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Hook</p>
          <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">"{reel.hook}"</p>
        </div>
        <div>
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-1.5">Scene plan</p>
          {reel.scenes.map((s, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1">
              <span className="grid place-items-center w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-slate-700 dark:text-slate-200">{s.text}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Photo {s.photoIndex + 1} · {s.seconds}s</p>
              </div>
            </div>
          ))}
        </div>
        {reel.audio && (
          <p className="flex items-center gap-1.5 text-[13px] text-slate-600 dark:text-slate-300">
            <Music size={14} className="shrink-0" /> {reel.audio}
          </p>
        )}
      </div>

      {videoExportSupported() ? (
        <button
          onClick={exportVideo}
          disabled={exporting}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold active:scale-[0.98] disabled:opacity-60"
        >
          {exporting ? (
            <><Loader2 size={16} className="animate-spin" /> Rendering… {Math.round(progress * 100)}%</>
          ) : (
            <><Clapperboard size={16} /> Export reel video</>
          )}
        </button>
      ) : (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">Video export isn't supported in this browser — the cover & scene plan are ready to shoot with.</p>
      )}
      {err && <p className="text-center text-xs text-rose-500">{err}</p>}
      <SaveShareRow dataUrl={item.renders.cover} filename="reel-cover.jpg" shareText={fullCaption} />

      <div className="rounded-3xl glass p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Reel caption</p>
          <CopyBtn text={fullCaption} label="Copy" />
        </div>
        <p className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{fullCaption}</p>
      </div>
    </div>
  );
}
