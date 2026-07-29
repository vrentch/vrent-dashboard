import Sheet from "../../components/Sheet";
import type { NewsItem } from "../../lib/api";
import { timeAgo, hostOf } from "../../lib/format";
import { countryByCode, topicByKey } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import { ExternalLink, Share2 } from "lucide-react";

export default function ArticleReader({ item, onClose }: { item: NewsItem | null; onClose: () => void }) {
  if (!item) return null;
  const country = countryByCode(item.countryCode);
  const topic = topicByKey(item.topicKey);
  const host = hostOf(item.link);

  async function share() {
    if (!item) return;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url: item.link });
      else await navigator.clipboard.writeText(item.link);
    } catch {
      /* dismissed */
    }
  }

  return (
    <Sheet open={!!item} onClose={onClose} title={item.source || host || "Article"}>
      <article className="space-y-4">
        {item.imageUrl && (
          <div className="w-full rounded-2xl overflow-hidden bg-slate-100 -mt-1">
            <img
              src={item.imageUrl}
              alt=""
              className="w-full max-h-64 object-cover"
              onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")}
            />
          </div>
        )}

        <div className="flex gap-1.5 flex-wrap">
          {country && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-medium text-slate-600">
              {country.flag} {country.name}
            </span>
          )}
          {topic && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-[11px] font-medium text-brand-700">
              <TopicIcon name={topic.icon} size={11} />
              {topic.label}
            </span>
          )}
        </div>

        <h1 className="text-xl font-bold leading-tight text-slate-900">{item.title}</h1>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-600">{item.source || host}</span>
          <span>·</span>
          <span>{timeAgo(item.publishedAt)}</span>
        </div>

        {item.summary && <p className="text-[15px] leading-relaxed text-slate-700">{item.summary}</p>}

        <p className="text-xs text-slate-400">
          The full story lives on the publisher's site. Open it below to read everything.
        </p>

        <div className="flex gap-2 pt-1 sticky bottom-0 bg-white pb-1">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold active:scale-[0.98]"
          >
            <ExternalLink size={16} /> Open full article
          </a>
          <button
            onClick={share}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold active:scale-95"
          >
            <Share2 size={16} />
          </button>
        </div>
      </article>
    </Sheet>
  );
}
