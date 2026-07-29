import { useEffect, useMemo, useState } from 'react'
import { fetchNews } from './lib/api'
import type { Article, Topic } from './lib/types'
import { TOPIC_ORDER } from './lib/types'
import { NewsCard } from './components/NewsCard'
import { TopicFilter } from './components/TopicFilter'
import { CardSkeleton } from './components/Skeleton'
import { timeAgo } from './lib/format'

type Status = 'loading' | 'ready' | 'error'

export default function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [topic, setTopic] = useState<Topic | 'all'>('all')
  const [query, setQuery] = useState('')

  async function load() {
    try {
      setStatus((s) => (s === 'ready' ? 'ready' : 'loading'))
      const data = await fetchNews()
      setArticles(data.articles)
      setUpdatedAt(data.updatedAt ?? null)
      setStatus(data.articles.length ? 'ready' : 'error')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
    // Auto-refresh every 10 minutes so an open tab stays current.
    const id = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: articles.length }
    for (const t of TOPIC_ORDER) c[t] = 0
    for (const a of articles) for (const t of a.topics) c[t] = (c[t] ?? 0) + 1
    return c
  }, [articles])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return articles.filter((a) => {
      const matchTopic = topic === 'all' || a.topics.includes(topic)
      const matchQuery =
        !q || a.title.toLowerCase().includes(q) || a.source.toLowerCase().includes(q)
      return matchTopic && matchQuery
    })
  }, [articles, topic, query])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <VrGlyph />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-ink">VR &amp; AR News</h1>
          <span className="ml-1 rounded-full bg-brand/8 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
            by VRENT.ch
          </span>
        </div>
        <p className="mt-1.5 text-sm text-muted">
          The latest in virtual, augmented &amp; mixed reality — headsets, apps and industry
          moves, refreshed automatically.
        </p>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TopicFilter active={topic} counts={counts} onChange={setTopic} />
        <div className="relative sm:w-64">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines…"
            aria-label="Search headlines"
            className="w-full rounded-full bg-white px-4 py-2 text-sm text-ink ring-1 ring-black/5 outline-none placeholder:text-muted/70 focus:ring-2 focus:ring-brand/40"
          />
        </div>
      </div>

      {status === 'loading' ? (
        <Grid>
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </Grid>
      ) : status === 'error' ? (
        <ErrorState onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState onReset={() => (setTopic('all'), setQuery(''))} />
      ) : (
        <Grid>
          {visible.map((a) => (
            <NewsCard key={a.id} article={a} />
          ))}
        </Grid>
      )}

      <footer className="mt-10 flex flex-col items-center gap-1 text-center text-xs text-muted">
        <button onClick={load} className="font-medium text-brand hover:underline">
          Refresh
        </button>
        {updatedAt ? <span>Updated {timeAgo(updatedAt)}</span> : null}
        <span className="opacity-70">
          Headlines aggregated from public news feeds. Curated by VRENT.ch.
        </span>
      </footer>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-black/5">
      <p className="text-ink">We couldn’t load the latest headlines just now.</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        Try again
      </button>
    </div>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-black/5">
      <p className="text-ink">No stories match that filter.</p>
      <button onClick={onReset} className="mt-3 text-sm font-medium text-brand hover:underline">
        Clear filters
      </button>
    </div>
  )
}

function VrGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.2a1.5 1.5 0 0 1-1.2-.6l-.9-1.2a1.5 1.5 0 0 0-2.4 0l-.9 1.2a1.5 1.5 0 0 1-1.2.6H5.5A2.5 2.5 0 0 1 3 14.5v-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}
