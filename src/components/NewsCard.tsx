import type { Article } from '../lib/types'
import { TOPIC_LABELS } from '../lib/types'
import { hostname, timeAgo } from '../lib/format'

export function NewsCard({ article }: { article: Article }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
        <span className="truncate">{article.source || hostname(article.url)}</span>
        <span aria-hidden>·</span>
        <time dateTime={article.publishedAt}>{timeAgo(article.publishedAt)}</time>
      </div>

      <h3 className="text-[17px] font-semibold leading-snug text-ink group-hover:text-brand">
        {article.title}
      </h3>

      {article.snippet ? (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{article.snippet}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {article.topics.slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-full bg-brand/8 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand"
          >
            {TOPIC_LABELS[t]}
          </span>
        ))}
      </div>
    </a>
  )
}
