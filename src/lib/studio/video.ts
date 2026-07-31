// Reel video export: animates the AI's scene plan (pre-rendered story-sized
// frames) with a gentle Ken Burns zoom and crossfades, recording the canvas
// with MediaRecorder. Output is MP4 where the browser supports it (Safari)
// and WebM elsewhere — both upload fine to Instagram from the phone.

import { STORY_W, STORY_H } from "./render";

export interface SceneFrame {
  canvas: HTMLCanvasElement;
  seconds: number;
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function videoExportSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
}

const FADE = 0.35; // seconds of crossfade between scenes

export async function exportReelVideo(
  scenes: SceneFrame[],
  onProgress?: (fraction: number) => void
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  if (!scenes.length) throw new Error("No scenes to export");
  const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("Video export is not supported in this browser");

  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const total = scenes.reduce((s, sc) => s + sc.seconds, 0);
  const starts: number[] = [];
  let acc = 0;
  for (const sc of scenes) {
    starts.push(acc);
    acc += sc.seconds;
  }

  const drawScene = (i: number, local: number, alpha: number) => {
    const sc = scenes[i];
    // Alternate zoom-in / zoom-out; ±6% is enough to feel alive, not seasick.
    const p = Math.min(1, local / sc.seconds);
    const zoom = i % 2 === 0 ? 1 + 0.06 * p : 1.06 - 0.06 * p;
    const w = STORY_W * zoom;
    const h = STORY_H * zoom;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sc.canvas, (STORY_W - w) / 2, (STORY_H - h) / 2, w, h);
    ctx.globalAlpha = 1;
  };

  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
  });
  rec.start(250);

  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) return resolve();
      let i = scenes.length - 1;
      while (i > 0 && t < starts[i]) i--;
      const local = t - starts[i];
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, STORY_W, STORY_H);
      // Crossfade the head of each scene over the tail of the previous one.
      if (i > 0 && local < FADE) {
        drawScene(i - 1, scenes[i - 1].seconds, 1);
        drawScene(i, local, local / FADE);
      } else {
        drawScene(i, local, 1);
      }
      onProgress?.(Math.min(1, t / total));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  rec.stop();
  const blob = await done;
  onProgress?.(1);
  return { blob, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
}
