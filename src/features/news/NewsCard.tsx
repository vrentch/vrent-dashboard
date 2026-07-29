import type { NewsItem } from "../../lib/api";
import { timeAgo, hostOf } from "../../lib/format";
import { countryByCode, topicByKey } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import { ExternalLink } from "lucide-react";

export default function NewsCard({ item, index }: { item: NewsItem; index: number }) {
  const country = countryByCode(item.countryCode);
  const topic = topicByKey(item.topicKey);
  const host = hostOf(item.link);

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-2xl bg-ink-900 border border-white/5 overflow-hidden active:scale-[0.99] transition animate-in"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      {item.imageUrl && (
        <div className="relative h-40 w-full overflow-hidden bg-ink-800">
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover group-hover:scale-105 transition duration-500"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
          <div className="absolute top-2 left-2 flex gap-1.5">
            {country && (
              <span className="px-2 py-0.5 rounded-full bg-black/55 backdrop-blur text-xs font-medium text-white">
                {country.flag} {country.code}
              </span>
            )}
            {topic && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/85 backdrop-blur text-xs font-medium text-white">
                <TopicIcon name={topic.icon} size={12} />
                {topic.label}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="p-3.5">
        {!item.imageUrl && (
          <div className="flex gap-1.5 mb-2">
            {country && (
              <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs font-medium text-slate-300">
                {country.flag} {country.code}
              </span>
            )}
            {topic && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-xs font-medium text-sky-300">
                <TopicIcon name={topic.icon} size={12} />
                {topic.label}
              </span>
            )}
          </div>
        )}

        <h3 className="text-[15px] font-semibold leading-snug text-white line-clamp-3">
          {item.title}
        </h3>

        {item.summary && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400 line-clamp-2">
            {item.summary}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-400 truncate max-w-[55%]">
            {item.source || host}
          </span>
          <span>·</span>
          <span>{timeAgo(item.publishedAt)}</span>
          <ExternalLink size={13} className="ml-auto opacity-0 group-hover:opacity-100 transition" />
        </div>
      </div>
    </a>
  );
}
