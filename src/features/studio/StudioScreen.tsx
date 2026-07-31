import { useRef, useState } from "react";
import { Sparkles, ImagePlus, X, Loader2, Wand2, MessageCircleQuestion, Store, LayoutGrid, Clapperboard, GalleryVerticalEnd, CircleUserRound } from "lucide-react";
import {
  aiStudioQuestions,
  aiStudioGenerate,
  type StudioQuestion,
  type StudioAnswer,
  type StudioPackage,
} from "../../lib/api";
import { prepareImage, type PreparedImage } from "../../lib/image";
import { useAiAccess } from "../../lib/aiAccess";
import AiUnlock from "../ai/AiUnlock";
import { useBrand, brandReady } from "../../lib/studio/brand";
import { saveItem, newId, type LibraryItem } from "../../lib/studio/library";
import { loadImage, renderGraphic, toJpeg } from "../../lib/studio/render";
import BrandKitSheet from "./BrandKitSheet";
import ResultView from "./ResultView";
import LibraryView from "./LibraryView";

type Step = "input" | "questions" | "generating" | "result";
type Format = "post" | "story" | "reel";

const FORMATS: { key: Format; label: string; icon: typeof LayoutGrid }[] = [
  { key: "post", label: "Post", icon: LayoutGrid },
  { key: "story", label: "Story", icon: GalleryVerticalEnd },
  { key: "reel", label: "Reel", icon: Clapperboard },
];

const MAX_PHOTOS = 4;

