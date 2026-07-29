# VRENT.ch — VR & AR News

A small, self-updating **VR / AR / mixed-reality news feed** for
[vrent.ch](https://vrent.ch). It aggregates public news feeds (Google News RSS —
no API keys, no cost), de-duplicates and tags each story by topic, and presents
a clean, responsive, VRENT-styled feed.

It runs two ways:

1. **Standalone page** — deploy it and link to it from your Shopify nav.
2. **Embedded section** — drop `shopify/sections/vr-news.liquid` into your theme
   and point it at the deployed URL; it embeds this app in a self-resizing
   iframe (add `?embed=1` handled automatically) so it blends into the store.

> This is a **separate feature** from any earlier app in this repo. It is
> intentionally standalone so "latest news" stays current with zero manual
> upkeep — a pure Liquid theme can't fetch and refresh external feeds on its
> own, so a tiny serverless function does it here.

## How it works

- `shared/news.ts` — the engine: fetches several Google News RSS searches
  (VR, AR, mixed reality, Meta Quest, Apple Vision Pro, XREAL/Ray-Ban Meta,
  VR gaming), merges + de-dupes them, classifies each story into topics.
- `api/news.ts` — Vercel serverless function serving `GET /api/news`, cached at
  the edge (`s-maxage=900, stale-while-revalidate=1800`).
- `server/devMiddleware.ts` — serves the same `/api/news` in `vite dev` so live
  data works locally with no deploy.
- `src/` — the React + Tailwind UI (topic filter, search, auto-refresh).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173  (live data via the dev middleware)
npm run typecheck  # optional TypeScript check
npm run build      # production build → dist/
```

## Deploy (free)

Set up for **Vercel** (any host with Node serverless functions works). Import
the repo at [vercel.com/new](https://vercel.com/new) — Vite and the `/api`
function are auto-detected, no configuration needed. For a branded URL, add a
subdomain like `vr-news.vrent.ch` in Vercel's domain settings.

## Embed in Shopify

1. Deploy the app (above) and note its URL.
2. Copy `shopify/sections/vr-news.liquid` into your theme's `sections/` folder.
3. In the theme editor, add the **VR & AR News** section to a page and paste the
   deployed URL into **News app URL**.

## Customising

- **Topics / sources** — edit `QUERIES` and `CLASSIFIERS` in `shared/news.ts`.
- **Brand colour** — `--color-brand` in `src/index.css` (default matches a
  VRENT blue; change to your exact brand hex).
- **Refresh cadence** — the client re-fetches every 10 min; the edge cache
  refreshes every 15 min.
