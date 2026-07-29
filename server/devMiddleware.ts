import type { Plugin, ViteDevServer } from 'vite'
import { getNews } from '../shared/news'

// Serves /api/news during `vite dev` so the app has live data locally,
// mirroring the production serverless function in api/news.ts.
export function devApi(): Plugin {
  return {
    name: 'vrent-dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/news', async (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.setHeader('access-control-allow-origin', '*')
        try {
          const articles = await getNews()
          res.end(JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), articles }))
        } catch (err) {
          res.statusCode = 200
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : 'failed',
              articles: [],
            }),
          )
        }
      })
    },
  }
}
