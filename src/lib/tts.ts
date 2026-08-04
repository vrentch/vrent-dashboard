// Text-to-speech that sounds like a person, not a robot. The browser default
// voice is usually the worst one installed — this picks the most natural
// English voice the device offers (Google/Samsung neural voices on Android,
// Siri/enhanced voices on iOS, "Natural" voices on desktop) and strips
// emojis/markup so they aren't read out loud ("party popper emoji…").

let picked: SpeechSynthesisVoice | null = null;

function bestVoice(): SpeechSynthesisVoice | null {
  if (picked) return picked;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : voices;
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|premium|enhanced/.test(n)) s += 100;
    if (/google/.test(n)) s += 60;
    if (/samsung/.test(n)) s += 50;
    if (/samantha|karen|moira|martha|serena|ava|allison|zoe|aria|jenny|libby|sonia|catherine/.test(n)) s += 40;
    if (/en[-_](gb|us|au)/i.test(v.lang)) s += 8;
    if (!v.localService) s += 5; // network voices are usually the good ones
    if (/compact|espeak|android speech/.test(n)) s -= 50;
    return s;
  };
  picked = [...pool].sort((a, b) => score(b) - score(a))[0] || null;
  return picked;
}

// The voice list loads asynchronously on most browsers — re-pick when it lands.
if (typeof window !== "undefined" && window.speechSynthesis) {
  try {
    window.speechSynthesis.onvoiceschanged = () => { picked = null; bestVoice(); };
    bestVoice(); // warm the list where it's already available
  } catch { /* no TTS */ }
}

// Emojis, markdown leftovers and long dashes read terribly — clean before speaking.
function speakable(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[*_#`~]/g, " ")
    .replace(/\s*[–—·•]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string) {
  try {
    const clean = speakable(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = bestVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.0;   // natural pace — the old 1.03 added to the robotic feel
    u.pitch = 1.02; // a touch of warmth
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* TTS unavailable */ }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
}
