// Browser-side mirror of the news types. Kept separate from shared/news.ts so
// the client bundle never pulls in the Node-only feed parser.

export type Topic = 'vr' | 'ar' | 'mr' | 'hardware' | 'apps' | 'business'

export interface Article {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  topics: Topic[]
  snippet: string
}

export interface NewsResponse {
  ok: boolean
  updatedAt?: string
  error?: string
  articles: Article[]
}

export const TOPIC_ORDER: Topic[] = ['vr', 'ar', 'mr', 'hardware', 'apps', 'business']

export const TOPIC_LABELS: Record<Topic, string> = {
  vr: 'VR',
  ar: 'AR',
  mr: 'Mixed Reality',
  hardware: 'Hardware',
  apps: 'Apps & Games',
  business: 'Industry',
}
