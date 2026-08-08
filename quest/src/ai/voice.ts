/**
 * Speech in and speech out for the assistant.
 *
 * Reading a paragraph off a floating panel while wearing a headset is harder
 * than it sounds, so answers are spoken as well as shown. Asking out loud is
 * far quicker than a floating keyboard, so questions can be spoken too.
 *
 * Both halves are optional. Web Speech support in the Quest browser is not
 * something to rely on, and a WebView build may have neither, so everything is
 * feature-detected and degrades to plain text without a word to the player. No
 * permission is requested until someone actually presses the microphone.
 *
 * Nothing here throws. A voice feature that fails should be invisible.
 */

// ── Minimal typings ─────────────────────────────────────────────────────────
// The recognition API is still vendor-prefixed and is not in every TypeScript
// DOM lib, so it is described locally under distinct names rather than
// depending on whichever lib version happens to be installed.

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}

interface SpeechErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecogniserCtor = new () => SpeechRecogniser;

interface SpeechCapableWindow {
  SpeechRecognition?: SpeechRecogniserCtor;
  webkitSpeechRecognition?: SpeechRecogniserCtor;
}

function recogniserCtor(): SpeechRecogniserCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as SpeechCapableWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Public shape ────────────────────────────────────────────────────────────

export interface VoiceOptions {
  /** Start muted. The mute flag only silences output; input is unaffected. */
  muted?: boolean;
  /** BCP-47 tag for both the voice and the recogniser. Default "en-GB". */
  lang?: string;
  /** 0.1-10. Default 0.98 — a shade under natural, which reads clearly in a headset. */
  rate?: number;
  /** 0-2. Default 1. */
  pitch?: number;
  /** 0-1. Default 1. */
  volume?: number;
  /** Voice-name fragments, best first. The first available match wins. */
  preferredVoices?: readonly string[];
  /** Fires whenever speaking, listening or muted changes. */
  onStateChange?: (state: VoiceState) => void;
}

export interface VoiceState {
  speaking: boolean;
  listening: boolean;
  muted: boolean;
}

export interface ListenOptions {
  /** Overrides the voice language for one question. */
  lang?: string;
  /** Give up if nothing usable is said. Default 8000ms. */
  timeoutMs?: number;
  /** Live transcript while the player is still talking, for a caption. */
  onPartial?: (text: string) => void;
}

export interface Voice {
  /** False when this device has no speech synthesis. Show text only. */
  readonly canSpeak: boolean;
  /** False when this device has no speech recognition. Hide the microphone. */
  readonly canListen: boolean;
  state(): VoiceState;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** Speaks `text`, cutting off whatever was being said. No-op when muted. */
  speak(text: string): void;
  /** Stops speaking immediately. */
  stop(): void;
  /** Listens for one question. Resolves with the transcript, or null. */
  listen(options?: ListenOptions): Promise<string | null>;
  cancelListening(): void;
  dispose(): void;
}

// ── Feature detection ───────────────────────────────────────────────────────

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance === "function"
  );
}

export function recognitionSupported(): boolean {
  return recogniserCtor() !== null;
}

// ── Text preparation ────────────────────────────────────────────────────────

/**
 * Turns an answer into something worth listening to. Panel formatting — list
 * markers, dashes, line breaks — is read out literally by most engines, and an
 * email address read character by character is unusable.
 */
