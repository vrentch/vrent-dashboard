import { useState } from "react";
import type { NewsItem } from "../../lib/api";
import { topicByKey } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";

// Monochrome graphite gradient pairs. Google News carries no images, so
// headlines without a picture get a designed tile (topic icon on a gradient)
// instead of an empty box — keyed by content so cards look varied but stable.
const GRADIENTS: [string, string][] = [
  ["#3f3f46", "#18181b"],
  ["#52525b", "#27272a"],
  ["#3f3f46", "#09090b"],
  ["#4b5563", "#1f2937"],
  ["#57534e", "#292524"],
  ["#334155", "#0f172a"],
  ["#44403c", "#1c1917"],
  ["#3f3f46", "#111113"],
  ["#4b5563", "#111827"],
  ["#52525b", "#18181b"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function HeadlineImage({
  item,
  size = "md",
  className = "",
}: {
  item: NewsItem;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // Candidate image sources, tried in order. Google News items carry no
  // imageUrl, so we fall back to the server-side og:image resolver
  // (/api/img?u=<link>) which pulls the original picture from the source.
  const candidates: string[] = [];
  if (item.imageUrl) candidates.push(item.imageUrl);
  if (item.link) candidates.push(`/api/img?u=${encodeURIComponent(item.link)}`);

  const [step, setStep] = useState(0);
  const topic = topicByKey(item.topicKey);
  const [from, to] = GRADIENTS[hash(item.source + item.title) % GRADIENTS.length];
  const iconSize = size === "sm" ? 26 : size === "lg" ? 52 : 40;

  const src = candidates[step];
  if (src) {
    return (
      <div className={`overflow-hidden bg-slate-100 dark:bg-slate-800 ${className}`}>
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setStep((s) => s + 1)}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <div className="absolute inset-0 grid place-items-center">
        <TopicIcon name={topic?.icon ?? "Newspaper"} size={iconSize} className="text-white/85" strokeWidth={1.75} />
      </div>
      {size !== "sm" && (
        <span className="absolute bottom-1.5 left-2.5 right-2.5 truncate text-[11px] font-semibold text-white/90">
          {item.source}
        </span>
      )}
      <div
        className="absolute -right-6 -top-6 w-20 h-20 rounded-full"
        style={{ background: "rgba(255,255,255,0.12)" }}
      />
    </div>
  );
}