export default function StudioScreen() {
  const { status, unlock } = useAiAccess();
  const brand = useBrand();
  const [view, setView] = useState<"create" | "library">("create");
  const [brandOpen, setBrandOpen] = useState(false);

  const [step, setStep] = useState<Step>("input");
  const [photos, setPhotos] = useState<PreparedImage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [formats, setFormats] = useState<Format[]>(["post", "story", "reel"]);
  const [questions, setQuestions] = useState<StudioQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const brandInfo = () => ({
    name: brand.name, handle: brand.handle, tagline: brand.tagline, about: brand.about,
    primary: brand.primary, secondary: brand.secondary, language: brand.language,
  });
  const photoPayload = () => photos.map((p) => ({ data: p.base64, mediaType: p.mediaType }));

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    try {
      // 1280px keeps 4 photos comfortably inside the request size limit while
      // giving the vision model (and the 1080px renders) plenty of detail.
      const prepared = await Promise.all(files.slice(0, MAX_PHOTOS - photos.length).map((f) => prepareImage(f, 1280, 0.8)));
      setPhotos((p) => [...p, ...prepared].slice(0, MAX_PHOTOS));
    } catch {
      setError("Couldn't read one of those photos — try a different one.");
    }
  }

  async function askQuestions() {
    setBusy(true);
    setError(null);
    try {
      const res = await aiStudioQuestions(photoPayload(), prompt, brandInfo(), formats);
      if (res.ok && res.data?.questions?.length) {
        setQuestions(res.data.questions);
        setAnswers({});
        setStep("questions");
      } else if (res.needCode) {
        setError("Enter the AI access code above first.");
      } else {
        // Questions are an enhancement, not a gate — fall through to generate.
        await generate([]);
      }
    } catch {
      setError("Couldn't reach the AI — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function generate(briefAnswers: StudioAnswer[], revision?: string, base?: LibraryItem) {
    setStep("generating");
    setError(null);
    try {
      const res = await aiStudioGenerate(photoPayload(), prompt, brandInfo(), formats, briefAnswers, revision);
      if (!res.ok || !res.data) {
        setError(res.needCode ? "Enter the AI access code above first." : res.error || "Generation failed — try again.");
        setStep(base ? "result" : questions.length ? "questions" : "input");
        return;
      }
      const saved = await renderAndSave(res.data, base);
      setItem(saved);
      setStep("result");
    } catch {
      setError("Something went wrong while generating — try again.");
      setStep(base ? "result" : "input");
    }
  }

  async function renderAndSave(pkg: StudioPackage, base?: LibraryItem): Promise<LibraryItem> {
    const imgs = await Promise.all(photos.map((p) => loadImage(p.dataUrl)));
    const logo = brand.logo ? await loadImage(brand.logo).catch(() => null) : null;
    const renders: LibraryItem["renders"] = {};
    renders.post = toJpeg(renderGraphic({ kind: "post", layout: pkg.post.layout, photos: imgs, logo, brand }));
    renders.story = toJpeg(renderGraphic({ kind: "story", layout: pkg.story.layout, photos: imgs, logo, brand }));
    renders.cover = toJpeg(renderGraphic({ kind: "story", layout: pkg.reel.cover, photos: imgs, logo, brand }));
    const saved: LibraryItem = {
      id: base?.id || newId(),
      createdAt: base?.createdAt || Date.now(),
      category: pkg.category,
      prompt,
      concept: pkg.concept,
      photos: photos.map((p) => p.dataUrl),
      pkg,
      renders,
    };
    await saveItem(saved).catch(() => { /* library is best-effort */ });
    return saved;
  }

  function resetFlow() {
    setStep("input");
    setPhotos([]);
    setPrompt("");
    setQuestions([]);
    setAnswers({});
    setItem(null);
    setError(null);
  }

  const answered = questions.filter((q) => answers[q.id]).length;
  const toBrief = (): StudioAnswer[] =>
    questions
      .filter((q) => answers[q.id])
      .map((q) => ({ question: q.question, answer: answers[q.id] }));

  return (
    <div>
      <header className="sticky top-0 z-30 glass-nav border-b border-white/40 dark:border-white/10 safe-top">
        <div className="max-w-lg mx-auto px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Studio</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">AI-crafted Instagram posts, stories & reels</p>
          </div>
          <button
            onClick={() => setBrandOpen(true)}
            className="relative grid place-items-center w-10 h-10 rounded-full glass text-slate-600 dark:text-slate-300 active:scale-95"
            aria-label="Brand kit"
          >
            {brand.logo ? <img src={brand.logo} alt="" className="w-6 h-6 object-contain" /> : <Store size={19} />}
            {!brandReady(brand) && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500" />}
          </button>
        </div>
      </header>

      <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Create / Library switch */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl glass-subtle">
          {(["create", "library"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`py-2 rounded-xl text-sm font-semibold capitalize transition ${
                view === v ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white card-shadow" : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {status === "off" && (
          <div className="rounded-3xl glass p-5 text-sm text-slate-500 dark:text-slate-400">
            AI isn't configured on the server yet — set <code>ANTHROPIC_API_KEY</code> to power the Studio.
          </div>
        )}
        {status === "locked" && <AiUnlock onSubmit={unlock} compact />}

        {view === "library" ? (
          <LibraryView />
        ) : (
          <>
            {!brandReady(brand) && step === "input" && (
              <button onClick={() => setBrandOpen(true)} className="w-full rounded-3xl glass p-4 flex items-center gap-3 text-left active:scale-[0.99]">
                <div className="grid place-items-center w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
                  <CircleUserRound size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100">Set up your brand kit</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Logo, name & colors go on every design</p>
                </div>
              </button>
            )}

            {error && <div className="rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[13px] px-4 py-3">{error}</div>}

            {step === "input" && (
              <>
                {/* Photos */}
                <div className="rounded-3xl glass p-4">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-3">1 · Photos ({photos.length}/{MAX_PHOTOS})</p>
                  <div className="grid grid-cols-4 gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                        <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-black/60 text-white"
                          aria-label="Remove photo"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 grid place-items-center text-slate-400 active:scale-95"
                        aria-label="Add photos"
                      >
                        <ImagePlus size={22} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Prompt */}
                <div className="rounded-3xl glass p-4">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-2">2 · What's this about?</p>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    placeholder="e.g. New 2-room apartment in Zurich just listed — modern kitchen, lake view, available Sept 1"
                    className="w-full rounded-xl glass-subtle px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none resize-none placeholder:text-slate-400"
                  />
                </div>

                {/* Formats */}
                <div className="rounded-3xl glass p-4">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mb-3">3 · Formats</p>
                  <div className="grid grid-cols-3 gap-2">
                    {FORMATS.map(({ key, label, icon: Icon }) => {
                      const on = formats.includes(key);
                      return (
                        <button
                          key={key}
                          onClick={() => setFormats(on ? formats.filter((f) => f !== key) : [...formats, key])}
                          className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition active:scale-95 ${
                            on
                              ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-transparent"
                              : "glass-subtle text-slate-500 dark:text-slate-400 border-transparent"
                          }`}
                        >
                          <Icon size={19} />
                          <span className="text-xs font-semibold">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={askQuestions}
                    disabled={!photos.length || !formats.length || busy || status !== "ready"}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl glass text-sm font-bold text-slate-900 dark:text-slate-100 active:scale-[0.98] disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <MessageCircleQuestion size={16} />} AI brief
                  </button>
                  <button
                    onClick={() => generate([])}
                    disabled={!photos.length || !formats.length || busy || status !== "ready"}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold active:scale-[0.98] disabled:opacity-40"
                  >
                    <Wand2 size={16} /> Generate now
                  </button>
                </div>
                <p className="text-center text-[11px] text-slate-400 dark:text-slate-500 -mt-1">
                  "AI brief" asks 3 quick questions for a sharper result
                </p>
              </>
            )}

            {step === "questions" && (
              <>
                <div className="rounded-3xl glass p-4">
                  <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Quick brief · {answered}/{questions.length} answered</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">The AI looked at your photos and wants to nail these down</p>
                </div>
                {questions.map((q) => (
                  <div key={q.id} className="rounded-3xl glass p-4">
                    <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 mb-3">{q.question}</p>
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((o) => {
                        const on = answers[q.id] === o.label;
                        return (
                          <button
                            key={o.key}
                            onClick={() => setAnswers({ ...answers, [q.id]: on ? "" : o.label })}
                            className={`px-3.5 py-2 rounded-full text-[13px] font-semibold transition active:scale-95 ${
                              on
                                ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                                : "glass-subtle text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setStep("input")} className="py-3.5 rounded-2xl glass text-sm font-bold text-slate-600 dark:text-slate-300 active:scale-[0.98]">
                    Back
                  </button>
                  <button
                    onClick={() => generate(toBrief())}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold active:scale-[0.98]"
                  >
                    <Sparkles size={16} /> Generate
                  </button>
                </div>
              </>
            )}

            {step === "generating" && (
              <div className="rounded-3xl glass p-10 flex flex-col items-center gap-4 text-center">
                <div className="grid place-items-center w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400">
                  <Loader2 size={28} className="animate-spin" />
                </div>
                <div>
                  <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Designing your content…</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Caption, hashtags, layouts & reel plan — a few seconds</p>
                </div>
              </div>
            )}

            {step === "result" && item && (
              <ResultView
                item={item}
                onRegenerate={(revision) => generate(toBrief(), revision, item)}
                onNew={resetFlow}
              />
            )}
          </>
        )}
      </div>

      <BrandKitSheet open={brandOpen} onClose={() => setBrandOpen(false)} />
    </div>
  );
}
