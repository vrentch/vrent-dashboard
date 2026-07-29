import type { Article, Topic } from './news'
import { TOPIC_LABELS } from './news'

// Builds an ORIGINAL "VR & AR roundup" blog article from aggregated headlines.
// It links out to each source and writes our own one-line framing — it does NOT
// republish article bodies (that would be a copyright problem). This is the
// standard, legitimate "news roundup" format.

export interface Roundup {
  title: string
  bodyHtml: string
  tags: string[]
  summary: string
}

const TOPIC_EMOJI: Record<Topic, string> = {
  vr: '🕶️',
  ar: '👓',
  mr: '🌐',
  hardware: '⚙️',
  apps: '🎮',
  business: '📈',
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param articles aggregated + de-duped headlines (already sorted newest-first)
 * @param now      reference date (injected so the output is deterministic/testable)
 * @param limit    how many stories to feature
 */
export function buildRoundup(articles: Article[], now: Date, limit = 8): Roundup {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const featured = articles.slice(0, limit)

  const dateRange = `${fmt(weekAgo)} – ${fmt(now)}`
  const title = `This Week in VR & AR — ${fmt(now)}`

  const intro =
    `<p>Your weekly round-up of the biggest virtual, augmented and mixed-reality ` +
    `headlines (${dateRange}), curated by the team at VRENT. Want to try any of ` +
    `this tech yourself? <a href="/collections/rent">Rent a headset</a> and have ` +
    `it delivered across Switzerland.</p>`

  const items = featured
    .map((a) => {
      const topic = a.topics[0]
      const emoji = topic ? TOPIC_EMOJI[topic] : '•'
      const label = topic ? TOPIC_LABELS[topic] : ''
      const snippet = a.snippet ? ` — ${escapeHtml(a.snippet.slice(0, 160))}` : ''
      return (
        `<li style="margin:0 0 14px;">` +
        `${emoji} <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener nofollow">` +
        `<strong>${escapeHtml(a.title)}</strong></a>` +
        `${snippet} ` +
        `<em style="opacity:.7;">(${escapeHtml(a.source)}${label ? ' · ' + label : ''})</em>` +
        `</li>`
      )
    })
    .join('\n')

  const outro =
    `<p style="margin-top:24px;">New headsets land constantly — bookmark this blog ` +
    `for next week's round-up, or explore <a href="/collections/rent">what's ` +
    `available to rent now</a>.</p>` +
    `<p style="font-size:.85em;opacity:.6;">Headlines aggregated from public news ` +
    `feeds; all rights remain with the original publishers. Links open on their sites.</p>`

  const bodyHtml = `${intro}\n<ul style="list-style:none;padding:0;">\n${items}\n</ul>\n${outro}`

  return {
    title,
    bodyHtml,
    tags: ['VR', 'AR', 'News', 'Weekly Roundup'],
    summary: `The top ${featured.length} VR & AR stories of the week (${dateRange}).`,
  }
}