export function speakableText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)/g, (_all, user: string, host: string) =>
      `${user} at ${host.replace(/\./g, " dot ")}`,
    )
    .replace(/https?:\/\//g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/^[ \t]*[-•]\s+/gm, "")
    .replace(/\s+—\s+/g, ", ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .replace(/\.{2,}/g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const DEFAULT_PREFERRED = [
  "Google UK English Female",
  "Google US English",
  "Samantha",
  "Serena",
  "Daniel",
  "Natural",
  "Enhanced",
];

// ── Factory ─────────────────────────────────────────────────────────────────

export function createVoice(options: VoiceOptions = {}): Voice {
  const lang = options.lang ?? "en-GB";
  const rate = options.rate ?? 0.98;
  const pitch = options.pitch ?? 1;
  const volume = options.volume ?? 1;
  const preferred = options.preferredVoices ?? DEFAULT_PREFERRED;

  const canSpeak = speechSupported();
  const canListen = recognitionSupported();

  let muted = options.muted ?? false;
  let speaking = false;
  let listening = false;
  let voice: SpeechSynthesisVoice | null = null;
  let recogniser: SpeechRecogniser | null = null;
  let disposed = false;

  function emit(): void {
    options.onStateChange?.({ speaking, listening, muted });
  }

  /** Picks the most natural available voice for the language. */
  function chooseVoice(): void {
    if (!canSpeak) return;
    let available: SpeechSynthesisVoice[] = [];
    try {
      available = window.speechSynthesis.getVoices();
    } catch {
      return;
    }
    if (available.length === 0) return;

    const base = lang.slice(0, 2).toLowerCase();
    const sameLanguage = available.filter((v) => v.lang.toLowerCase().startsWith(base));
    const pool = sameLanguage.length > 0 ? sameLanguage : available;

    for (const fragment of preferred) {
      const hit = pool.find((v) => v.name.toLowerCase().includes(fragment.toLowerCase()));
      if (hit) {
        voice = hit;
        return;
      }
    }
    // "Compact" voices are the low-quality fallbacks on some platforms.
    voice =
      pool.find((v) => v.localService && !/compact/i.test(v.name)) ??
      pool.find((v) => !/compact/i.test(v.name)) ??
      pool[0];
  }

  const onVoicesChanged = (): void => chooseVoice();

  if (canSpeak) {
    chooseVoice();
    try {
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    } catch {
      // Older implementations only expose the onvoiceschanged property. The
      // initial pick above still stands, so there is nothing to recover from.
    }
  }

  function stopSpeaking(): void {
    if (!canSpeak) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Cancelling an idle synthesiser throws on some builds. Harmless.
    }
    if (speaking) {
      speaking = false;
      emit();
    }
  }

  function stopListening(): void {
    const active = recogniser;
    recogniser = null;
    if (active) {
      try {
        active.abort();
      } catch {
        // Already stopped.
      }
    }
    if (listening) {
      listening = false;
      emit();
    }
  }

  return {
    canSpeak,
    canListen,

    state(): VoiceState {
      return { speaking, listening, muted };
    },

    isMuted(): boolean {
      return muted;
    },

    setMuted(next: boolean): void {
      if (muted === next) return;
      muted = next;
      if (muted) stopSpeaking();
      else emit();
    },

    speak(text: string): void {
      if (!canSpeak || muted || disposed) return;
      const spoken = speakableText(text ?? "");
      if (spoken.length === 0) return;

      // A new answer always replaces the old one. Two overlapping voices in a
      // headset is the worst sound this app can make.
      stopSpeaking();

      try {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.lang = lang;
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;
        if (voice) utterance.voice = voice;
        utterance.onend = () => {
          speaking = false;
          emit();
        };
        utterance.onerror = () => {
          speaking = false;
          emit();
        };
        speaking = true;
        emit();
        window.speechSynthesis.speak(utterance);
      } catch {
        speaking = false;
        emit();
      }
    },

    stop: stopSpeaking,

    listen(listenOptions: ListenOptions = {}): Promise<string | null> {
      const Ctor = recogniserCtor();
      if (!Ctor || disposed) return Promise.resolve(null);

      // One question at a time.
      stopListening();
      // Talking over the player makes recognition worse and feels rude.
      stopSpeaking();

      return new Promise<string | null>((resolve) => {
        let settled = false;
        let best = "";
        let timer: ReturnType<typeof setTimeout> | undefined;

        const finish = (result: string | null): void => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          if (recogniser === instance) recogniser = null;
          if (listening) {
            listening = false;
            emit();
          }
          resolve(result);
        };

        let instance: SpeechRecogniser;
        try {
          instance = new Ctor();
        } catch {
          resolve(null);
          return;
        }

        instance.lang = listenOptions.lang ?? lang;
        instance.continuous = false;
        instance.interimResults = Boolean(listenOptions.onPartial);
        instance.maxAlternatives = 1;

        instance.onresult = (event: SpeechResultEvent): void => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const alternative = result[0];
            if (!alternative) continue;
            if (result.isFinal) best = `${best} ${alternative.transcript}`.trim();
            else interim = `${interim} ${alternative.transcript}`.trim();
          }
          if (interim.length > 0) listenOptions.onPartial?.(`${best} ${interim}`.trim());
          else if (best.length > 0) listenOptions.onPartial?.(best);
        };

        instance.onerror = (): void => {
          // No microphone permission, no speech, no network for the recogniser:
          // all the same to the player, who simply types instead.
          finish(best.trim().length > 0 ? best.trim() : null);
        };

        instance.onend = (): void => {
          finish(best.trim().length > 0 ? best.trim() : null);
        };

        recogniser = instance;
        listening = true;
        emit();

        try {
          instance.start();
        } catch {
          finish(null);
          return;
        }

        timer = setTimeout(() => {
          try {
            instance.stop();
          } catch {
            // stop() throws if it never started; onend will not fire.
            finish(best.trim().length > 0 ? best.trim() : null);
          }
        }, listenOptions.timeoutMs ?? 8000);
      });
    },

    cancelListening: stopListening,

    dispose(): void {
      disposed = true;
      stopListening();
      stopSpeaking();
      if (canSpeak) {
        try {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        } catch {
          // Nothing to remove.
        }
      }
    },
  };
}
