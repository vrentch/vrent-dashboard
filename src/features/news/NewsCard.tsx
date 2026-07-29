import type { NewsItem } from "../../lib/api";
import { timeAgo, hostOf } from "../../lib/format";
import { countryByCode, topicByKey } from "../../../shared/catalog";
import TopicIcon from "../../components/TopicIcon";
import HeadlineImage from "./HeadlineImage";

interface Props {
  item: NewsItem;
  index: number;
  variant?: "full" | "compact";
  showCountry?: boolean;
  onOpen: (item: NewsItem) => void;
}

export default function NewsCard({ item, index, variant = "full", showCountry = true, onOpen }: Props) {
  const country = countryByCode(item.countryCode);
  const topic = topicByKey(item.topicKey);
  const host = hostOf(item.link);
  const delay = { animationDelay: `${Math.min(index, 12) * 25}ms` };

  const tags = (
    <div className="flex gap-1.5 flex-wrap">
      {showCountry && country && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          {country.flag} {country.code}
        </span>
      )}
      {topic && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-500/15 text-[11px] font-medium text-brand-700 dark:text-brand-300">
          <TopicIcon name={topic.icon} size={11} />
          {topic.label}
        </span>
      )}
    </div>
  );

  if (variant === "compact") {
    return (
      <button
        onClick={() => onOpen(item)}
        className="snap-item shrink-0 w-[250px] text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 card-shadow overflow-hidden active:scale-[0.98] transition animate-in"
        style={delay}
      >
        <HeadlineImage item={item} size="md" className="h-32 w-full" />
        <div className="p-3">
          <div className="mb-1.5">{tags}</div>
          <h3 className="text-[14px] font-semibold leading-snug text-slate-900 dark:text-slate-100 line-clamp-3">{item.title}</h3>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="font-medium text-slate-500 dark:text-slate-400 truncate max-w-[60%]">{item.source || host}</span>
            <span>·</span>
            <span>{timeAgo(item.publishedAt)}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onOpen(item)}
      className="group block w-full text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/60 card-shadow overflow-hidden active:scale-[0.99] transition animate-in"
      style={delay}
    >
      <div className="flex gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5">{tags}</div>
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100 line-clamp-3">{item.title}</h3>
          {item.summary && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">{item.summary}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <span className="font-medium text-slate-500 dark:text-slate-400 truncate max-w-[70%]">{item.source || host}</span>
            <span>·</span>
            <span>{timeAgo(item.publishedAt)}</span>
          </div>
        </div>
        <HeadlineImage item={item} size="sm" className="w-24 h-24 shrink-0 rounded-xl" />
      </div>
    </button>
  );
}
