import type { NewsResponse } from './types'

export async function fetchNews(): Promise<NewsResponse> {
  const res = await fetch('/api/news', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`news request failed (${res.status})`)
  return (await res.json()) as NewsResponse
}
