import { getNews } from '../shared/news'
import { buildRoundup } from '../shared/roundup'

// ---------------------------------------------------------------------------
// Auto-publish a weekly VR/AR roundup to the store's Shopify blog.
// ---------------------------------------------------------------------------
// Trigger: GET/POST /api/publish-news  (wired to a weekly Vercel Cron below).
//
// Safety:
//  - Creates the article as a DRAFT by default (PUBLISH_MODE=draft) so nothing
//    goes live on the store without a human tapping "publish" in Shopify admin.
//    Set PUBLISH_MODE=live to publish immediately.
//  - If Shopify credentials are absent, runs in DRY-RUN and just returns the
//    generated article so you can preview it. Nothing is sent anywhere.
//  - A shared secret (CRON_SECRET) gates the endpoint so randoms can't trigger it.
//
// Required env to actually post:
//   SHOPIFY_STORE          e.g. vrent.myshopify.com
//   SHOPIFY_ADMIN_TOKEN    Admin API access token with write_content scope
//   SHOPIFY_NEWS_BLOG_ID   (optional) numeric blog id; else resolved by handle
//   SHOPIFY_NEWS_BLOG_HANDLE (optional, default "news")
//   PUBLISH_MODE           "draft" (default) | "live"
//   CRON_SECRET            (optional) shared secret; required as ?key= if set

const API_VERSION = '2024-10'

interface Res {
  status: (n: number) => Res
  setHeader: (k: string, v: string) => void
  json: (b: unknown) => void
}
interface Req {
  method?: string
  query?: Record<string, string | string[] | undefined>
  headers?: Record<string, string | string[] | undefined>
}

async function shopify(path: string, token: string, store: string, init?: RequestInit) {
  const res = await fetch(`https://${store}/admin/api/${API_VERSION}/${path}`, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(`Shopify ${path} ${res.status}: ${text.slice(0, 300)}`)
  return body as Record<string, unknown>
}

async function resolveBlogId(token: string, store: string): Promise<string> {
  if (process.env.SHOPIFY_NEWS_BLOG_ID) return process.env.SHOPIFY_NEWS_BLOG_ID
  const handle = process.env.SHOPIFY_NEWS_BLOG_HANDLE || 'news'
  const data = await shopify('blogs.json', token, store)
  const blogs = (data.blogs as Array<{ id: number; handle: string }>) ?? []
  const match = blogs.find((b) => b.handle === handle) ?? blogs[0]
  if (!match) throw new Error('No blogs found on this store')
  return String(match.id)
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  const secret = process.env.CRON_SECRET
  const provided =
    (req.query?.key as string) ||
    (typeof req.headers?.authorization === 'string'
      ? req.headers.authorization.replace(/^Bearer\s+/i, '')
      : '')
  if (secret && provided !== secret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const store = process.env.SHOPIFY_STORE
  const token = process.env.SHOPIFY_ADMIN_TOKEN
  const mode = (process.env.PUBLISH_MODE || 'draft').toLowerCase()

  try {
    const articles = await getNews()
    if (!articles.length) {
      return res.status(200).json({ ok: false, error: 'no articles fetched' })
    }
    const roundup = buildRoundup(articles, new Date())

    // Dry-run preview when credentials are absent.
    if (!store || !token) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        note: 'No Shopify credentials set — previewing only, nothing posted.',
        article: roundup,
      })
    }

    const blogId = await resolveBlogId(token, store)
    const created = await shopify(`blogs/${blogId}/articles.json`, token, store, {
      method: 'POST',
      body: JSON.stringify({
        article: {
          title: roundup.title,
          body_html: roundup.bodyHtml,
          tags: roundup.tags.join(', '),
          author: 'VRENT',
          published: mode === 'live',
        },
      }),
    })

    const article = created.article as { id: number; handle: string } | undefined
    return res.status(200).json({
      ok: true,
      dryRun: false,
      mode,
      blogId,
      articleId: article?.id,
      handle: article?.handle,
      title: roundup.title,
    })
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : 'failed to publish',
    })
  }
}
