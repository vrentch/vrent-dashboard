import type { NewsItem } from "../../lib/api";
import { timeAgo, hostOf } from "../../lib/format";
import { countryByCode, topicByKey } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import { ExternalLink } from "lucide-react";

interface Props {
  item: NewsItem;
  index: number;
  variant?: "full" | "compact";
  showCountry?: boolean;
}

export default function NewsCard({ item, index, variant = "full", showCountry = true }: Props) {
  const country = countryByCode(item.countryCode);
  const topic = topicByKey(item.topicKey);
  const host = hostOf(item.link);
  const delay = { animationDelay: `${Math.min(index, 12) * 25}ms` };

  const tags = (
    <div className="flex gap-1.5 flex-wrap">
      {showCountry && country && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-medium text-slate-600">
          {country.flag} {country.code}
        </span>
      )}
      {topic && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-[11px] font-medium text-brand-700">
          <TopicIcon name={topic.icon} size={11} />
          {topic.label}
        </span>
      )}
    </div>
  );

  if (variant === "compact") {
    return (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="snap-item shrink-0 w-[250px] bg-white rounded-2xl border border-slate-200/70 card-shadow overflow-hidden active:scale-[0.98] transition animate-in"
        style={delay}
      >
        {item.imageUrl && (
          <div className="h-32 w-full overflow-hidden bg-slate-100">
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")}
            />
          </div>
        )}
        <div className="p-3">
          <div className="mb-1.5">{tags}</div>
          <h3 className="text-[14px] font-semibold leading-snug text-slate-900 line-clamp-3">{item.title}</h3>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="font-medium text-slate-500 truncate max-w-[60%]">{item.source || host}</span>
            <span>·</span>
            <span>{timeAgo(item.publishedAt)}</span>
          </div>
        </div>
      </a>
    );
  }

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-2xl bg-white border border-slate-200/70 card-shadow overflow-hidden active:scale-[0.99] transition animate-in"
      style={delay}
    >
      <div className="flex gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5">{tags}</div>
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900 line-clamp-3">{item.title}</h3>
          {item.summary && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 line-clamp-2">{item.summary}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="font-medium text-slate-500 truncate max-w-[55%]">{item.source || host}</span>
            <span>·</span>
            <span>{timeAgo(item.publishedAt)}</span>
            <ExternalLink size={13} className="ml-auto opacity-0 group-hover:opacity-100 transition" />
          </div>
        </div>
        {item.imageUrl && (
          <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-slate-100">
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover group-hover:scale-105 transition duration-500"
              onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")}
            />
          </div>
        )}
      </div>
    </a>
  );
}
