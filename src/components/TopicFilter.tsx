import { TOPIC_LABELS, TOPIC_ORDER, type Topic } from '../lib/types'

interface Props {
  active: Topic | 'all'
  counts: Record<string, number>
  onChange: (t: Topic | 'all') => void
}

export function TopicFilter({ active, counts, onChange }: Props) {
  const chips: Array<{ key: Topic | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    ...TOPIC_ORDER.map((t) => ({ key: t, label: TOPIC_LABELS[t] })),
  ]

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter news by topic">
      {chips.map(({ key, label }) => {
        const isActive = active === key
        const count = key === 'all' ? counts.all : counts[key]
        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={
              'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ' +
              (isActive
                ? 'bg-brand text-white shadow-sm'
                : 'bg-white text-muted ring-1 ring-black/5 hover:bg-black/[0.03]')
            }
          >
            {label}
            {count ? <span className="ml-1.5 opacity-60">{count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
