import { getNews } from '../shared/news'

// Vercel Node serverless function: GET /api/news
// Cached at the edge so we don't hammer the upstream feeds — stale-while-
// revalidate keeps responses instant while refreshing in the background.
export default async function handler(
  _req: { method?: string },
  res: {
    status: (n: number) => typeof res
    setHeader: (k: string, v: string) => void
    json: (b: unknown) => void
    end: () => void
  },
) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800')

  try {
    const articles = await getNews()
    res.status(200).json({ ok: true, updatedAt: new Date().toISOString(), articles })
  } catch (err) {
    res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : 'failed to load news',
      articles: [],
    })
  }
}
